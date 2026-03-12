import { assertEquals, assertRejects } from "jsr:@std/assert";
import { getMcpConfigPath } from "../../../src/common/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  inferMcpSafetyLevel,
  loadMcpConfig,
  loadMcpTools,
} from "../../../src/hlvm/agent/mcp/mod.ts";
import {
  getTool,
  hasTool,
  prepareToolArgsForExecution,
} from "../../../src/hlvm/agent/registry.ts";
import {
  sanitizeToolName,
  validateToolSchema,
} from "../../../src/hlvm/agent/tool-schema.ts";
import { withTempHlvmDir } from "../helpers.ts";

type FixtureServerOptions = {
  allowEnv?: string[];
  env?: Record<string, string>;
  disabled_tools?: string[];
  connection_timeout_ms?: number;
};

function fixturePath(): string {
  return getPlatform().path.join("tests", "fixtures", "mcp-server.ts");
}

function fixtureServer(name: string, options: FixtureServerOptions = {}) {
  const allowEnv = options.allowEnv?.length
    ? [`--allow-env=${options.allowEnv.join(",")}`]
    : [];

  return {
    name,
    command: ["deno", "run", ...allowEnv, fixturePath()],
    ...(options.env ? { env: options.env } : {}),
    ...(options.disabled_tools
      ? { disabled_tools: options.disabled_tools }
      : {}),
    ...(options.connection_timeout_ms
      ? { connection_timeout_ms: options.connection_timeout_ms }
      : {}),
  };
}

async function withWorkspace(
  fn: (workspace: string) => Promise<void>,
): Promise<void> {
  const platform = getPlatform();
  const workspace = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-test-" });
  try {
    await fn(workspace);
  } finally {
    await platform.fs.remove(workspace, { recursive: true });
  }
}

async function writeMcpConfig(servers: unknown): Promise<void> {
  const platform = getPlatform();
  await platform.fs.writeTextFile(
    getMcpConfigPath(),
    JSON.stringify({ version: 1, servers }),
  );
}

/** Extract text from MCP-compliant tool result. */
function mcpText(result: unknown): string {
  const payload = result as { content: Array<{ type: string; text: string }> };
  return payload.content[0].text;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

Deno.test("MCP: loadMcpConfig returns null when no config exists", async () => {
  await withTempHlvmDir(async () => {
    assertEquals(await loadMcpConfig(), null);
  });
});

Deno.test({
  name:
    "MCP: loadMcpTools registers fixture tools, validates args, executes, and disposes cleanly",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        await writeMcpConfig([fixtureServer("test")]);

        const { tools, dispose } = await loadMcpTools(workspace);
        try {
          assertEquals(tools.includes("mcp_test_echo"), true);
          assertEquals(hasTool("mcp_test_echo"), true);
          assertEquals(
            prepareToolArgsForExecution("mcp_test_echo", {}).validation.valid,
            true,
          );

          const tool = getTool("mcp_test_echo");
          assertEquals(
            mcpText(await tool.fn({ message: "hello" }, workspace)),
            "hello",
          );
          await assertRejects(() =>
            tool.fn("bad" as unknown as Record<string, unknown>, workspace)
          );
        } finally {
          await dispose();
        }

        assertEquals(hasTool("mcp_test_echo"), false);
      });
    });
  },
});

Deno.test({
  name:
    "MCP: owner-scoped registrations route tool calls and survive independent disposal",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        const first = await loadMcpTools(
          workspace,
          [fixtureServer("test", {
            allowEnv: ["MCP_REPLY_PREFIX"],
            env: { MCP_REPLY_PREFIX: "A:" },
          })],
          "owner-a",
        );
        const second = await loadMcpTools(
          workspace,
          [fixtureServer("test", {
            allowEnv: ["MCP_REPLY_PREFIX"],
            env: { MCP_REPLY_PREFIX: "B:" },
          })],
          "owner-b",
        );

        try {
          assertEquals(
            mcpText(
              await getTool("mcp_test_echo", "owner-a").fn(
                { message: "hello" },
                workspace,
              ),
            ),
            "A:hello",
          );
          assertEquals(
            mcpText(
              await getTool("mcp_test_echo", "owner-b").fn(
                { message: "hello" },
                workspace,
              ),
            ),
            "B:hello",
          );

          await first.dispose();
          assertEquals(hasTool("mcp_test_echo", "owner-a"), false);
          assertEquals(hasTool("mcp_test_echo", "owner-b"), true);
          assertEquals(
            mcpText(
              await getTool("mcp_test_echo", "owner-b").fn(
                { message: "ok" },
                workspace,
              ),
            ),
            "B:ok",
          );
        } finally {
          await first.dispose();
          await second.dispose();
        }
      });
    });
  },
});

Deno.test({
  name:
    "MCP: config servers win dedupe and broken servers do not block healthy ones",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withWorkspace(async (workspace) => {
        await writeMcpConfig([fixtureServer("test")]);

        const { tools, dispose } = await loadMcpTools(
          workspace,
          [
            { name: "broken", command: ["definitely-not-a-real-command"] },
            { name: "test", command: ["definitely-not-a-real-command"] },
          ],
        );

        try {
          assertEquals(tools.includes("mcp_test_echo"), true);
          assertEquals(hasTool("mcp_test_echo"), true);
        } finally {
          await dispose();
        }
      });
    });
  },
});

Deno.test("MCP: safety inference and schema normalization keep tool metadata provider-safe", () => {
  assertEquals(inferMcpSafetyLevel("render_url"), "L0");
  assertEquals(inferMcpSafetyLevel("click_button"), "L2");
  assertEquals(inferMcpSafetyLevel("custom_tool_without_hint"), "L1");

  assertEquals(
    sanitizeToolName("mcp_server.name/tool"),
    "mcp_server_name_tool",
  );
  assertEquals(sanitizeToolName("a" + "_x".repeat(80)).length, 64);
  assertEquals(/^[a-zA-Z]/.test(sanitizeToolName("123_tool")), true);

  const badTool = {
    fn: async () => {},
    description: "test",
    args: { x: "banana - weird" },
  };
  const goodTool = {
    fn: async () => {},
    description: "test",
    args: { a: "string - ok", b: "number (optional) - ok" },
  };
  assertEquals(validateToolSchema("t", badTool).length, 1);
  assertEquals(validateToolSchema("t", goodTool).length, 0);
});

Deno.test({
  name:
    "MCP: capability-gated resource and prompt tools register only when the server exposes them",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withWorkspace(async (workspace) => {
      const { tools, dispose } = await loadMcpTools(workspace, [
        fixtureServer("restest", {
          allowEnv: ["MCP_TEST_MODE"],
          env: { MCP_TEST_MODE: "resources" },
        }),
        fixtureServer("ptest", {
          allowEnv: ["MCP_TEST_MODE"],
          env: { MCP_TEST_MODE: "prompts" },
        }),
        fixtureServer("plain"),
      ]);

      try {
        assertEquals(tools.includes("mcp_restest_list_resources"), true);
        assertEquals(tools.includes("mcp_restest_read_resource"), true);
        assertEquals(tools.includes("mcp_ptest_list_prompts"), true);
        assertEquals(tools.includes("mcp_ptest_get_prompt"), true);
        assertEquals(tools.includes("mcp_plain_list_resources"), false);
        assertEquals(tools.includes("mcp_plain_get_prompt"), false);

        const resources = await getTool("mcp_restest_list_resources").fn(
          {},
          workspace,
        ) as {
          resources: Array<{ uri: string }>;
        };
        assertEquals(resources.resources.length, 2);

        const prompt = await getTool("mcp_ptest_get_prompt").fn(
          { name: "summarize", text: "Hello world", style: "brief" },
          workspace,
        ) as { messages: string };
        assertEquals(prompt.messages.includes("Summarize: Hello world"), true);
      } finally {
        await dispose();
      }
    });
  },
});

Deno.test({
  name:
    "MCP: deferred setHandlers replays queued sampling and elicitation requests",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withWorkspace(async (workspace) => {
      const result = await loadMcpTools(workspace, [
        fixtureServer("interactive", {
          allowEnv: ["MCP_TEST_MODE"],
          env: { MCP_TEST_MODE: "sampling,elicitation" },
        }),
      ]);

      let samplingCalled = false;
      let elicitationMessage = "";
      result.setHandlers({
        onSampling: (request) => {
          samplingCalled = Array.isArray(request.messages);
          return Promise.resolve({
            role: "assistant" as const,
            content: { type: "text" as const, text: "The answer is 4" },
            model: "test-model",
          });
        },
        onElicitation: (request) => {
          elicitationMessage = request.message;
          return Promise.resolve({
            action: "accept" as const,
            content: { confirmed: true },
          });
        },
      });

      try {
        await waitFor(() => samplingCalled && elicitationMessage.length > 0);
        assertEquals(samplingCalled, true);
        assertEquals(elicitationMessage, "Please confirm deployment");
      } finally {
        await result.dispose();
      }
    });
  },
});

Deno.test({
  name: "MCP: setSignal aborts in-flight tool calls promptly",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withWorkspace(async (workspace) => {
      const { dispose, ownerId, setSignal } = await loadMcpTools(workspace, [
        fixtureServer("abortable", {
          allowEnv: ["MCP_TOOL_DELAY_MS"],
          env: { MCP_TOOL_DELAY_MS: "5000" },
        }),
      ]);

      const controller = new AbortController();
      setSignal(controller.signal);

      const tool = getTool("mcp_abortable_echo", ownerId);
      const startedAt = Date.now();
      const abortTimer = setTimeout(() => controller.abort(), 50);
      try {
        const error = await assertRejects(
          () => tool.fn({ message: "hello" }, workspace),
          Error,
        );
        const elapsed = Date.now() - startedAt;
        const aborted = error.name === "AbortError" ||
          error.message.toLowerCase().includes("abort");
        assertEquals(aborted, true);
        assertEquals(elapsed < 1500, true);
      } finally {
        clearTimeout(abortTimer);
        await dispose();
      }
    });
  },
});

Deno.test({
  name:
    "MCP: disabled_tools excludes configured server tools from registration",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withWorkspace(async (workspace) => {
      const { tools, dispose } = await loadMcpTools(workspace, [
        fixtureServer("filtered", { disabled_tools: ["echo"] }),
      ]);

      try {
        assertEquals(tools.includes("mcp_filtered_echo"), false);
        assertEquals(hasTool("mcp_filtered_echo"), false);
      } finally {
        await dispose();
      }
    });
  },
});
