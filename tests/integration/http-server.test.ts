import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import type { Message as AgentMessage } from "../../src/hlvm/agent/context.ts";
import { setAgentEngine } from "../../src/hlvm/agent/engine.ts";
import type {
  AgentEngine,
  AgentLLMConfig,
} from "../../src/hlvm/agent/engine.ts";
import { config } from "../../src/hlvm/api/config.ts";
import { startHttpServer } from "../../src/hlvm/cli/repl/http-server.ts";
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

class IntegrationAgentEngine implements AgentEngine {
  createLLM(config: AgentLLMConfig) {
    return (messages: AgentMessage[]) => {
      const sawToolResult = messages.some((message) =>
        message.content.includes("observed-from-tool")
      );
      const lastUserMessage = [...messages].reverse().find((message) =>
        message.role === "user"
      );
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
      return Promise.resolve([INTEGRATION_MODEL, INTEGRATION_TOOLLESS_MODEL]);
    },
    get(name: string) {
      if (name === INTEGRATION_MODEL.name) {
        return Promise.resolve(INTEGRATION_MODEL);
      }
      if (name === INTEGRATION_TOOLLESS_MODEL.name) {
        return Promise.resolve(INTEGRATION_TOOLLESS_MODEL);
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
      const ask = await evalCode("(typeof ask)");
      const generate = await evalCode("(typeof ai.generate)");
      const javascript = await evalCode("let x = 10; x * 2");

      assertEquals(arithmetic.success, true);
      assertEquals(arithmetic.value, "3");
      assertEquals(arithmetic.error, null);
      assertEquals(ask.value, '"function"');
      assertEquals(generate.value, '"function"');
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
