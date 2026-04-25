import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import { delay } from "@std/async";
import { Database } from "@db/sqlite";
import type { Message as AgentMessage } from "../../src/hlvm/agent/context.ts";
import { setAgentEngine } from "../../src/hlvm/agent/engine.ts";
import type {
  AgentEngine,
  AgentLLMConfig,
} from "../../src/hlvm/agent/engine.ts";
import { config } from "../../src/hlvm/api/config.ts";
import { startHttpServer } from "../../src/hlvm/cli/repl/http-server.ts";
import { getConversationsDbPath } from "../../src/common/paths.ts";
import { initializeRuntime } from "../../src/common/runtime-initializer.ts";
import {
  _resetActiveConversationForTesting,
  getActiveConversationSessionId,
} from "../../src/hlvm/store/active-conversation.ts";
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

class IntegrationAgentEngine implements AgentEngine {
  createLLM(config: AgentLLMConfig) {
    return (messages: AgentMessage[]) => {
      const sawToolResult = messages.some((message) =>
        message.role === "tool" ||
        message.content.includes("observed-from-tool")
      );
      const sawAsyncLaunch = messages.some((message) =>
        message.role === "tool" &&
        message.content.includes("Async agent launched successfully.")
      );
      const sawTaskNotification = messages.some((message) =>
        message.content.includes("<task-notification>")
      );
      const hasAsyncLaunchRequest = messages.some((message) =>
        message.role === "user" &&
        message.content.includes("integration async launch")
      );
      const lastUserMessage = [...messages].reverse().find((message) =>
        message.role === "user"
      );
      if (sawTaskNotification) {
        const text = "integration-background-notified";
        config.onToken?.(text);
        return Promise.resolve({
          content: text,
          toolCalls: [],
          usage: { inputTokens: 8, outputTokens: 4 },
        });
      }
      if (sawAsyncLaunch) {
        const text = "integration-background-launched";
        config.onToken?.(text);
        return Promise.resolve({
          content: text,
          toolCalls: [],
          usage: { inputTokens: 8, outputTokens: 4 },
        });
      }
      if (hasAsyncLaunchRequest) {
        return Promise.resolve({
          content: "",
          toolCalls: [{
            toolName: "Agent",
            args: {
              description: "Integration background child",
              prompt: "integration async child",
              run_in_background: true,
            },
          }],
          usage: { inputTokens: 8, outputTokens: 4 },
        });
      }
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

// Model name matches curated agent-capable allowlist (qwen3 pattern in
// src/hlvm/agent/constants.ts AGENT_CAPABLE_MODELS) with >=7B parameters so
// classifyModelCapability() returns "agent" — required for mode=agent tests
// to actually route through handleAgentMode.
const INTEGRATION_AGENT_MODEL: ModelInfo = {
  name: "qwen3:8b",
  parameterSize: "8B",
  contextWindow: 65_536,
  capabilities: ["chat", "tools"],
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
        INTEGRATION_AGENT_MODEL,
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
      if (name === INTEGRATION_AGENT_MODEL.name) {
        return Promise.resolve(INTEGRATION_AGENT_MODEL);
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
    _resetActiveConversationForTesting();
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

async function fetchActiveChatMessages(): Promise<
  Array<{
    role: string;
    content: string;
  }>
> {
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

async function fetchActiveChatMessageRows(): Promise<
  Array<{
    role: string;
    content: string;
    request_id: string | null;
    sender_type: string | null;
  }>
> {
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
  const stream = await openActiveConversationStream();
  try {
    return await readNextSSEEvent(stream);
  } finally {
    await closeActiveConversationStream(stream);
  }
}

interface ActiveConversationStream {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
  controller: AbortController;
}

async function openActiveConversationStream(): Promise<
  ActiveConversationStream
> {
  const { baseUrl, authToken } = await ensureServerRunning();
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/chat/stream`, {
    signal: controller.signal,
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

  return {
    reader,
    decoder: new TextDecoder(),
    buffer: "",
    controller,
  };
}

async function closeActiveConversationStream(
  stream: ActiveConversationStream,
): Promise<void> {
  stream.controller.abort();
  await stream.reader.cancel().catch(() => {});
}

async function readNextSSEEvent(stream: ActiveConversationStream): Promise<{
  event: string;
  data: unknown;
}> {
  while (true) {
    const { value, done } = await stream.reader.read();
    if (done) break;
    stream.buffer += stream.decoder.decode(value, { stream: true });
    while (true) {
      const boundary = stream.buffer.indexOf("\n\n");
      if (boundary < 0) {
        break;
      }
      const rawEvent = stream.buffer.slice(0, boundary);
      stream.buffer = stream.buffer.slice(boundary + 2);
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

  throw new Error("No SSE event received");
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

// Compaction-through-the-runtime-stream coverage lives in
// tests/unit/agent/context.test.ts (the compaction unit tests). The
// integration version was tightly coupled to the pre-refactor orchestrator's
// summary-injection timing and token-pressure thresholds, which changed when
// proactive compaction gained the pre-compaction memory_write flush. The
// remaining integration tests still cover agent-mode dispatch, tool results,
// background agents, and persistence end-to-end — those are the distinct
// integration guarantees.

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
      const sessionId =
        `integration-chat-durable-system-${crypto.randomUUID()}`;

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
    "http server: durable active transcript persists while live GUI stream starts fresh",
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
      assertEquals(snapshot.messages, []);
    });
  },
});

Deno.test({
  name:
    "http server: channel-originated chat publishes to the live GUI transcript stream",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const stream = await openActiveConversationStream();
      try {
        const snapshot = await readNextSSEEvent(stream);
        assertEquals(snapshot.event, "snapshot");
        assertEquals((snapshot.data as { messages: unknown[] }).messages, []);

        const chat = await postChatNdjson({
          mode: "chat",
          model: "test-chat/plain",
          query_source: "channel:telegram",
          skip_session_history: true,
          messages: [{ role: "user", content: "from phone" }],
        });
        assertEquals(chat.status, 200);

        const userAdded = await readNextSSEEvent(stream);
        const assistantAdded = await readNextSSEEvent(stream);
        const assistantUpdated = await readNextSSEEvent(stream);

        assertEquals(userAdded.event, "message_added");
        const userMessage =
          (userAdded.data as { message: { role: string; content: string } })
            .message;
        assertEquals(
          [userMessage.role, userMessage.content],
          ["user", "from phone"],
        );
        assertEquals(assistantAdded.event, "message_added");
        assertEquals(
          (assistantAdded.data as { message: { role: string } }).message.role,
          "assistant",
        );
        assertEquals(assistantUpdated.event, "message_updated");
        assertEquals(
          (assistantUpdated.data as { message: { content: string } }).message
            .content,
          "reply:from phone",
        );
      } finally {
        await closeActiveConversationStream(stream);
      }
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
      await postChatNdjson({
        mode: "agent",
        model: "test-chat/qwen3:8b",
        messages: [{ role: "user", content: "initial" }],
      });
      const sessionId = getActiveConversationSessionId();
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
        model: "test-chat/qwen3:8b",
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
    "http server: background agent completion survives the request and notifies the next turn",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withIsolatedServerTest(async () => {
      const first = await postChatNdjson({
        mode: "agent",
        model: "test-chat/qwen3:8b",
        tool_allowlist: ["Agent"],
        messages: [{ role: "user", content: "integration async launch" }],
      });

      assertEquals(first.status, 200);
      const firstText = first.events
        .filter((event) => event.event === "token")
        .map((event) => String(event.text ?? ""))
        .join("");
      assertStringIncludes(firstText, "integration-background-launched");
      assertExists(
        first.events.find((event) =>
          event.event === "tool_start" && event.name === "Agent"
        ),
      );
      assertExists(
        first.events.find((event) =>
          event.event === "tool_end" && event.name === "Agent"
        ),
      );

      const firstToolEnd = first.events.find((event) =>
        event.event === "tool_end" && event.name === "Agent"
      );
      assertExists(firstToolEnd);
      const toolContent = String(firstToolEnd.content ?? "");
      const outputFileMatch = toolContent.match(/^output_file:\s*(.+)$/m);
      if (!outputFileMatch) {
        throw new Error(
          `Missing output_file in Agent tool content: ${toolContent}`,
        );
      }
      const outputFile = outputFileMatch![1]!.trim();

      let observedFinalOutput = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        if (await getPlatform().fs.exists(outputFile)) {
          const output = await getPlatform().fs.readTextFile(outputFile);
          if (output.includes("Final response:")) {
            observedFinalOutput = true;
            break;
          }
        }
        await delay(50);
      }
      assertEquals(observedFinalOutput, true);

      const second = await postChatNdjson({
        mode: "agent",
        model: "test-chat/qwen3:8b",
        tool_allowlist: ["Agent"],
        messages: [{ role: "user", content: "integration async launch" }],
      });

      assertEquals(second.status, 200);
      const secondText = second.events
        .filter((event) => event.event === "token")
        .map((event) => String(event.text ?? ""))
        .join("");
      assertStringIncludes(secondText, "integration-background-notified");
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
        model: "test-chat/qwen3:8b",
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
        model: "test-chat/qwen3:8b",
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
        assertEquals(userVersion?.[0], 2);

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
