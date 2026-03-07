import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { HQLErrorCode } from "../../../src/common/error-codes.ts";
import { RuntimeError } from "../../../src/common/error.ts";
import {
  addRuntimeMcpServer,
  addRuntimeSessionMessage,
  createRuntimeSession,
  deleteRuntimeModel,
  deleteRuntimeSession,
  getRuntimeConfig,
  getRuntimeConfigApi,
  getRuntimeModel,
  getRuntimeModelDiscovery,
  getRuntimeProviderStatus,
  getRuntimeSession,
  listRuntimeInstalledModels,
  listRuntimeMcpServers,
  listRuntimeSessionMessages,
  listRuntimeSessions,
  loginRuntimeMcpServer,
  logoutRuntimeMcpServer,
  pullRuntimeModelViaHost,
  removeRuntimeMcpServer,
  runAgentQueryViaHost,
  runDirectChatViaHost,
  runRuntimeOllamaSignin,
} from "../../../src/hlvm/runtime/host-client.ts";
import { getRuntimeHostIdentity } from "../../../src/hlvm/runtime/host-identity.ts";
import type { RuntimeSessionMessage } from "../../../src/hlvm/runtime/session-protocol.ts";
import { deriveDefaultSessionKey } from "../../../src/hlvm/runtime/session-key.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  findFreePort,
  withEnv,
  withRuntimeHostServer,
} from "../../shared/light-helpers.ts";

const encoder = new TextEncoder();

async function createHealthResponse(authToken: string, overrides: {
  aiReady?: boolean;
  authToken?: string | null;
} = {}): Promise<Record<string, unknown>> {
  const identity = await getRuntimeHostIdentity();
  return {
    status: "ok",
    initialized: true,
    definitions: 0,
    aiReady: overrides.aiReady ?? true,
    version: identity.version,
    buildId: identity.buildId,
    authToken: overrides.authToken ?? authToken,
  };
}

Deno.test("runAgentQueryViaHost streams events, traces, and interaction responses", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  let capturedChatBody: Record<string, unknown> | null = null;
  let capturedInteractionBody: Record<string, unknown> | null = null;

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createHealthResponse(authToken));
    }

    const authHeader = req.headers.get("Authorization");
    assertEquals(authHeader, `Bearer ${authToken}`);

    if (url.pathname === "/api/chat/interaction") {
      capturedInteractionBody = await req.json();
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/chat") {
      capturedChatBody = await req.json();
      const stream = new ReadableStream({
        start(controller) {
          const emit = (obj: unknown) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          emit({ event: "start", request_id: "req-1" });
          emit({ event: "thinking", iteration: 1 });
          emit({
            event: "tool_start",
            name: "read_file",
            args_summary: "src/main.ts",
            tool_index: 1,
            tool_total: 1,
          });
          emit({ event: "delegate_start", agent: "web", task: "Inspect docs" });
          emit({
            event: "interaction_request",
            request_id: "interaction-1",
            mode: "permission",
            tool_name: "write_file",
            tool_args: '{"path":"src/main.ts"}',
          });
          emit({
            event: "trace",
            trace: { type: "iteration", current: 1, max: 8 },
          });
          emit({
            event: "final_response_meta",
            meta: {
              citationSpans: [{
                url: "https://example.com",
                title: "Example",
              }],
            },
          });
          emit({ event: "token", text: "done" });
          emit({
            event: "tool_end",
            name: "read_file",
            success: true,
            content: "ok",
            summary: "Read file",
            duration_ms: 25,
            args_summary: "src/main.ts",
          });
          emit({
            event: "delegate_end",
            agent: "web",
            task: "Inspect docs",
            success: true,
            summary: "Found relevant docs",
            duration_ms: 18,
          });
          emit({
            event: "result_stats",
            stats: {
              messageCount: 4,
              estimatedTokens: 123,
              toolMessages: 1,
              usage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
                source: "provider",
              },
            },
          });
          emit({ event: "complete", request_id: "req-1", session_version: 2 });
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson",
          "X-Request-ID": "req-1",
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
      const tokens: string[] = [];
      const uiEvents: string[] = [];
      const traces: string[] = [];
      const metaEvents: number[] = [];

      const result = await runAgentQueryViaHost({
        query: "fix it",
        model: "ollama/llama3.1:8b",
        workspace: "/tmp/project",
        permissionMode: "auto-edit",
        contextWindow: 4096,
        callbacks: {
          onToken: (text) => tokens.push(text),
          onAgentEvent: (event) => uiEvents.push(event.type),
          onTrace: (event) => traces.push(event.type),
          onFinalResponseMeta: (meta) =>
            metaEvents.push(meta.citationSpans.length),
        },
        onInteraction: async (event) => {
          assertEquals(event.mode, "permission");
          assertEquals(event.toolName, "write_file");
          return { approved: true };
        },
      });

      assertEquals(tokens, ["done"]);
      assert(uiEvents.includes("thinking"));
      assert(uiEvents.includes("tool_start"));
      assert(uiEvents.includes("tool_end"));
      assert(uiEvents.includes("delegate_start"));
      assert(uiEvents.includes("delegate_end"));
      assertEquals(traces, ["iteration"]);
      assertEquals(metaEvents, [1]);
      assertEquals(result.text, "done");
      assertEquals(result.stats.estimatedTokens, 123);
      assertEquals(result.stats.usage?.totalTokens, 15);

      assert(capturedChatBody !== null);
      assertEquals(
        capturedChatBody?.session_id,
        deriveDefaultSessionKey("/tmp/project", "ollama/llama3.1:8b"),
      );
      assertEquals(capturedChatBody?.workspace, "/tmp/project");
      assertEquals(capturedChatBody?.permission_mode, "auto-edit");
      assertEquals(capturedChatBody?.context_window, 4096);
      assertEquals(capturedChatBody?.skip_session_history, undefined);
      assertEquals(capturedChatBody?.trace, true);
      assertEquals(capturedInteractionBody?.request_id, "interaction-1");
      assertEquals(capturedInteractionBody?.approved, true);
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runtime host client lists sessions, resolves session lookups, and streams direct chat", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  const sessions = [{
    id: "sess-1",
    title: "First",
    created_at: "2026-03-07T00:00:00.000Z",
    updated_at: "2026-03-07T00:00:00.000Z",
    message_count: 2,
    session_version: 3,
    metadata: null,
  }];
  const messages: RuntimeSessionMessage[] = [{
    id: 1,
    session_id: "sess-1",
    order: 1,
    role: "user",
    content: "hello",
    client_turn_id: "turn-1",
    request_id: null,
    sender_type: "user",
    sender_detail: null,
    image_paths: null,
    tool_calls: null,
    tool_name: null,
    tool_call_id: null,
    cancelled: 0,
    created_at: "2026-03-07T00:00:00.000Z",
  }];
  let capturedChatBody: Record<string, unknown> | null = null;
  let createdSessionBody: Record<string, unknown> | null = null;
  let appendedMessageBody: Record<string, unknown> | null = null;
  let deletedSessionId = "";

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createHealthResponse(authToken));
    }

    if (url.pathname === "/api/sessions") {
      if (req.method === "POST") {
        createdSessionBody = await req.json();
        return Response.json({
          id: "created-1",
          title: "Created",
          created_at: "2026-03-07T00:01:00.000Z",
          updated_at: "2026-03-07T00:01:00.000Z",
          message_count: 0,
          session_version: 1,
          metadata: null,
        }, { status: 201 });
      }
      return Response.json({ sessions });
    }

    if (url.pathname === "/api/sessions/sess-1") {
      if (req.method === "DELETE") {
        deletedSessionId = "sess-1";
        return Response.json({ deleted: true });
      }
      return Response.json(sessions[0]);
    }

    if (url.pathname === "/api/sessions/sess-1/messages") {
      if (req.method === "POST") {
        appendedMessageBody = await req.json();
        return Response.json(messages[0], { status: 201 });
      }
      return Response.json({
        messages,
        total: messages.length,
        has_more: false,
        session_version: 3,
      });
    }

    if (url.pathname === "/api/sessions/missing") {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    if (url.pathname === "/api/chat") {
      capturedChatBody = await req.json();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ event: "token", text: "reply:hello" }) + "\n",
            ),
          );
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                event: "complete",
                request_id: "req-4",
                session_version: 4,
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
          "X-Request-ID": "req-4",
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
      const listed = await listRuntimeSessions();
      const created = await createRuntimeSession({ title: "Created" });
      const found = await getRuntimeSession("sess-1");
      const missing = await getRuntimeSession("missing");
      const listedMessages = await listRuntimeSessionMessages("sess-1");
      const added = await addRuntimeSessionMessage("sess-1", {
        role: "assistant",
        content: "reply",
        sender_type: "assistant",
      });
      const deleted = await deleteRuntimeSession("sess-1");
      const tokens: string[] = [];

      const result = await runDirectChatViaHost({
        query: "hello",
        sessionId: "sess-1",
        model: "ollama/llama3.1:8b",
        callbacks: {
          onToken: (text) => tokens.push(text),
        },
      });

      assertEquals(listed, sessions);
      assertEquals(created.id, "created-1");
      assertEquals(createdSessionBody?.title, "Created");
      assertEquals(found, sessions[0]);
      assertEquals(missing, null);
      assertEquals(listedMessages, messages);
      assertEquals(added.id, 1);
      assertEquals(appendedMessageBody?.content, "reply");
      assertEquals(deleted, true);
      assertEquals(deletedSessionId, "sess-1");
      assertEquals(tokens, ["reply:hello"]);
      assertEquals(result.text, "reply:hello");
      assertEquals(result.sessionVersion, 4);
      assertEquals(capturedChatBody?.mode, "chat");
      assertEquals(capturedChatBody?.session_id, "sess-1");
      assertEquals(capturedChatBody?.model, "ollama/llama3.1:8b");
      assertEquals(
        (capturedChatBody?.messages as Array<Record<string, unknown>>)[0]
          ?.content,
        "hello",
      );
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runAgentQueryViaHost labels host rejections as runtime-host failures", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createHealthResponse(authToken));
    }

    if (url.pathname === "/api/chat") {
      return Response.json({
        error: "Selected model does not support tool calling",
      }, { status: 400 });
    }

    return new Response("Not found", { status: 404 });
  }, {
    hostname: "127.0.0.1",
    port,
    onListen: () => {},
  });

  try {
    await withEnv("HLVM_REPL_PORT", String(port), async () => {
      const error = await assertRejects(
        () =>
          runAgentQueryViaHost({
            query: "go apple.com and find any new macbook stuff",
            model: "ollama/llama3.2:3b",
            workspace: "/tmp/project",
            callbacks: {},
          }),
        RuntimeError,
      );
      assertEquals(error.code, HQLErrorCode.RUNTIME_HOST_REQUEST_FAILED);
      assertStringIncludes(
        error.message,
        "Selected model does not support tool calling",
      );
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runAgentQueryViaHost uses ephemeral session ids for fresh sessions", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  let capturedSessionId = "";

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createHealthResponse(authToken));
    }

    if (url.pathname === "/api/chat") {
      const body = await req.json() as Record<string, unknown>;
      capturedSessionId = String(body.session_id);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ event: "token", text: "fresh" }) + "\n",
            ),
          );
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                event: "complete",
                request_id: "req-2",
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
          "X-Request-ID": "req-2",
        },
      });
    }

    return Response.json({ ok: true });
  }, {
    hostname: "127.0.0.1",
    port,
    onListen: () => {},
  });

  try {
    await withEnv("HLVM_REPL_PORT", String(port), async () => {
      await runAgentQueryViaHost({
        query: "fresh run",
        model: "ollama/llama3.1:8b",
        workspace: "/tmp/project",
        skipSessionHistory: true,
        callbacks: {},
      });
      assertStringIncludes(capturedSessionId, "fresh:");
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runAgentQueryViaHost waits for runtime readiness before sending chat", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  let healthChecks = 0;
  let chatRequests = 0;

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      healthChecks += 1;
      return Response.json(
        await createHealthResponse(authToken, {
          aiReady: healthChecks >= 3,
        }),
      );
    }

    if (url.pathname === "/api/chat") {
      chatRequests += 1;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ event: "token", text: "ready" }) + "\n",
            ),
          );
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                event: "complete",
                request_id: "req-3",
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
          "X-Request-ID": "req-3",
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
      const result = await runAgentQueryViaHost({
        query: "wait for runtime",
        model: "ollama/llama3.1:8b",
        workspace: "/tmp/project",
        callbacks: {},
      });
      assertEquals(result.text, "ready");
      assertEquals(chatRequests, 1);
      assertEquals(healthChecks >= 3, true);
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runtime host client exposes model discovery, installed models, get/delete, and pull streams", async () => {
  let deleteCalls = 0;
  let pullBodies: Array<Record<string, unknown>> = [];

  await withRuntimeHostServer(async (req, authToken) => {
    const url = new URL(req.url);
    assertEquals(req.headers.get("Authorization"), `Bearer ${authToken}`);

    if (url.pathname === "/api/models/installed") {
      assertEquals(url.searchParams.get("provider"), "ollama");
      return Response.json({
        models: [{ name: "llama3.2:latest", metadata: { provider: "ollama" } }],
      });
    }

    if (url.pathname === "/api/models/discovery") {
      return Response.json({
        installedModels: [{ name: "llama3.2:latest" }],
        remoteModels: [{ name: "llama3.2:latest" }, {
          name: "qwen2.5-coder:7b",
        }],
        cloudModels: [{ name: "gpt-4.1", metadata: { provider: "openai" } }],
        failed: url.searchParams.get("refresh") === "true",
      });
    }

    if (url.pathname === "/api/models/status") {
      return Response.json({
        providers: {
          ollama: { available: true },
          "claude-code": { available: true },
          openai: { available: false, error: "Missing API key" },
        },
      });
    }

    if (url.pathname === "/api/models/ollama/llama3.2%3Alatest") {
      if (req.method === "GET") {
        return Response.json({
          name: "llama3.2:latest",
          capabilities: ["chat", "tools"],
        });
      }
      if (req.method === "DELETE") {
        deleteCalls += 1;
        return Response.json({ deleted: true });
      }
    }

    if (url.pathname === "/api/models/pull") {
      pullBodies.push(await req.json() as Record<string, unknown>);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                event: "progress",
                status: "downloading",
                completed: 1,
                total: 2,
              }) + "\n",
            ),
          );
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ event: "complete", name: "llama3.2:latest" }) +
                "\n",
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    const installed = await listRuntimeInstalledModels("ollama");
    const discovery = await getRuntimeModelDiscovery({ refresh: true });
    const claudeStatus = await getRuntimeProviderStatus("claude-code");
    const model = await getRuntimeModel("llama3.2:latest");
    const progressEvents: Array<{ status: string; completed?: number }> = [];
    for await (const progress of pullRuntimeModelViaHost("llama3.2:latest")) {
      progressEvents.push({
        status: progress.status,
        completed: progress.completed,
      });
    }
    const deleted = await deleteRuntimeModel("llama3.2:latest");

    assertEquals(installed.map((item) => item.name), ["llama3.2:latest"]);
    assertEquals(discovery.remoteModels.length, 2);
    assertEquals(discovery.cloudModels.length, 1);
    assertEquals(discovery.failed, true);
    assertEquals(claudeStatus.available, true);
    assertEquals(model?.capabilities, ["chat", "tools"]);
    assertEquals(progressEvents, [{ status: "downloading", completed: 1 }]);
    assertEquals(pullBodies.length, 1);
    assertEquals(pullBodies[0]?.name, "llama3.2:latest");
    assertEquals(deleteCalls, 1);
    assertEquals(deleted, true);
  });
});

Deno.test("runtime host client exposes config get/patch/reset through the runtime boundary", async () => {
  const seenPatches: Array<Record<string, unknown>> = [];

  await withRuntimeHostServer(async (req, authToken) => {
    const url = new URL(req.url);
    assertEquals(req.headers.get("Authorization"), `Bearer ${authToken}`);

    if (url.pathname === "/api/config" && req.method === "GET") {
      return Response.json({
        model: "ollama/llama3.2:latest",
        endpoint: "http://localhost:11434",
        theme: "hlvm",
      });
    }

    if (url.pathname === "/api/config" && req.method === "PATCH") {
      const body = await req.json() as Record<string, unknown>;
      seenPatches.push(body);
      return Response.json({
        model: "openai/gpt-4.1",
        endpoint: "http://localhost:11434",
        theme: "hlvm",
      });
    }

    if (url.pathname === "/api/config/reset") {
      return Response.json({
        model: "ollama/llama3.2:latest",
        endpoint: "http://localhost:11434",
        theme: "hlvm",
      });
    }

    if (url.pathname === "/api/config/reload") {
      return Response.json({
        model: "ollama/llama3.2:latest",
        endpoint: "http://localhost:11434",
        theme: "hlvm",
      });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    const config = await getRuntimeConfig();
    const runtimeConfig = getRuntimeConfigApi();
    const patched = await runtimeConfig.patch({ model: "openai/gpt-4.1" });
    await runtimeConfig.set("theme", "hlvm");
    const reset = await runtimeConfig.reset();
    const reloaded = await runtimeConfig.reload();

    assertEquals(config.model, "ollama/llama3.2:latest");
    assertEquals(patched.model, "openai/gpt-4.1");
    assertEquals(seenPatches.length, 2);
    assertEquals(seenPatches[0]?.model, "openai/gpt-4.1");
    assertEquals(seenPatches[1]?.theme, "hlvm");
    assertEquals(reset.model, "ollama/llama3.2:latest");
    assertEquals(reloaded.model, "ollama/llama3.2:latest");
  });
});

Deno.test("runtime host client exposes Ollama signin and MCP admin flows through the runtime boundary", async () => {
  let addBody: Record<string, unknown> | null = null;
  let removeBody: Record<string, unknown> | null = null;
  let loginBody: Record<string, unknown> | null = null;
  let logoutBody: Record<string, unknown> | null = null;
  let signinCalls = 0;

  await withRuntimeHostServer(async (req, authToken) => {
    const url = new URL(req.url);
    assertEquals(req.headers.get("Authorization"), `Bearer ${authToken}`);

    if (url.pathname === "/api/providers/ollama/signin") {
      signinCalls += 1;
      return Response.json({
        success: true,
        output: ["Open this URL to sign in"],
        signinUrl: "https://ollama.com/connect?token=test",
        browserOpened: true,
      });
    }

    if (url.pathname === "/api/mcp/servers" && req.method === "GET") {
      assertEquals(url.searchParams.get("workspace"), "/tmp/project");
      return Response.json({
        servers: [{
          name: "github",
          command: ["npx", "-y", "@modelcontextprotocol/server-github"],
          scope: "project",
          transport: "stdio",
          target: "npx -y @modelcontextprotocol/server-github",
          scopeLabel: "project",
        }],
      });
    }

    if (url.pathname === "/api/mcp/servers" && req.method === "POST") {
      addBody = await req.json() as Record<string, unknown>;
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/mcp/servers" && req.method === "DELETE") {
      removeBody = await req.json() as Record<string, unknown>;
      return Response.json({ removed: true, scope: "project" });
    }

    if (url.pathname === "/api/mcp/oauth/login") {
      loginBody = await req.json() as Record<string, unknown>;
      return Response.json({
        serverName: "github",
        messages: [
          "Open this URL to authorize MCP server 'github':",
          "OAuth login complete for MCP server 'github'.",
        ],
      });
    }

    if (url.pathname === "/api/mcp/oauth/logout") {
      logoutBody = await req.json() as Record<string, unknown>;
      return Response.json({
        serverName: "github",
        messages: [],
        removed: true,
      });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    const signin = await runRuntimeOllamaSignin();
    const listed = await listRuntimeMcpServers("/tmp/project");
    await addRuntimeMcpServer({
      workspace: "/tmp/project",
      scope: "project",
      server: {
        name: "github",
        command: ["npx", "-y", "@modelcontextprotocol/server-github"],
      },
    });
    const removed = await removeRuntimeMcpServer({
      workspace: "/tmp/project",
      name: "github",
    });
    const login = await loginRuntimeMcpServer({
      workspace: "/tmp/project",
      name: "github",
    });
    const logout = await logoutRuntimeMcpServer({
      workspace: "/tmp/project",
      name: "github",
    });

    assertEquals(signin.success, true);
    assertEquals(signin.browserOpened, true);
    assertEquals(signin.signinUrl, "https://ollama.com/connect?token=test");
    assertEquals(signinCalls, 1);
    assertEquals(listed.length, 1);
    assertEquals(listed[0]?.name, "github");
    assertEquals(addBody?.workspace, "/tmp/project");
    assertEquals(addBody?.scope, "project");
    assertEquals(removeBody?.name, "github");
    assertEquals(removed.scope, "project");
    assertEquals(loginBody?.name, "github");
    assertEquals(
      login.messages.at(-1),
      "OAuth login complete for MCP server 'github'.",
    );
    assertEquals(logoutBody?.workspace, "/tmp/project");
    assertEquals(logout.removed, true);
  });
});
