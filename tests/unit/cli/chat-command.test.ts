import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { log } from "../../../src/hlvm/api/log.ts";
import {
  chatCommand,
  parseChatArgs,
} from "../../../src/hlvm/cli/commands/chat.ts";
import { getRuntimeHostIdentity } from "../../../src/hlvm/runtime/host-identity.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { findFreePort, withEnv } from "../../shared/light-helpers.ts";

const encoder = new TextEncoder();

interface FakeSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  session_version: number;
  metadata: string | null;
}

async function withChatHost(
  options: {
    sessions?: FakeSession[];
    onChat?: (body: Record<string, unknown>) => void;
  },
  fn: (helpers: { output: () => string }) => Promise<void>,
): Promise<void> {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  const identity = await getRuntimeHostIdentity();
  const sessions = options.sessions ?? [];
  const raw = log.raw as {
    log: (text: string) => void;
    write: (text: string) => void;
  };
  const originalLog = raw.log;
  const originalWrite = raw.write;
  let output = "";

  raw.log = (text: string) => {
    output += text + (text.endsWith("\n") ? "" : "\n");
  };
  raw.write = (text: string) => {
    output += text;
  };

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        initialized: true,
        definitions: 0,
        aiReady: true,
        version: identity.version,
        buildId: identity.buildId,
        authToken,
      });
    }

    if (url.pathname === "/api/sessions") {
      return Response.json({ sessions });
    }

    if (url.pathname === "/api/config") {
      return Response.json({
        model: "ollama/llama3.1:8b",
        modelConfigured: true,
        endpoint: "http://localhost:11434",
        theme: "sicp",
      });
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/(.+)$/);
    if (sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }
      return Response.json(session);
    }

    if (url.pathname === "/api/chat") {
      const body = await req.json() as Record<string, unknown>;
      options.onChat?.(body);
      const firstMessage = (body.messages as Array<Record<string, unknown>>)[0];
      const reply = `reply:${String(firstMessage?.content ?? "")}`;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ event: "token", text: reply }) + "\n",
            ),
          );
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                event: "complete",
                request_id: "req-chat",
                session_version: 1,
              }) + "\n",
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson",
          "X-Request-ID": "req-chat",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  }, {
    hostname: "127.0.0.1",
    port,
    onListen: () => {},
  });

  try {
    await withEnv("HLVM_REPL_PORT", String(port), async () => {
      await fn({ output: () => output });
    });
  } finally {
    raw.log = originalLog;
    raw.write = originalWrite;
    await handle.shutdown();
    await handle.finished;
  }
}

Deno.test("chat command: rejects bare --resume because plain chat has no picker", async () => {
  await assertRejects(
    async () => {
      parseChatArgs(["--resume", "--model", "ollama/llama3.1:8b", "hello"]);
    },
    Error,
    "--resume requires a session id",
  );
});

Deno.test("chat command: one-shot plain chat streams through the runtime host", async () => {
  let capturedChatBody: Record<string, unknown> | null = null;

  await withChatHost({
    onChat: (body) => {
      capturedChatBody = body;
    },
  }, async ({ output }) => {
    await chatCommand(["--model", "ollama/llama3.1:8b", "hello"]);

    assertStringIncludes(output(), "reply:hello");
    assertEquals(capturedChatBody?.mode, "chat");
    assertEquals(capturedChatBody?.model, "ollama/llama3.1:8b");
    assertEquals(
      (capturedChatBody?.messages as Array<Record<string, unknown>>)[0]
        ?.content,
      "hello",
    );
    assertEquals(typeof capturedChatBody?.session_id, "string");
  });
});

Deno.test("chat command: --continue reuses the latest host session", async () => {
  const sessions: FakeSession[] = [{
    id: "sess-latest",
    title: "Latest",
    created_at: "2026-03-07T00:00:00.000Z",
    updated_at: "2026-03-07T00:00:00.000Z",
    message_count: 4,
    session_version: 4,
    metadata: null,
  }];
  let capturedSessionId = "";

  await withChatHost({
    sessions,
    onChat: (body) => {
      capturedSessionId = String(body.session_id);
    },
  }, async () => {
    await chatCommand([
      "--model",
      "ollama/llama3.1:8b",
      "--continue",
      "second",
    ]);
    assertEquals(capturedSessionId, "sess-latest");
  });
});

Deno.test("chat command: --resume <id> validates and uses the requested host session", async () => {
  const sessions: FakeSession[] = [{
    id: "sess-explicit",
    title: "Explicit",
    created_at: "2026-03-07T00:00:00.000Z",
    updated_at: "2026-03-07T00:00:00.000Z",
    message_count: 2,
    session_version: 2,
    metadata: null,
  }];
  let capturedSessionId = "";

  await withChatHost({
    sessions,
    onChat: (body) => {
      capturedSessionId = String(body.session_id);
    },
  }, async () => {
    await chatCommand([
      "--model",
      "ollama/llama3.1:8b",
      "--resume",
      "sess-explicit",
      "third",
    ]);
    assertEquals(capturedSessionId, "sess-explicit");
  });
});
