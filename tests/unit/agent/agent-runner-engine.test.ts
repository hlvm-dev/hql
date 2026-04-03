import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import {
  createReusableSession,
  disposeAllSessions,
  reuseSession,
  runAgentQuery,
  shouldReuseAgentSession,
} from "../../../src/hlvm/agent/agent-runner.ts";
import {
  buildExecutionSurface,
} from "../../../src/hlvm/agent/execution-surface.ts";
import { SdkAgentEngine } from "../../../src/hlvm/agent/engine-sdk.ts";
import {
  type AgentEngine,
  resetAgentEngine,
  setAgentEngine,
} from "../../../src/hlvm/agent/engine.ts";
import type { AgentUIEvent } from "../../../src/hlvm/agent/orchestrator.ts";
import { createAgentSession } from "../../../src/hlvm/agent/session.ts";
import { resolveProviderExecutionPlan } from "../../../src/hlvm/agent/tool-capabilities.ts";
import type { ConversationAttachmentPayload } from "../../../src/hlvm/attachments/types.ts";
import { ValidationError } from "../../../src/common/error.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { generateUUID } from "../../../src/common/utils.ts";

async function withEngineOverride(
  engine: AgentEngine,
  fn: () => Promise<void>,
): Promise<void> {
  setAgentEngine(engine);
  try {
    await fn();
  } finally {
    resetAgentEngine();
    await disposeAllSessions();
  }
}

Deno.test({
  name: "agent-runner: default engine wires SdkAgentEngine",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    resetAgentEngine();
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-sdk-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });
    try {
      const session = await createReusableSession(
        workspace,
        "ollama/llama3.2:1b",
        // Prevent provider model discovery/network calls in unit test.
        { modelInfo: null },
      );
      assertExists(session.engine);
      assertEquals(session.engine instanceof SdkAgentEngine, true);
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name: "agent-runner: setAgentEngine override is respected",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-legacy-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });
    try {
      const custom: AgentEngine = {
        createLLM: () => () => Promise.resolve({ content: "", toolCalls: [] }),
        createSummarizer: () => () => Promise.resolve(""),
      };
      await withEngineOverride(custom, async () => {
        const session = await createReusableSession(
          workspace,
          "ollama/llama3.2:1b",
          { modelInfo: null },
        );
        assertExists(session.engine);
        assertEquals(session.engine, custom);
      });
    } finally {
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: reusable sessions are fresh even for same workspace and model",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspaceA = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-cache-a-${generateUUID()}`,
    );
    const workspaceB = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-cache-b-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspaceA, { recursive: true });
    await platform.fs.mkdir(workspaceB, { recursive: true });

    try {
      const model = "ollama/llama3.2:1b";
      const sessionA1 = await createReusableSession(workspaceA, model, {
        modelInfo: null,
      });
      const sessionA2 = await createReusableSession(workspaceA, model, {
        modelInfo: null,
      });
      const sessionB = await createReusableSession(workspaceB, model, {
        modelInfo: null,
      });

      assertEquals(sessionA1 === sessionA2, false);
      assertEquals(sessionA1 === sessionB, false);
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspaceA, { recursive: true });
      await platform.fs.remove(workspaceB, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: reusable sessions stay distinct across different option sets",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-cache-opts-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    try {
      const model = "ollama/llama3.2:1b";
      const base = await createReusableSession(workspace, model, {
        modelInfo: null,
      });
      const withContext = await createReusableSession(workspace, model, {
        contextWindow: 32768,
        modelInfo: null,
      });
      const withAllowlist = await createReusableSession(workspace, model, {
        toolAllowlist: ["search_web", "web_fetch"],
        modelInfo: null,
      });
      const withDenylist = await createReusableSession(workspace, model, {
        toolDenylist: ["read_file", "shell_exec"],
        modelInfo: null,
      });

      assertEquals(base === withContext, false);
      assertEquals(base === withAllowlist, false);
      assertEquals(base === withDenylist, false);
      assertEquals(withContext === withAllowlist, false);
      assertEquals(withContext === withDenylist, false);
      assertEquals(withAllowlist === withDenylist, false);
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: reusable sessions are not reused across model or denylist changes",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-cache-model-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    try {
      const session = await createReusableSession(
        workspace,
        "claude-code/claude-opus-4-6",
        {
          toolDenylist: ["complete_task"],
          modelInfo: null,
        },
      );

      assertEquals(
        shouldReuseAgentSession(session, {
          model: "claude-code/claude-opus-4-6",
          toolDenylist: ["complete_task"],
        }),
        true,
      );
      assertEquals(
        shouldReuseAgentSession(session, {
          model: "ollama/llama3.2:3b",
          toolDenylist: ["complete_task"],
        }),
        false,
      );
      assertEquals(
        shouldReuseAgentSession(session, {
          model: "claude-code/claude-opus-4-6",
          toolDenylist: ["ask_user", "complete_task"],
        }),
        false,
      );
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: reusable sessions retain the cached provider execution plan across reuse",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-cache-web-plan-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    try {
      const session = await createReusableSession(
        workspace,
        "ollama/llama3.2:3b",
        {
          toolAllowlist: ["web_search", "web_fetch"],
          modelInfo: null,
        },
      );
      const reused = await reuseSession(session);

      assertEquals(!!session.providerExecutionPlan, true);
      assertEquals(!!session.webCapabilityPlan, true);
      assertEquals(
        session.llmConfig?.providerExecutionPlan ===
          session.providerExecutionPlan,
        true,
      );
      assertEquals(
        reused.providerExecutionPlan === session.providerExecutionPlan,
        true,
      );
      assertEquals(
        reused.webCapabilityPlan === session.webCapabilityPlan,
        true,
      );
      assertEquals(
        reused.llmConfig?.providerExecutionPlan ===
          session.providerExecutionPlan,
        true,
      );
      assertEquals(
        reused.providerExecutionPlan?.routingProfile,
        "conservative",
      );
      assertEquals(
        reused.webCapabilityPlan?.capabilities.web_search.implementation,
        "custom",
      );
      assertEquals(
        reused.webCapabilityPlan?.capabilities.web_page_read.implementation,
        "custom",
      );
      assertEquals(
        reused.webCapabilityPlan?.capabilities.raw_url_fetch.implementation,
        "disabled",
      );
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: reusable sessions are not reused when turn attachment context changes the execution surface",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-cache-vision-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    try {
      const session = await createReusableSession(
        workspace,
        "anthropic/claude-sonnet-4-5-20250929",
        {
          modelInfo: { name: "claude-sonnet-4-5-20250929", capabilities: ["chat", "tools", "vision"] },
        },
      );
      const providerExecutionPlan = resolveProviderExecutionPlan({
        providerName: "anthropic",
        nativeCapabilities: {
          webSearch: false,
          webPageRead: false,
          remoteCodeExecution: false,
        },
      });
      const turnScopedSurface = buildExecutionSurface({
        runtimeMode: "auto",
        activeModelId: "anthropic/claude-sonnet-4-5-20250929",
        pinnedProviderName: "anthropic",
        providerExecutionPlan,
        turnContext: {
          attachmentCount: 1,
          attachmentKinds: ["image"],
          visionEligibleAttachmentCount: 1,
          visionEligibleKinds: ["image"],
          audioEligibleAttachmentCount: 0,
          audioEligibleKinds: [],
        },
        directVisionKinds: ["image"],
      });

      assertEquals(
        shouldReuseAgentSession(session, {
          model: "anthropic/claude-sonnet-4-5-20250929",
          executionSurfaceSignature: turnScopedSurface.signature,
        }),
        false,
      );
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: reuseSession refreshes execution-surface prompt metadata while preserving file-state cache",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-reuse-refresh-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    try {
      const model = "anthropic/claude-sonnet-4-5-20250929";
      const session = await createReusableSession(workspace, model, {
        modelInfo: {
          name: "claude-sonnet-4-5-20250929",
          capabilities: ["chat", "tools", "vision"],
        },
      });
      session.fileStateCache.trackRead({
        path: platform.path.join(workspace, "tracked.txt"),
        content: "tracked",
      });

      const providerExecutionPlan = resolveProviderExecutionPlan({
        providerName: "anthropic",
        nativeCapabilities: {
          webSearch: false,
          webPageRead: false,
          remoteCodeExecution: false,
        },
      });
      const turnScopedSurface = buildExecutionSurface({
        runtimeMode: "auto",
        activeModelId: model,
        pinnedProviderName: "anthropic",
        providerExecutionPlan,
        turnContext: {
          attachmentCount: 1,
          attachmentKinds: ["image"],
          visionEligibleAttachmentCount: 1,
          visionEligibleKinds: ["image"],
          audioEligibleAttachmentCount: 0,
          audioEligibleKinds: [],
        },
        directVisionKinds: ["image"],
      });

      const reused = await reuseSession(session, undefined, {
        runtimeMode: "auto",
        providerExecutionPlan,
        executionSurface: turnScopedSurface,
      });

      assertEquals(reused.fileStateCache, session.fileStateCache);
      assertExists(reused.fileStateCache.get(
        platform.path.join(workspace, "tracked.txt"),
      ));
      assertEquals(reused.executionSurface.signature, turnScopedSurface.signature);
      assertEquals(
        reused.llmConfig?.executionSurface?.signature,
        turnScopedSurface.signature,
      );
      assertEquals(
        reused.compiledPromptMeta?.signatureHash ===
          session.compiledPromptMeta?.signatureHash,
        false,
      );
    } finally {
      await disposeAllSessions();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: runAgentQuery reuses an explicit reusable session across turn-scoped surface changes",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-run-query-reuse-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    let observedToolOwnerId: string | undefined;
    let observedAttachmentCount = 0;
    const engine: AgentEngine = {
      createLLM: (config) => async () => {
        observedToolOwnerId = config.toolOwnerId;
        observedAttachmentCount =
          config.executionSurface?.turnContext?.attachmentCount ?? 0;
        return {
          content:
            `owner=${config.toolOwnerId};attachments=${String(observedAttachmentCount)}`,
          toolCalls: [],
        };
      },
      createSummarizer: () => () => Promise.resolve(""),
    };

    try {
      await withEngineOverride(engine, async () => {
        const model = "anthropic/claude-sonnet-4-5-20250929";
        const reusableSession = await createAgentSession({
          workspace,
          model,
          modelInfo: {
            name: "claude-sonnet-4-5-20250929",
            capabilities: ["chat", "tools", "vision"],
          },
          runtimeMode: "manual",
        });
        const attachments: ConversationAttachmentPayload[] = [{
          mode: "binary",
          attachmentId: "img-1",
          fileName: "photo.png",
          mimeType: "image/png",
          kind: "image",
          conversationKind: "image",
          size: 4,
          data: "AA==",
        }];

        const result = await runAgentQuery({
          query: "Describe the attached image in one sentence.",
          model,
          modelInfo: {
            name: "claude-sonnet-4-5-20250929",
            capabilities: ["chat", "tools", "vision"],
          },
          workspace,
          reusableSession,
          runtimeMode: "manual",
          attachments,
          callbacks: {},
        });

        assertEquals(
          result.text,
          `owner=${reusableSession.toolOwnerId};attachments=1`,
        );
        assertEquals(observedToolOwnerId, reusableSession.toolOwnerId);
        assertEquals(observedAttachmentCount, 1);
      });
    } finally {
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: auto-mode emits web.search capability_routed from final response metadata when provider-native search returns text-only output",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-provider-search-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    const events: AgentUIEvent[] = [];
    const providerNativeSearchEngine: AgentEngine = {
      createLLM: () =>
        () =>
          Promise.resolve({
            content:
              'The latest post is "Introducing Deno Sandbox" at https://deno.com/blog/introducing-deno-sandbox.',
            toolCalls: [],
            sources: [{
              id: "src-deno-blog",
              sourceType: "url",
              url: "https://deno.com/blog/introducing-deno-sandbox",
              title: "Introducing Deno Sandbox",
            }],
            providerMetadata: { google: { groundingMetadata: {} } },
          }),
      createSummarizer: () => () => Promise.resolve(""),
    };

    try {
      await withEngineOverride(providerNativeSearchEngine, async () => {
        const result = await runAgentQuery({
          query:
            "Use live web search right now to find the latest post on the official Deno blog.",
          model: "google/gemini-2.5-flash",
          modelInfo: null,
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
          workspace,
          runtimeMode: "auto",
          toolAllowlist: ["web_search"],
          disablePersistentMemory: true,
        });

        const routed = events.find((event): event is Extract<
          AgentUIEvent,
          { type: "capability_routed" }
        > =>
          event.type === "capability_routed" &&
          event.capabilityId === "web.search"
        );
        assertExists(routed);
        assertEquals(routed.routePhase, "tool-start");
        assertEquals(routed.selectedBackendKind, "provider-native");
        assertEquals(routed.selectedToolName, "web_search");
        assertEquals(
          result.finalResponseMeta?.citationSpans.some((citation) =>
            citation.provenance === "provider"
          ),
          true,
        );
      });
    } finally {
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: repl main-thread persists deferred tool discovery across reusable turns",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = platform.path.join(
      platform.process.cwd(),
      ".tmp",
      `hlvm-agent-main-thread-discovery-${generateUUID()}`,
    );
    await platform.fs.mkdir(workspace, { recursive: true });

    const observedAllowlists: Array<string[] | undefined> = [];
    let llmFactoryCount = 0;
    const engine: AgentEngine = {
      createLLM: (config) => {
        llmFactoryCount += 1;
        observedAllowlists.push(config.toolAllowlist ? [...config.toolAllowlist] : undefined);
        const factoryIndex = llmFactoryCount;
        let callCount = 0;
        return async () => {
          callCount += 1;
          if (factoryIndex === 2 && callCount === 1) {
            return {
              content: "",
              toolCalls: [{
                toolName: "tool_search",
                args: { query: "web search", limit: 1 },
              }],
            };
          }
          return { content: "done", toolCalls: [] };
        };
      },
      createSummarizer: () => () => Promise.resolve(""),
    };

    let reusableSession: Awaited<ReturnType<typeof createAgentSession>> | null = null;
    try {
      reusableSession = await createAgentSession({
        workspace,
        model: "anthropic/claude-sonnet-4-5-20250929",
        modelInfo: {
          name: "claude-sonnet-4-5-20250929",
          capabilities: ["chat", "tools"],
        },
        engine,
        querySource: "repl_main_thread",
      });

      await runAgentQuery({
        query: "Find the web tool",
        model: "anthropic/claude-sonnet-4-5-20250929",
        modelInfo: {
          name: "claude-sonnet-4-5-20250929",
          capabilities: ["chat", "tools"],
        },
        workspace,
        querySource: "repl_main_thread",
        reusableSession,
        skipSessionHistory: true,
        callbacks: {},
      });

      assertEquals(reusableSession.discoveredDeferredTools.has("search_web"), true);
      assertEquals(reusableSession.llmConfig?.toolAllowlist?.includes("search_web"), true);

      await runAgentQuery({
        query: "Answer directly",
        model: "anthropic/claude-sonnet-4-5-20250929",
        modelInfo: {
          name: "claude-sonnet-4-5-20250929",
          capabilities: ["chat", "tools"],
        },
        workspace,
        querySource: "repl_main_thread",
        reusableSession,
        skipSessionHistory: true,
        callbacks: {},
      });

      assertEquals(observedAllowlists[2]?.includes("search_web"), true);
    } finally {
      await reusableSession?.dispose();
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent-runner: runAgentQuery rejects weak models before agent execution",
  async fn() {
    await assertRejects(
      () =>
        runAgentQuery({
          query: "search the web for latest release notes",
          model: "ollama/llama3.2:1b",
          modelInfo: { name: "llama3.2:1b", parameterSize: "7B" },
          callbacks: {},
          workspace: getPlatform().process.cwd(),
        }),
      ValidationError,
      "Weak models do not support agent mode",
    );
  },
});
