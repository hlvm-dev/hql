/**
 * Capability-Proof MCP E2E Tests
 *
 * Proves the full MCP pipeline: discovery → routing → execution
 * for audio.analyze, computer.use, and structured.output semantic capabilities.
 *
 * No API keys required — uses local fixture MCP server with
 * deterministic responses.
 *
 * Run with:
 *   deno test --allow-all tests/e2e/mcp-capability-proof.test.ts
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { getPlatform } from "../../src/platform/platform.ts";
import { getMcpConfigPath } from "../../src/common/paths.ts";
import { inspectMcpServersForCapabilities } from "../../src/hlvm/agent/mcp/tools.ts";
import { loadMcpTools } from "../../src/hlvm/agent/mcp/mod.ts";
import { getTool, hasTool } from "../../src/hlvm/agent/registry.ts";
import { buildExecutionSurface } from "../../src/hlvm/agent/execution-surface.ts";
import type { McpExecutionPathCandidate } from "../../src/hlvm/agent/execution-surface.ts";
import type { SemanticCapabilityId } from "../../src/hlvm/agent/semantic-capabilities.ts";
import { withTempHlvmDir } from "../unit/helpers.ts";

function fixturePath(): string {
  return getPlatform().path.join("tests", "fixtures", "mcp-server.ts");
}

function fixtureServer(
  name: string,
  mode: string,
): { name: string; command: string[]; env: Record<string, string> } {
  return {
    name,
    command: ["deno", "run", `--allow-env=MCP_TEST_MODE`, fixturePath()],
    env: { MCP_TEST_MODE: mode },
  };
}

async function withWorkspace(
  fn: (workspace: string) => Promise<void>,
): Promise<void> {
  const platform = getPlatform();
  const workspace = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-cap-proof-" });
  try {
    await fn(workspace);
  } finally {
    await platform.fs.remove(workspace, { recursive: true });
  }
}

async function writeMcpConfig(servers: unknown): Promise<void> {
  const platform = getPlatform();
  const configPath = getMcpConfigPath();
  await platform.fs.mkdir(platform.path.dirname(configPath), {
    recursive: true,
  });
  await platform.fs.writeTextFile(
    configPath,
    JSON.stringify({ version: 1, servers }),
  );
}

/** Extract text from MCP-compliant tool result. */
function mcpText(result: unknown): string {
  const payload = result as { content: Array<{ type: string; text: string }> };
  return payload.content[0].text;
}

/** Build a minimal provider execution plan for eval (OpenAI-like: no native audio/computer). */
function buildMinimalPlan(providerName: string) {
  return {
    providerName,
    routingProfile: "conservative" as const,
    web: {
      providerName,
      capabilities: {
        web_search: {
          id: "web_search",
          selectors: [],
          customToolName: "web_search",
          implementation: "custom" as const,
          activeToolName: "search_web",
          citationBacked: false,
          rawPayloadCitationEligible: false,
        },
        web_page_read: {
          id: "web_page_read",
          selectors: [],
          customToolName: "web_page_read",
          implementation: "custom" as const,
          activeToolName: "web_fetch",
          citationBacked: false,
          rawPayloadCitationEligible: false,
        },
        raw_url_fetch: {
          id: "raw_url_fetch",
          selectors: [],
          customToolName: "raw_url_fetch",
          implementation: "disabled" as const,
          citationBacked: false,
          rawPayloadCitationEligible: false,
        },
      },
    },
    remoteCodeExecution: {
      id: "remote_code_execution",
      selectors: [],
      customToolName: "code_exec",
      nativeToolName: "",
      implementation: "disabled" as const,
      description: "Remote code execution",
    },
    computerUse: { available: false },
  };
}

/**
 * Convert inspection results into McpExecutionPathCandidate map
 * (same logic as the private buildMcpExecutionCandidates in execution-surface-runtime.ts).
 */
function buildCandidatesFromInspection(
  servers: Awaited<ReturnType<typeof inspectMcpServersForCapabilities>>,
): Partial<Record<SemanticCapabilityId, McpExecutionPathCandidate[]>> {
  const grouped: Partial<Record<SemanticCapabilityId, McpExecutionPathCandidate[]>> = {};
  for (const server of servers) {
    if (!server.reachable) continue;
    for (const tool of server.contributingTools) {
      for (const capabilityId of tool.semanticCapabilities) {
        const entry: McpExecutionPathCandidate = {
          capabilityId,
          serverName: server.name,
          toolName: tool.registeredToolName,
          label: `MCP ${capabilityId} via ${server.name}`,
        };
        const bucket = grouped[capabilityId] ?? [];
        bucket.push(entry);
        grouped[capabilityId] = bucket;
      }
    }
  }
  return grouped;
}

// ============================================================================
// Test 1: audio.analyze MCP capability proof
// ============================================================================

Deno.test({
  name: "MCP capability proof: audio.analyze discovery → routing → execution",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        // 1. Write MCP config pointing to fixture server with semantic_audio mode
        const server = fixtureServer("whisper-test", "semantic_audio");
        await writeMcpConfig([server]);

        // 2. Discovery: inspect MCP servers for semantic capabilities
        const inspected = await inspectMcpServersForCapabilities();
        const whisperServer = inspected.find((s) => s.name === "whisper-test");
        assert(whisperServer, "whisper-test server should be discovered");
        assert(whisperServer.reachable, "whisper-test server should be reachable");

        const audioTool = whisperServer.contributingTools.find(
          (t) => t.semanticCapabilities.includes("audio.analyze"),
        );
        assert(audioTool, "audio.analyze capability should be discovered from metadata");
        assertEquals(audioTool.rawToolName, "audio_transcribe");

        // 3. Routing: build execution surface with OpenAI pinned (no native audio) + MCP candidates
        const mcpCandidates = buildCandidatesFromInspection(inspected);
        assert(mcpCandidates["audio.analyze"]?.length, "MCP candidates should include audio.analyze");

        const surface = buildExecutionSurface({
          runtimeMode: "auto",
          activeModelId: "openai/gpt-4o",
          pinnedProviderName: "openai",
          providerExecutionPlan: buildMinimalPlan("openai"),
          turnContext: {
            attachmentCount: 1,
            attachmentKinds: ["audio"],
            visionEligibleAttachmentCount: 0,
            visionEligibleKinds: [],
            audioEligibleAttachmentCount: 1,
            audioEligibleKinds: ["audio"],
          },
          mcpCandidates,
        });

        const audioDecision = surface.capabilities["audio.analyze"];
        assertEquals(
          audioDecision.selectedBackendKind,
          "mcp",
          "audio.analyze should route to MCP when provider lacks native audio",
        );

        // 4. Execution: load MCP tools and call audio_transcribe
        const { tools, dispose } = await loadMcpTools(workspace, [server]);
        try {
          const audioToolName = tools.find((t) => t.includes("audio_transcribe"));
          assert(audioToolName, "audio_transcribe tool should be registered");
          assert(hasTool(audioToolName), `Tool ${audioToolName} should exist in registry`);

          const tool = getTool(audioToolName);
          const result = await tool.fn({ audio_data: "dGVzdA==", format: "mp3" }, workspace);
          const text = mcpText(result);
          assert(
            text.includes("Transcription:"),
            `Expected response containing 'Transcription:', got: ${text}`,
          );
          assert(
            text.includes("mp3"),
            `Expected response containing format 'mp3', got: ${text}`,
          );
        } finally {
          await dispose();
        }
      });
    });
  },
});

// ============================================================================
// Test 2: computer.use MCP capability proof
// ============================================================================

Deno.test({
  name: "MCP capability proof: computer.use discovery → routing → execution",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        // 1. Write MCP config pointing to fixture server with semantic_computer mode
        const server = fixtureServer("puppeteer-test", "semantic_computer");
        await writeMcpConfig([server]);

        // 2. Discovery: inspect MCP servers for semantic capabilities
        const inspected = await inspectMcpServersForCapabilities();
        const puppeteerServer = inspected.find((s) => s.name === "puppeteer-test");
        assert(puppeteerServer, "puppeteer-test server should be discovered");
        assert(puppeteerServer.reachable, "puppeteer-test server should be reachable");

        const computerTool = puppeteerServer.contributingTools.find(
          (t) => t.semanticCapabilities.includes("computer.use"),
        );
        assert(computerTool, "computer.use capability should be discovered from metadata");
        assertEquals(computerTool.rawToolName, "browser_interact");

        // 3. Routing: build execution surface with OpenAI pinned (no native computer.use) + MCP candidates
        const mcpCandidates = buildCandidatesFromInspection(inspected);
        assert(mcpCandidates["computer.use"]?.length, "MCP candidates should include computer.use");

        const surface = buildExecutionSurface({
          runtimeMode: "auto",
          activeModelId: "openai/gpt-4o",
          pinnedProviderName: "openai",
          providerExecutionPlan: buildMinimalPlan("openai"),
          computerUseRequested: true,
          mcpCandidates,
        });

        const computerDecision = surface.capabilities["computer.use"];
        assertEquals(
          computerDecision.selectedBackendKind,
          "mcp",
          "computer.use should route to MCP when provider lacks native computer.use",
        );

        // 4. Execution: load MCP tools and call browser_interact
        const { tools, dispose } = await loadMcpTools(workspace, [server]);
        try {
          const browserToolName = tools.find((t) => t.includes("browser_interact"));
          assert(browserToolName, "browser_interact tool should be registered");
          assert(hasTool(browserToolName), `Tool ${browserToolName} should exist in registry`);

          const tool = getTool(browserToolName);
          const result = await tool.fn(
            { action: "click", selector: "#submit-btn", value: "" },
            workspace,
          );
          const text = mcpText(result);
          assert(
            text.includes("Action completed:"),
            `Expected response containing 'Action completed:', got: ${text}`,
          );
          assert(
            text.includes("click"),
            `Expected response containing action 'click', got: ${text}`,
          );
          assert(
            text.includes("#submit-btn"),
            `Expected response containing selector '#submit-btn', got: ${text}`,
          );
        } finally {
          await dispose();
        }
      });
    });
  },
});

// ============================================================================
// Test 3: Multi-capability discovery from a single server
// ============================================================================

Deno.test({
  name: "MCP capability proof: multi-capability discovery (audio + computer from one server)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (_workspace) => {
        // 1. Write MCP config with both semantic_audio and semantic_computer modes
        const server = fixtureServer("multi-cap", "semantic_audio,semantic_computer");
        await writeMcpConfig([server]);

        // 2. Discovery: both capabilities should be discovered from one server
        const inspected = await inspectMcpServersForCapabilities();
        const multiServer = inspected.find((s) => s.name === "multi-cap");
        assert(multiServer, "multi-cap server should be discovered");
        assert(multiServer.reachable, "multi-cap server should be reachable");

        // Should have at least 3 tools: echo + audio_transcribe + browser_interact
        assert(
          multiServer.toolCount >= 3,
          `Expected at least 3 tools, got ${multiServer.toolCount}`,
        );

        // Both semantic capabilities should be discovered
        const allCapabilities = multiServer.contributingTools.flatMap(
          (t) => t.semanticCapabilities,
        );
        assert(
          allCapabilities.includes("audio.analyze"),
          "audio.analyze capability should be discovered",
        );
        assert(
          allCapabilities.includes("computer.use"),
          "computer.use capability should be discovered",
        );

        // 3. Verify MCP candidates cover both capabilities
        const mcpCandidates = buildCandidatesFromInspection(inspected);
        assert(
          mcpCandidates["audio.analyze"]?.length,
          "MCP candidates should include audio.analyze",
        );
        assert(
          mcpCandidates["computer.use"]?.length,
          "MCP candidates should include computer.use",
        );

        // 4. Both capabilities should route to MCP on a provider that lacks them
        const surface = buildExecutionSurface({
          runtimeMode: "auto",
          activeModelId: "openai/gpt-4o",
          pinnedProviderName: "openai",
          providerExecutionPlan: buildMinimalPlan("openai"),
          computerUseRequested: true,
          turnContext: {
            attachmentCount: 1,
            attachmentKinds: ["audio"],
            visionEligibleAttachmentCount: 0,
            visionEligibleKinds: [],
            audioEligibleAttachmentCount: 1,
            audioEligibleKinds: ["audio"],
          },
          mcpCandidates,
        });

        assertEquals(
          surface.capabilities["audio.analyze"].selectedBackendKind,
          "mcp",
          "audio.analyze should route to MCP",
        );
        assertEquals(
          surface.capabilities["computer.use"].selectedBackendKind,
          "mcp",
          "computer.use should route to MCP",
        );
      });
    });
  },
});

// ============================================================================
// Test 4: structured.output MCP capability proof
// ============================================================================

Deno.test({
  name: "MCP capability proof: structured.output discovery → routing → execution",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        // 1. Write MCP config pointing to fixture server with semantic_structured mode
        const server = fixtureServer("structured-proxy-test", "semantic_structured");
        await writeMcpConfig([server]);

        // 2. Discovery: inspect MCP servers for semantic capabilities
        const inspected = await inspectMcpServersForCapabilities();
        const structuredServer = inspected.find((s) => s.name === "structured-proxy-test");
        assert(structuredServer, "structured-proxy-test server should be discovered");
        assert(structuredServer.reachable, "structured-proxy-test server should be reachable");

        const structuredTool = structuredServer.contributingTools.find(
          (t) => t.semanticCapabilities.includes("structured.output"),
        );
        assert(structuredTool, "structured.output capability should be discovered from metadata");
        assertEquals(structuredTool.rawToolName, "structured_generate");

        // 3. Routing: build execution surface with Ollama pinned (no native structured) + MCP candidates
        const mcpCandidates = buildCandidatesFromInspection(inspected);
        assert(mcpCandidates["structured.output"]?.length, "MCP candidates should include structured.output");

        const surface = buildExecutionSurface({
          runtimeMode: "auto",
          activeModelId: "ollama/llama3.1:8b",
          pinnedProviderName: "ollama",
          providerExecutionPlan: buildMinimalPlan("ollama"),
          responseShapeContext: {
            requested: true,
            source: "task-text",
            topLevelKeys: ["name", "age"],
          },
          providerNativeStructuredOutputAvailable: false,
          mcpCandidates,
        });

        const structuredDecision = surface.capabilities["structured.output"];
        assertEquals(
          structuredDecision.selectedBackendKind,
          "mcp",
          "structured.output should route to MCP when provider lacks native structured output",
        );

        // 4. Execution: load MCP tools and call structured_generate
        const { tools, dispose } = await loadMcpTools(workspace, [server]);
        try {
          const structuredToolName = tools.find((t) => t.includes("structured_generate"));
          assert(structuredToolName, "structured_generate tool should be registered");
          assert(hasTool(structuredToolName), `Tool ${structuredToolName} should exist in registry`);

          const registeredTool = getTool(structuredToolName);

          // Test 1: schema with name+age → should produce {name: "test", age: 25}
          const result1 = await registeredTool.fn(
            { schema: { type: "object", properties: { name: { type: "string" }, age: { type: "number" } } }, prompt: "Generate a test person" },
            workspace,
          );
          const parsed1 = JSON.parse(mcpText(result1));
          assertEquals(parsed1.name, "test", "Expected string field to be 'test'");
          assertEquals(parsed1.age, 25, "Expected number field to be 25");

          // Test 2: different schema → should produce different keys (proves input drives output)
          const result2 = await registeredTool.fn(
            { schema: { type: "object", properties: { title: { type: "string" }, count: { type: "number" }, active: { type: "boolean" } } }, prompt: "Generate metadata" },
            workspace,
          );
          const parsed2 = JSON.parse(mcpText(result2));
          assertEquals(parsed2.title, "test", "Expected title string");
          assertEquals(parsed2.count, 25, "Expected count number");
          assertEquals(parsed2.active, true, "Expected active boolean");
          assertEquals(parsed2.name, undefined, "Schema keys from test 1 should not appear");
        } finally {
          await dispose();
        }
      });
    });
  },
});
