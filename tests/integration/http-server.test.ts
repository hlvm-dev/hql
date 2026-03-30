import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import { Database } from "@db/sqlite";
import type { Message as AgentMessage } from "../../src/hlvm/agent/context.ts";
import { setAgentEngine } from "../../src/hlvm/agent/engine.ts";
import type {
  AgentEngine,
  AgentLLMConfig,
} from "../../src/hlvm/agent/engine.ts";
import { persistLastAppliedExecutionFallbackState } from "../../src/hlvm/agent/persisted-transcript.ts";
import { config } from "../../src/hlvm/api/config.ts";
import { startHttpServer } from "../../src/hlvm/cli/repl/http-server.ts";
import { getConversationsDbPath } from "../../src/common/paths.ts";
import { initializeRuntime } from "../../src/common/runtime-initializer.ts";
import {
  type AIProvider,
  type Message as ProviderMessage,
  type ModelInfo,
  registerProvider,
  setDefaultProvider,
} from "../../src/hlvm/providers/index.ts";
import { insertMessage } from "../../src/hlvm/store/conversation-store.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import { findFreePort } from "../shared/light-helpers.ts";
import { withTempHlvmDir } from "../unit/helpers.ts";
import { overrideTool } from "../unit/agent/test-helpers.ts";

class IntegrationAgentEngine implements AgentEngine {
  createLLM(config: AgentLLMConfig) {
    return (messages: AgentMessage[]) => {
      const sawToolResult = messages.some((message) =>
        message.role === "tool" ||
        message.content.includes("observed-from-tool")
      );
      const lastUserMessage = [...messages].reverse().find((message) =>
        message.role === "user"
      );
      if (
        !sawToolResult &&
        (lastUserMessage?.content ?? "").includes("mixed-task coherence probe")
      ) {
        return Promise.resolve({
          content: "",
          toolCalls: [{
            toolName: "search_web",
            args: { query: "hlvm mixed-task coherence docs" },
          }],
          usage: { inputTokens: 8, outputTokens: 4 },
        });
      }
      const text = sawToolResult
        ? "integration-agent-saw-tool"
        : `integration-agent:${lastUserMessage?.content ?? "ok"}`;
      config.onToken?.(text);
      return Promise.resolve({
        content: text,
        toolCalls: [],
        usage: { inputTokens: 8, outputTokens: 4 },
      });
    };
  }

  createSummarizer(_model?: string) {
    return (_messages: AgentMessage[]) =>
      Promise.resolve("integration-summary");
  }
}

const INTEGRATION_MODEL: ModelInfo = {
  name: "plain",
  contextWindow: 65_536,
  capabilities: ["chat", "tools"],
};

const INTEGRATION_TOOLLESS_MODEL: ModelInfo = {
  name: "basic",
  contextWindow: 65_536,
  capabilities: ["chat"],
};

const INTEGRATION_VISION_MODEL: ModelInfo = {
  name: "vision",
  contextWindow: 65_536,
  capabilities: ["chat", "tools", "vision"],
};

const integrationProvider: AIProvider = {
  name: "test-chat",
  displayName: "Test Chat",
  capabilities: ["chat", "generate", "tools"],
  async *generate(prompt: string) {
    yield `generated:${prompt}`;
  },
  async *chat(messages: ProviderMessage[]) {
    yield getIntegrationChatReply(messages);
  },
  models: {
    list() {
      return Promise.resolve([
        INTEGRATION_MODEL,
        INTEGRATION_TOOLLESS_MODEL,
        INTEGRATION_VISION_MODEL,
      ]);
    },
    get(name: string) {
      if (name === INTEGRATION_MODEL.name) {
        return Promise.resolve(INTEGRATION_MODEL);
      }
      if (name === INTEGRATION_TOOLLESS_MODEL.name) {
        return Promise.resolve(INTEGRATION_TOOLLESS_MODEL);
      }
      if (name === INTEGRATION_VISION_MODEL.name) {
        return Promise.resolve(INTEGRATION_VISION_MODEL);
      }
      return Promise.resolve(null);
    },
  },
  status() {
    return Promise.resolve({ available: true });
  },
};

interface ServerContext {
  baseUrl: string;
  authToken: string;
}

let serverContext: ServerContext | null = null;

async function shutdownServer(): Promise<void> {
  if (!serverContext) return;
  const { baseUrl, authToken } = serverContext;
  serverContext = null;
  try {
    await fetch(`${baseUrl}/api/runtime/shutdown`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
  } catch {
    // Best-effort cleanup only.
  }
}

async function withIsolatedServerTest(fn: () => Promise<void>): Promise<void> {
  await withTempHlvmDir(async () => {
    serverContext = null;
    await config.reload();
    await config.patch({
      model: "test-chat/plain",
      modelConfigured: true,
      agentMode: "hlvm",
    });
    try {
      await fn();
    } finally {
      await shutdownServer();
      serverContext = null;
    }
  });
}

async function ensureServerRunning(): Promise<ServerContext> {
  if (serverContext) return serverContext;

  const port = await findFreePort();
  const baseUrl = `http://localhost:${port}`;
  const authToken = "hlvm-integration-test-token";

  const env = getPlatform().env;
  env.set("HLVM_DISABLE_AI_AUTOSTART", "1");
  env.set("HLVM_AUTH_TOKEN", authToken);

  registerProvider("test-chat", () => integrationProvider, { isDefault: true });
  setDefaultProvider("test-chat");
  setAgentEngine(new IntegrationAgentEngine());

  await initializeRuntime({ ai: true, stdlib: true, cache: true });
  startHttpServer({ port });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const health = await fetch(`${baseUrl}/health`);
  if (!health.ok) {
    throw new Error("Server failed to start");
  }

  serverContext = { baseUrl, authToken };
  return serverContext;
}

function getIntegrationChatReply(messages: ProviderMessage[]): string {
  const hasPirateSystemMessage = messages.some((message) =>
    message.role === "system" && message.content.includes("Speak like a pirate")
  );
  if (hasPirateSystemMessage) {
    return "arrr";
  }

  const memorySystemMessage =
    messages.find((message) =>
      message.role === "system" && message.content.startsWith("# Your Memory")
    )?.content ?? "";

  const historicalToolSummary =
    messages.find((message) =>
      message.role === "assistant" &&
      message.content.includes("Prior tool result")
    )?.content ?? "";
  if (historicalToolSummary.includes("observed-from-tool")) {
    return "saw-tool";
  }

  const priorAssistant = [...messages].reverse().find((message) =>
    message.role === "assistant" && message.content.startsWith("reply:")
  )?.content;
  const lastUser =
    [...messages].reverse().find((message) => message.role === "user")
      ?.content ?? "";
  const markerMatch = lastUser.match(/memory-marker:([A-Za-z0-9-]+)/);
  if (markerMatch && memorySystemMessage.includes(markerMatch[0])) {
    return `memory:${markerMatch[0]}`;
  }

  if (lastUser === "second" && priorAssistant) {
    return `history:${priorAssistant}`;
  }

  return `reply:${lastUser}`;
}

async function postChatNdjson(body: unknown): Promise<{
  status: number;
  contentType: string;
  events: Array<Record<string, unknown>>;
}> {
  const { baseUrl, authToken } = await ensureServerRunning();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const events = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    events,
  };
}

async function fetchActiveChatMessages(): Promise<Array<{
  role: string;
  content: string;
}>> {
  const { baseUrl, authToken } = await ensureServerRunning();
  const response = await fetch(
    `${baseUrl}/api/chat/messages?limit=50&offset=0&sort=asc`,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    },
  );
  const body = await response.json() as {
    messages: Array<{ role: string; content: string }>;
  };
  return body.messages;
}

async function fetchActiveChatMessageRows(): Promise<Array<{
  role: string;
  content: string;
  request_id: string | null;
  sender_type: string | null;
}>> {
  const { baseUrl, authToken } = await ensureServerRunning();
  const response = await fetch(
    `${baseUrl}/api/chat/messages?limit=50&offset=0&sort=asc`,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    },
  );
  const body = await response.json() as {
    messages: Array<{
      role: string;
      content: string;
      request_id: string | null;
      sender_type: string | null;
    }>;
  };
  return body.messages;
}

async function readFirstActiveConversationStreamEvent(): Promise<{
  event: string;
  data: unknown;
}> {
  const { baseUrl, authToken } = await ensureServerRunning();
  const response = await fetch(`${baseUrl}/api/chat/stream`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  assertEquals(response.status, 200);
  assertStringIncludes(
    response.headers.get("content-type") ?? "",
    "text/event-stream",
  );

  const reader = response.body?.getReader();
  assertExists(reader);

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary < 0) {
          break;
        }
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = rawEvent.split("\n").find((line) =>
          line.startsWith("event: ")
        )?.slice("event: ".length);
        if (!event) {
          continue;
        }
        const data = rawEvent.split("\n").find((line) =>
          line.startsWith("data: ")
        )?.slice("data: ".length) ?? "null";
        return {
          event,
          data: JSON.parse(data),
        };
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  throw new Error("No SSE event received");
}

async function getActiveRuntimeMode(): Promise<{
  status: number;
  body: { session_id: string; runtime_mode: string };
}> {
  const { baseUrl, authToken } = await ensureServerRunning();
  const response = await fetch(`${baseUrl}/api/chat/runtime-mode`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
  return {
    status: response.status,
    body: await response.json() as {
      session_id: string;
      runtime_mode: string;
    },
  };
}

async function setActiveRuntimeMode(mode: "manual" | "auto"): Promise<{
  status: number;
  body: { session_id: string; runtime_mode: string };
}> {
  const { baseUrl, authToken } = await ensureServerRunning();
  const response = await fetch(`${baseUrl}/api/chat/runtime-mode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      runtime_mode: mode,
    }),
  });
  return {
    status: response.status,
    body: await response.json() as {
      session_id: string;
      runtime_mode: string;
    },
  };
}

async function getActiveExecutionSurface(): Promise<{
  status: number;
  body: {
    session_id: string;
    runtime_mode: string;
    active_model_id?: string;
    pinned_provider_name: string;
    strategy: string;
    signature: string;
    constraints: {
      hardConstraints: string[];
      preference?: string;
      preferenceConflict: boolean;
      source: string;
    };
    task_capability_context: {
      requestedCapabilities: string[];
      source: string;
      matchedCueLabels: string[];
    };
    response_shape_context: {
      requested: boolean;
      source: string;
      schemaSignature?: string;
      topLevelKeys: string[];
    };
    turn_context: {
      attachmentCount: number;
      attachmentKinds: string[];
      visionEligibleAttachmentCount: number;
      visionEligibleKinds: string[];
    };
    fallback_state: {
      suppressedCandidates: Array<{
        capabilityId: string;
        backendKind: string;
        toolName?: string;
        serverName?: string;
        routePhase: string;
        failureReason: string;
      }>;
    };
    providers: Array<{ providerName: string; available: boolean }>;
    local_model_summary: { providerName: string; installedModelCount: number };
    mcp_servers: Array<{ name: string; reachable: boolean }>;
    capabilities: Record<
      string,
      {
        selectedBackendKind?: string;
        fallbackReason?: string;
        candidates: Array<{
          backendKind: string;
          reason?: string;
          blockedReasons?: string[];
        }>;
      }
    >;
  };
}> {
  const { baseUrl, authToken } = await ensureServerRunning();
  const response = await fetch(`${baseUrl}/api/chat/execution-surface`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
  return {
    status: response.status,
    body: await response.json() as {
      session_id: string;
      runtime_mode: string;
      active_model_id?: string;
      pinned_provider_name: string;
      strategy: string;
      signature: string;
      constraints: {
        hardConstraints: string[];
        preference?: string;
        preferenceConflict: boolean;
        source: string;
      };
      task_capability_context: {
        requestedCapabilities: string[];
        source: string;
        matchedCueLabels: string[];
      };
      response_shape_context: {
        requested: boolean;
        source: string;
        schemaSignature?: string;
        topLevelKeys: string[];
      };
      turn_context: {
        attachmentCount: number;
        attachmentKinds: string[];
        visionEligibleAttachmentCount: number;
        visionEligibleKinds: string[];
      };
      fallback_state: {
        suppressedCandidates: Array<{
          capabilityId: string;
          backendKind: string;
          toolName?: string;
          serverName?: string;
          routePhase: string;
          failureReason: string;
        }>;
      };
      providers: Array<{ providerName: string; available: boolean }>;
      local_model_summary: { providerName: string; installedModelCount: number };
      mcp_servers: Array<{ name: string; reachable: boolean }>;
      capabilities: Record<
        string,
        {
          selectedBackendKind?: string;
          fallbackReason?: string;
          candidates: Array<{
            backendKind: string;
            reason?: string;
            blockedReasons?: string[];
          }>;
        }
      >;
    },
  };
}

async function registerImageAttachment(): Promise<string> {
  const file = await Deno.makeTempFile({ suffix: ".png" });
  try {
    await Deno.writeFile(file, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const { baseUrl, authToken } = await ensureServerRunning();
    const response = await fetch(`${baseUrl}/api/attachments/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ path: file }),
    });
    const body = await response.json() as { id: string };
    return body.id;
  } finally {
    await Deno.remove(file).catch(() => {});
  }
}

async function evalCode(code: string): Promise<{
  success: boolean;
  value?: string;
  error?: { name: string; message: string } | null;
}> {
  const { baseUrl, authToken } = await ensureServerRunning();
  const response = await fetch(`${baseUrl}/eval`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ code }),
  });

  return await response.json();
}

Deno.test({
  name: "http server: health succeeds and unauthorized eval is rejected",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const { baseUrl } = await ensureServerRunning();

      const health = await fetch(`${baseUrl}/health`);
      const healthData = await health.json();
      assertEquals(health.status, 200);
      assertEquals(healthData.status, "ok");
      assertExists(healthData.initialized);
      assertExists(healthData.version);
      assertExists(healthData.buildId);

      const unauthorized = await fetch(`${baseUrl}/eval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "(+ 1 2)" }),
      });
      const unauthorizedData = await unauthorized.json();
      assertEquals(unauthorized.status, 401);
      assertEquals(unauthorizedData.error, "Unauthorized");
    });
  },
});

Deno.test({
  name: "http server: eval executes HQL, JS, and exposes AI helper globals",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const arithmetic = await evalCode("(+ 1 2)");
      const aiChat = await evalCode("(typeof ai.chat)");
      const javascript = await evalCode("let x = 10; x * 2");

      assertEquals(arithmetic.success, true);
      assertEquals(arithmetic.value, "3");
      assertEquals(arithmetic.error, null);
      assertEquals(aiChat.value, '"function"');
      assertEquals(javascript.success, true);
      assertEquals(javascript.value, "20");
    });
  },
});

Deno.test({
  name: "http server: eval returns structured syntax errors",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const result = await evalCode("(+ 1");
      assertEquals(result.success, false);
      assertExists(result.error);
      assertExists(result.error?.name);
      assertExists(result.error?.message);
    });
  },
});

Deno.test({
  name:
    "http server: eval state persists across variable and function definitions",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const defVar = await evalCode("(def testVar 42)");
      const readVar = await evalCode("testVar");
      const defFn = await evalCode("(defn double [x] (* x 2))");
      const callFn = await evalCode("(double 21)");

      assertEquals(defVar.success, true);
      assertEquals(readVar.success, true);
      assertEquals(readVar.value, "42");
      assertEquals(defFn.success, true);
      assertEquals(callFn.success, true);
      assertEquals(callFn.value, "42");
    });
  },
});

Deno.test({
  name:
    "http server: agent chat rejects unsupported default models with a clear 400",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      await config.patch({ model: "test-chat/basic", modelConfigured: true });
      try {
        const { baseUrl, authToken } = await ensureServerRunning();
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            mode: "agent",
            session_id: `integration-agent-${crypto.randomUUID()}`,
            messages: [{ role: "user", content: "Say OK" }],
          }),
        });
        const result = await response.json();

        assertEquals(response.status, 400);
        assertEquals(
          result.error,
          "Default model does not support tool calling",
        );
      } finally {
        await config.patch({ model: "test-chat/plain", modelConfigured: true });
      }
    });
  },
});

Deno.test({
  name:
    "http server: chat honors explicit request messages including system context",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const result = await postChatNdjson({
        mode: "chat",
        session_id: `integration-chat-system-${crypto.randomUUID()}`,
        model: "test-chat/plain",
        messages: [
          { role: "system", content: "Speak like a pirate." },
          { role: "user", content: "hello" },
        ],
      });

      assertEquals(result.status, 200);
      const tokenEvents = result.events.filter((event) =>
        event.event === "token"
      );
      assertEquals(tokenEvents.length > 0, true);
      assertStringIncludes(String(tokenEvents[0].text), "arrr");
    });
  },
});

Deno.test({
  name:
    "http server: explicit request history remains durable for later single-turn fallback",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const sessionId = `integration-chat-durable-system-${crypto.randomUUID()}`;

      const first = await postChatNdjson({
        mode: "chat",
        session_id: sessionId,
        model: "test-chat/plain",
        messages: [
          { role: "system", content: "Speak like a pirate." },
          { role: "user", content: "hello" },
        ],
      });
      assertEquals(first.status, 200);

      const second = await postChatNdjson({
        mode: "chat",
        session_id: sessionId,
        model: "test-chat/plain",
        messages: [{ role: "user", content: "still there?" }],
      });

      assertEquals(second.status, 200);
      const tokenText = second.events
        .filter((event) => event.event === "token")
        .map((event) => String(event.text ?? ""))
        .join("");
      assertStringIncludes(tokenText, "arrr");
    });
  },
});

Deno.test({
  name:
    "http server: chat falls back to stored session history for single-turn requests",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const sessionId = `integration-chat-history-${crypto.randomUUID()}`;

      const first = await postChatNdjson({
        mode: "chat",
        session_id: sessionId,
        model: "test-chat/plain",
        messages: [{ role: "user", content: "first" }],
      });
      assertEquals(first.status, 200);

      const second = await postChatNdjson({
        mode: "chat",
        session_id: sessionId,
        model: "test-chat/plain",
        messages: [{ role: "user", content: "second" }],
      });

      assertEquals(second.status, 200);
      const tokenText = second.events
        .filter((event) => event.event === "token")
        .map((event) => String(event.text ?? ""))
        .join("");
      assertStringIncludes(tokenText, "history:reply:first");
    });
  },
});

Deno.test({
  name:
    "http server: eval turns persist as one active transcript and restore across runtime restart",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const chat = await postChatNdjson({
        mode: "chat",
        model: "test-chat/plain",
        messages: [{ role: "user", content: "hello" }],
      });
      assertEquals(chat.status, 200);

      const evalTurn = await postChatNdjson({
        mode: "eval",
        messages: [{ role: "user", content: "(+ 1 2)" }],
      });
      assertEquals(evalTurn.status, 200);

      const beforeRestart = await fetchActiveChatMessageRows();
      assertEquals(
        beforeRestart.map((message) => [
          message.role,
          message.content,
          message.sender_type,
        ]),
        [
          ["user", "hello", "user"],
          ["assistant", "reply:hello", "llm"],
          ["user", "(+ 1 2)", "eval"],
          ["assistant", "3", "eval"],
        ],
      );

      await shutdownServer();

      const afterRestart = await fetchActiveChatMessageRows();
      assertEquals(afterRestart, beforeRestart);

      const firstStreamEvent = await readFirstActiveConversationStreamEvent();
      assertEquals(firstStreamEvent.event, "snapshot");

      const snapshot = firstStreamEvent.data as {
        messages: Array<{
          role: string;
          content: string;
          sender_type: string | null;
        }>;
      };
      assertEquals(
        snapshot.messages.map((message) => [
          message.role,
          message.content,
          message.sender_type,
        ]),
        [
          ["user", "hello", "user"],
          ["assistant", "reply:hello", "llm"],
          ["user", "(+ 1 2)", "eval"],
          ["assistant", "3", "eval"],
        ],
      );
    });
  },
});

Deno.test({
  name:
    "http server: /api/chat eval persists paired eval rows with a shared request id",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const result = await postChatNdjson({
        mode: "eval",
        messages: [{ role: "user", content: "(+ 2 3)" }],
      });

      assertEquals(result.status, 200);
      const startEvent = result.events.find((event) => event.event === "start");
      assertExists(startEvent);
      const requestId = String(startEvent.request_id ?? "");
      assertEquals(requestId.length > 0, true);

      const messages = await fetchActiveChatMessageRows();
      const evalMessages = messages.slice(-2);

      assertEquals(evalMessages.map((message) => message.sender_type), [
        "eval",
        "eval",
      ]);
      assertEquals(evalMessages.map((message) => message.request_id), [
        requestId,
        requestId,
      ]);
      assertEquals(evalMessages.map((message) => message.content), [
        "(+ 2 3)",
        "5",
      ]);
    });
  },
});

Deno.test({
  name:
    "http server: chat rejects requests whose last message is not a user turn",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const result = await postChatNdjson({
        mode: "chat",
        session_id: `integration-chat-invalid-${crypto.randomUUID()}`,
        model: "test-chat/plain",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "not-allowed" },
        ],
      });

      assertEquals(result.status, 400);
      assertEquals(result.events.length, 1);
      assertEquals(result.events[0]?.error, "Last message must be a user turn");
    });
  },
});

Deno.test({
  name:
    "http server: agent follow-up can reference prior tool results from the same session",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const sessionId = `integration-agent-history-${crypto.randomUUID()}`;

      await postChatNdjson({
        mode: "agent",
        session_id: sessionId,
        model: "test-chat/plain",
        messages: [{ role: "user", content: "initial" }],
      });
      insertMessage({
        session_id: sessionId,
        role: "tool",
        content: "observed-from-tool",
        sender_type: "agent",
        tool_name: "shell_exec",
        request_id: "seeded-tool-turn",
      });

      const second = await postChatNdjson({
        mode: "agent",
        session_id: sessionId,
        model: "test-chat/plain",
        messages: [{
          role: "user",
          content: "Do you still remember the tool output?",
        }],
      });

      const tokenText = second.events
        .filter((event) => event.event === "token")
        .map((event) => String(event.text ?? ""))
        .join("");

      assertEquals(second.status, 200);
      assertStringIncludes(tokenText, "integration-agent-saw-tool");
    });
  },
});

Deno.test({
  name:
    "http server: agent chat persists exactly one top-level user and assistant row per turn",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const first = await postChatNdjson({
        mode: "agent",
        model: "test-chat/plain",
        messages: [{ role: "user", content: "hello" }],
      });
      assertEquals(first.status, 200);
      assertEquals(
        (await fetchActiveChatMessages()).map((message) => [
          message.role,
          message.content,
        ]),
        [
          ["user", "hello"],
          ["assistant", "integration-agent:hello"],
        ],
      );

      const second = await postChatNdjson({
        mode: "agent",
        model: "test-chat/plain",
        messages: [{ role: "user", content: "again" }],
      });
      assertEquals(second.status, 200);
      assertEquals(
        (await fetchActiveChatMessages()).map((message) => [
          message.role,
          message.content,
        ]),
        [
          ["user", "hello"],
          ["assistant", "integration-agent:hello"],
          ["user", "again"],
          ["assistant", "integration-agent:again"],
        ],
      );
    });
  },
});

Deno.test({
  name:
    "http server: active conversation runtime mode defaults to manual and persists after update",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const initial = await getActiveRuntimeMode();
      assertEquals(initial.status, 200);
      assertEquals(initial.body.runtime_mode, "manual");
      assertExists(initial.body.session_id);

      const updated = await setActiveRuntimeMode("auto");
      assertEquals(updated.status, 200);
      assertEquals(updated.body.runtime_mode, "auto");
      assertEquals(updated.body.session_id, initial.body.session_id);

      const afterUpdate = await getActiveRuntimeMode();
      assertEquals(afterUpdate.status, 200);
      assertEquals(afterUpdate.body.runtime_mode, "auto");
      assertEquals(afterUpdate.body.session_id, initial.body.session_id);

      const turn = await postChatNdjson({
        mode: "agent",
        model: "test-chat/plain",
        messages: [{ role: "user", content: "hello under auto mode" }],
      });
      assertEquals(turn.status, 200);

      const afterTurn = await getActiveRuntimeMode();
      assertEquals(afterTurn.status, 200);
      assertEquals(afterTurn.body.runtime_mode, "auto");
      assertEquals(afterTurn.body.session_id, initial.body.session_id);
    });
  },
});

Deno.test({
  name:
    "http server: wrong conversation schema marker resets the database to the fresh schema",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const dbPath = getConversationsDbPath();
      const platform = getPlatform();
      platform.fs.mkdirSync(platform.path.dirname(dbPath), { recursive: true });

      const seeded = new Database(dbPath);
      try {
        seeded.exec("PRAGMA user_version = 999");
        seeded.exec("CREATE TABLE legacy_marker (id INTEGER PRIMARY KEY)");
      } finally {
        seeded.close();
      }

      const { baseUrl, authToken } = await ensureServerRunning();
      const response = await fetch(
        `${baseUrl}/api/chat/messages?limit=10&offset=0&sort=asc`,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );
      assertEquals(response.status, 200);

      const reopened = new Database(dbPath);
      try {
        const userVersion = reopened.prepare("PRAGMA user_version").value<
          [number]
        >();
        assertEquals(userVersion?.[0], 1);

        const legacyMarker = reopened.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='legacy_marker'",
        ).get<{ name: string }>();
        assertEquals(legacyMarker, undefined);

        const hostState = reopened.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='host_state'",
        ).get<{ name: string }>();
        assertExists(hostState);
      } finally {
        reopened.close();
      }
    });
  },
});

Deno.test({
  name:
    "http server: execution surface reports active session routing reality",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const initial = await getActiveExecutionSurface();
      assertEquals(initial.status, 200);
      assertEquals(initial.body.runtime_mode, "manual");
      assertExists(initial.body.session_id);
      assertEquals(initial.body.active_model_id, "test-chat/plain");
      assertEquals(initial.body.pinned_provider_name, "test-chat");
      assertEquals(initial.body.strategy, "configured-first");
      assertExists(initial.body.capabilities["web.search"]);
      assertExists(initial.body.capabilities["web.read"]);
      assertEquals(
        Array.isArray(initial.body.capabilities["web.search"].candidates),
        true,
      );
      assertEquals(Array.isArray(initial.body.providers), true);
      assertEquals(Array.isArray(initial.body.mcp_servers), true);
      assertEquals(initial.body.local_model_summary.providerName, "ollama");

      const updated = await setActiveRuntimeMode("auto");
      assertEquals(updated.status, 200);

      const afterUpdate = await getActiveExecutionSurface();
      assertEquals(afterUpdate.status, 200);
      assertEquals(afterUpdate.body.runtime_mode, "auto");
      assertEquals(afterUpdate.body.session_id, initial.body.session_id);
      assertEquals(afterUpdate.body.constraints.source, "none");
      assertEquals(afterUpdate.body.task_capability_context.source, "none");
      assertExists(afterUpdate.body.capabilities["web.search"].selectedBackendKind);
      assertExists(afterUpdate.body.capabilities["code.exec"]);
    });
  },
});

Deno.test({
  name:
    "http server: execution surface reflects last applied routing constraints from an auto-mode turn",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const initial = await getActiveExecutionSurface();
      assertEquals(initial.status, 200);

      const updated = await setActiveRuntimeMode("auto");
      assertEquals(updated.status, 200);

      const turn = await postChatNdjson({
        mode: "agent",
        model: "test-chat/plain",
        runtime_mode: "auto",
        messages: [{
          role: "user",
          content:
            "Use the latest docs but keep it local and cheap if possible.",
        }],
      });
      assertEquals(turn.status, 200);

      const constrained = await getActiveExecutionSurface();
      assertEquals(constrained.status, 200);
      assertEquals(constrained.body.runtime_mode, "auto");
      assertEquals(constrained.body.constraints.hardConstraints, ["local-only"]);
      assertEquals(constrained.body.constraints.preference, "cheap");
      assertEquals(constrained.body.constraints.source, "task-text");
      assertEquals(
        constrained.body.signature === initial.body.signature,
        false,
      );
      assertExists(constrained.body.capabilities["web.search"]);
      assertExists(constrained.body.capabilities["web.read"]);
    });
  },
});

Deno.test({
  name:
    "http server: execution surface reflects the last effective fallback state from the most recent auto turn",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const updated = await setActiveRuntimeMode("auto");
      assertEquals(updated.status, 200);

      persistLastAppliedExecutionFallbackState(updated.body.session_id, {
        suppressedCandidates: [{
          capabilityId: "web.search",
          backendKind: "hlvm-local",
          toolName: "search_web",
          routePhase: "tool-start",
          failureReason: "local search failed",
        }],
      });

      const surface = await getActiveExecutionSurface();
      assertEquals(surface.status, 200);
      assertEquals(
        surface.body.fallback_state.suppressedCandidates,
        [{
          capabilityId: "web.search",
          backendKind: "hlvm-local",
          toolName: "search_web",
          routePhase: "tool-start",
          failureReason: "local search failed",
        }],
      );
      assertEquals(surface.body.capabilities["web.search"].selectedBackendKind, undefined);
      assertStringIncludes(
        surface.body.capabilities["web.search"].fallbackReason ?? "",
        "failed during current turn",
      );
    });
  },
});

Deno.test({
  name:
    "http server: auto-mode routed tool failure emits a fallback route event and recomputes the execution surface",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const restoreSearch = overrideTool("search_web", {
        fn: () => Promise.reject(new Error("synthetic search failure")),
        description: "Failing search tool for fallback integration coverage",
        args: { query: "string - Query to search" },
        safetyLevel: "L0" as const,
      });

      try {
        const updated = await setActiveRuntimeMode("auto");
        assertEquals(updated.status, 200);

        const turn = await postChatNdjson({
          mode: "agent",
          model: "test-chat/plain",
          runtime_mode: "auto",
          messages: [{
            role: "user",
            content:
              "mixed-task coherence probe: use the latest docs even if search fails.",
          }],
        });
        assertEquals(turn.status, 200);

        const routed = turn.events.filter((event) =>
          event.event === "capability_routed"
        );
        assertEquals(
          routed.map((event) =>
            `${String(event.route_phase)}:${String(event.capability_id)}`
          ),
          ["tool-start:web.search", "fallback:web.search"],
        );

        const fallbackEvent = routed.find((event) =>
          event.route_phase === "fallback" &&
          event.capability_id === "web.search"
        );
        assertExists(fallbackEvent);
        assertEquals(fallbackEvent.selected_backend_kind, undefined);
        assertEquals(fallbackEvent.route_changed_by_failure, true);
        assertStringIncludes(
          String(fallbackEvent.failure_reason ?? ""),
          "synthetic search failure",
        );

        const failedSearch = turn.events.find((event) =>
          event.event === "tool_end" &&
          event.name === "search_web"
        );
        assertExists(failedSearch);
        assertEquals(failedSearch.success, false);

        const surface = await getActiveExecutionSurface();
        assertEquals(surface.status, 200);
        assertEquals(
          surface.body.fallback_state.suppressedCandidates,
          [{
            capabilityId: "web.search",
            backendKind: "hlvm-local",
            toolName: "search_web",
            routePhase: "tool-start",
            failureReason: "synthetic search failure",
          }],
        );
        assertEquals(
          surface.body.capabilities["web.search"].selectedBackendKind,
          undefined,
        );
        assertStringIncludes(
          surface.body.capabilities["web.search"].fallbackReason ?? "",
          "capability unavailable for remainder of turn",
        );
      } finally {
        restoreSearch();
      }
    });
  },
});

Deno.test({
  name:
    "http server: auto-mode compute task emits turn-start code.exec routing and updates the execution surface",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const updated = await setActiveRuntimeMode("auto");
      assertEquals(updated.status, 200);

      const turn = await postChatNdjson({
        mode: "agent",
        model: "test-chat/plain",
        runtime_mode: "auto",
        messages: [{
          role: "user",
          content: "Calculate the sha-256 and base64 output for this sample.",
        }],
      });
      assertEquals(turn.status, 200);

      const routed = turn.events.find((event) =>
        event.event === "capability_routed" &&
        event.capability_id === "code.exec"
      );
      assertExists(routed);
      assertEquals(routed.route_phase, "turn-start");
      assertEquals(routed.selected_backend_kind, undefined);

      const surface = await getActiveExecutionSurface();
      assertEquals(surface.status, 200);
      assertEquals(
        surface.body.task_capability_context.requestedCapabilities,
        ["code.exec"],
      );
      assertEquals(surface.body.task_capability_context.source, "task-text");
      assertEquals(
        surface.body.capabilities["code.exec"].selectedBackendKind,
        undefined,
      );
      assertStringIncludes(
        surface.body.capabilities["code.exec"].fallbackReason ?? "",
        "pinned model/provider lacks native remote code execution",
      );
    });
  },
});

Deno.test({
  name:
    "http server: explicit structured output request updates response-shape context and fails clearly when no route exists",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const updated = await setActiveRuntimeMode("auto");
      assertEquals(updated.status, 200);

      const turn = await postChatNdjson({
        mode: "agent",
        model: "test-chat/plain",
        runtime_mode: "auto",
        response_schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["answer"],
        },
        messages: [{
          role: "user",
          content: "Return a structured answer for this prompt.",
        }],
      });
      assertEquals(turn.status, 200);

      const routed = turn.events.find((event) =>
        event.event === "capability_routed" &&
        event.capability_id === "structured.output"
      );
      assertExists(routed);
      assertEquals(routed.route_phase, "turn-start");
      assertEquals(routed.selected_backend_kind, undefined);

      const errorEvent = turn.events.find((event) => event.event === "error");
      assertExists(errorEvent);
      assertStringIncludes(
        String(errorEvent.message ?? ""),
        "pinned model/provider lacks provider-native structured output",
      );

      const surface = await getActiveExecutionSurface();
      assertEquals(surface.status, 200);
      assertEquals(surface.body.response_shape_context.requested, true);
      assertEquals(surface.body.response_shape_context.source, "request");
      assertEquals(
        surface.body.capabilities["structured.output"].selectedBackendKind,
        undefined,
      );
      assertStringIncludes(
        surface.body.capabilities["structured.output"].fallbackReason ?? "",
        "pinned model/provider lacks provider-native structured output",
      );
    });
  },
});

Deno.test({
  name:
    "http server: auto-mode image attachment emits turn-start vision routing and updates the execution surface",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      await config.patch({ model: "test-chat/vision", modelConfigured: true });
      const attachmentId = await registerImageAttachment();

      const updated = await setActiveRuntimeMode("auto");
      assertEquals(updated.status, 200);

      const turn = await postChatNdjson({
        mode: "agent",
        model: "test-chat/vision",
        runtime_mode: "auto",
        messages: [{
          role: "user",
          content: "Describe the attached image.",
          attachment_ids: [attachmentId],
        }],
      });
      assertEquals(turn.status, 200);
      const routed = turn.events.find((event) =>
        event.event === "capability_routed" &&
        event.capability_id === "vision.analyze"
      );
      assertExists(routed);
      assertEquals(routed.route_phase, "turn-start");
      assertEquals(routed.selected_backend_kind, "provider-native");

      const surface = await getActiveExecutionSurface();
      assertEquals(surface.status, 200);
      assertEquals(surface.body.active_model_id, "test-chat/vision");
      assertEquals(surface.body.turn_context.attachmentCount, 1);
      assertEquals(surface.body.turn_context.attachmentKinds, ["image"]);
      assertEquals(
        surface.body.turn_context.visionEligibleAttachmentCount,
        1,
      );
      assertEquals(
        surface.body.capabilities["vision.analyze"].selectedBackendKind,
        "provider-native",
      );
    });
  },
});

Deno.test({
  name:
    "http server: auto-mode mixed-task turn keeps vision and web routing coherent",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      await config.patch({ model: "test-chat/vision", modelConfigured: true });
      const attachmentId = await registerImageAttachment();
      const restoreSearch = overrideTool("search_web", {
        fn: () =>
          Promise.resolve({
            query: "hlvm mixed-task coherence docs",
            provider: "integration",
            results: [{
              title: "HLVM docs",
              url: "https://example.com/hlvm",
              snippet: "synthetic integration result",
            }],
            count: 1,
          }),
        description: "Fake search tool for integration mixed-task coherence",
        args: { query: "string - Query to search" },
        safetyLevel: "L0" as const,
      });

      try {
        const updated = await setActiveRuntimeMode("auto");
        assertEquals(updated.status, 200);

        const turn = await postChatNdjson({
          mode: "agent",
          model: "test-chat/vision",
          runtime_mode: "auto",
          messages: [{
            role: "user",
            content:
              "mixed-task coherence probe: describe the attached image, then use the latest docs to explain it.",
            attachment_ids: [attachmentId],
          }],
        });
        assertEquals(turn.status, 200);

        const routed = turn.events.filter((event) =>
          event.event === "capability_routed"
        );
        assertEquals(
          routed.map((event) =>
            `${String(event.route_phase)}:${String(event.capability_id)}`
          ),
          ["turn-start:vision.analyze", "tool-start:web.search"],
        );
        assertEquals(
          routed.filter((event) => event.capability_id === "web.search").length,
          1,
        );
        assertEquals(
          turn.events.filter((event) =>
            event.event === "tool_start" && event.name === "search_web"
          ).length,
          1,
        );

        const surface = await getActiveExecutionSurface();
        assertEquals(surface.status, 200);
        assertEquals(
          surface.body.capabilities["vision.analyze"].selectedBackendKind,
          "provider-native",
        );
        assertEquals(
          surface.body.capabilities["web.search"].selectedBackendKind,
          "hlvm-local",
        );
        assertEquals(surface.body.turn_context.visionEligibleAttachmentCount, 1);
      } finally {
        restoreSearch();
      }
    });
  },
});

Deno.test({
  name:
    "http server: chat baseline memory writes are visible in later chat sessions",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const marker = `memory-marker:${crypto.randomUUID()}`;

      const first = await postChatNdjson({
        mode: "chat",
        session_id: `integration-chat-memory-write-${crypto.randomUUID()}`,
        model: "test-chat/plain",
        messages: [{ role: "user", content: `Remember that ${marker}` }],
      });
      assertEquals(first.status, 200);

      const second = await postChatNdjson({
        mode: "chat",
        session_id: `integration-chat-memory-read-${crypto.randomUUID()}`,
        model: "test-chat/plain",
        messages: [{ role: "user", content: `Do you still know ${marker}?` }],
      });

      const tokenText = second.events
        .filter((event) => event.event === "token")
        .map((event) => String(event.text ?? ""))
        .join("");

      assertEquals(second.status, 200);
      assertStringIncludes(tokenText, `memory:${marker}`);
    });
  },
});

Deno.test({
  name:
    "http server: agent baseline memory writes are visible to later chat sessions",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const marker = `memory-marker:${crypto.randomUUID()}`;

      const first = await postChatNdjson({
        mode: "agent",
        session_id: `integration-agent-memory-write-${crypto.randomUUID()}`,
        model: "test-chat/plain",
        messages: [{ role: "user", content: `Remember that ${marker}` }],
      });
      assertEquals(first.status, 200);

      const second = await postChatNdjson({
        mode: "chat",
        session_id: `integration-agent-memory-read-${crypto.randomUUID()}`,
        model: "test-chat/plain",
        messages: [{ role: "user", content: `Do you still know ${marker}?` }],
      });

      const tokenText = second.events
        .filter((event) => event.event === "token")
        .map((event) => String(event.text ?? ""))
        .join("");

      assertEquals(second.status, 200);
      assertStringIncludes(tokenText, `memory:${marker}`);
    });
  },
});
