import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  HLVMErrorCode,
  HQLErrorCode,
  ProviderErrorCode,
} from "../../../src/common/error-codes.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../../src/common/config/types.ts";
import { RuntimeError } from "../../../src/common/error.ts";
import { http } from "../../../src/common/http-client.ts";
import {
  __testOnlyGetRuntimeStartLockPath,
  __testOnlyWaitForStaleFallbackHostSweep,
  addRuntimeMcpServer,
  cancelRuntimeTelegramProvisioningSession,
  completeRuntimeTelegramProvisioningSession,
  createRuntimeTelegramProvisioningSession,
  deleteRuntimeModel,
  getRuntimeAttachment,
  getRuntimeConfig,
  getRuntimeConfigApi,
  getRuntimeReachabilityStatus,
  getRuntimeTelegramProvisioningSession,
  getRuntimeModel,
  getRuntimeModelDiscovery,
  getRuntimeProviderStatus,
  listRuntimeInstalledModels,
  listRuntimeMcpServers,
  loginRuntimeMcpServer,
  logoutRuntimeMcpServer,
  pullRuntimeModelViaHost,
  registerRuntimeAttachmentPath,
  rebindRuntimeReachability,
  removeRuntimeMcpServer,
  runAgentQueryViaHost,
  runChatViaHost,
  runDirectChatViaHost,
  runRuntimeOllamaSignin,
  streamRuntimeReachabilityEvents,
  uploadRuntimeAttachment,
} from "../../../src/hlvm/runtime/host-client.ts";
import { describeErrorForDisplay } from "../../../src/hlvm/agent/error-taxonomy.ts";
import type { AgentUIEvent } from "../../../src/hlvm/agent/orchestrator.ts";
import type { AttachmentRecord } from "../../../src/hlvm/attachments/types.ts";
import {
  getHlvmRuntimeBaseUrl,
  setCachedRuntimeBaseUrl,
  withRuntimePortOverrideForTests,
} from "../../../src/hlvm/runtime/host-config.ts";
import { getPlatform, setPlatform } from "../../../src/platform/platform.ts";
import type { PlatformHttpServerHandle } from "../../../src/platform/types.ts";
import {
  findFreePort,
  withEnv,
  withRuntimeHostServer,
} from "../../shared/light-helpers.ts";
import {
  createRuntimeHostHealthResponse,
} from "../../shared/runtime-host-test-helpers.ts";

const encoder = new TextEncoder();

Deno.test("runtime host start lock path is scoped by runtime port", async () => {
  const first = await withRuntimePortOverrideForTests(
    19143,
    async () => await Promise.resolve(__testOnlyGetRuntimeStartLockPath()),
  );
  const second = await withRuntimePortOverrideForTests(
    19144,
    async () => await Promise.resolve(__testOnlyGetRuntimeStartLockPath()),
  );

  assert(first !== second);
  assertStringIncludes(first, "19143");
  assertStringIncludes(second, "19144");
});

Deno.test("source-mode host client without explicit port refuses to start the shared runtime", async () => {
  const originalPlatform = getPlatform();
  const originalBaseUrl = getHlvmRuntimeBaseUrl();
  const port = await findFreePort();
  let spawnCount = 0;

  setPlatform({
    ...originalPlatform,
    process: {
      ...originalPlatform.process,
      execPath: () => "/usr/local/bin/deno",
    },
    command: {
      ...originalPlatform.command,
      run: () => {
        spawnCount += 1;
        return {
          status: Promise.resolve({
            success: true,
            code: 0,
            signal: undefined,
          }),
          unref: () => {},
        };
      },
    },
  });

  try {
    await withEnv("HLVM_REPL_PORT", "", async () => {
      setCachedRuntimeBaseUrl(`http://127.0.0.1:${port}`);
      const error = await assertRejects(
        async () =>
          await runAgentQueryViaHost({
            query: "source mode should not take over the shared runtime",
            model: "ollama/llama3.1:8b",
            callbacks: {},
          }),
        RuntimeError,
      );

      assertStringIncludes(
        error.message,
        "Source-mode HLVM will not auto-start or replace the shared runtime without an explicit runtime port.",
      );
      assertEquals(spawnCount, 0);
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    setCachedRuntimeBaseUrl(originalBaseUrl);
    setPlatform(originalPlatform);
  }
});

Deno.test("runAgentQueryViaHost streams events, traces, and interaction responses", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  let capturedChatBody: Record<string, unknown> | null = null;
  let capturedInteractionBody: Record<string, unknown> | null = null;

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createRuntimeHostHealthResponse(authToken));
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
          emit({ event: "heartbeat" });
          emit({ event: "thinking", iteration: 1 });
          emit({
            event: "reasoning_update",
            iteration: 1,
            summary: "Inspect the file before editing.",
          });
          emit({
            event: "planning_update",
            iteration: 1,
            summary: "Read the file, then patch the smallest safe diff.",
          });
          emit({ event: "token", text: "Let me fetch that first. " });
          emit({
            event: "tool_start",
            name: "read_file",
            args_summary: "src/main.ts",
            tool_index: 1,
            tool_total: 1,
          });
          emit({
            event: "tool_progress",
            name: "read_file",
            args_summary: "src/main.ts",
            message: "Scanning file contents",
            phase: "scan",
            tone: "running",
          });
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
            event: "plan_phase_changed",
            phase: "researching",
          });
          emit({
            event: "plan_created",
            plan: {
              goal: "Inspect docs",
              steps: [{ id: "step-1", title: "Read docs" }],
            },
          });
          emit({
            event: "plan_step",
            step_id: "step-1",
            index: 0,
            completed: true,
          });
          emit({
            event: "plan_review_required",
            plan: {
              goal: "Edit docs",
              steps: [{ id: "step-1", title: "Update README" }],
            },
          });
          emit({
            event: "plan_review_resolved",
            plan: {
              goal: "Edit docs",
              steps: [{ id: "step-1", title: "Update README" }],
            },
            approved: true,
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
          emit({ event: "token", text: "done" });
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
      const uiEvents: AgentUIEvent[] = [];
      const traces: string[] = [];
      const metaEvents: number[] = [];

      const result = await runAgentQueryViaHost({
        query: "fix it",
        attachmentIds: ["att_example_png", "att_example_pdf"],
        model: "ollama/llama3.1:8b",
        permissionMode: "acceptEdits",
        contextWindow: 4096,
        callbacks: {
          onToken: (text) => tokens.push(text),
          onAgentEvent: (event) => uiEvents.push(event),
          onTrace: (event) => traces.push(event.type),
          onFinalResponseMeta: (meta) =>
            metaEvents.push(meta.citationSpans.length),
        },
        onInteraction: async (event) => {
          assertEquals(event.mode, "permission");
          assertEquals(event.toolName, "write_file");
          return await Promise.resolve({ approved: true });
        },
      });

      assertEquals(tokens, ["Let me fetch that first. ", "done"]);
      const eventTypes = uiEvents.map((event) => event.type);
      assert(eventTypes.includes("thinking"));
      assert(eventTypes.includes("reasoning_update"));
      assert(eventTypes.includes("planning_update"));
      assert(eventTypes.includes("tool_start"));
      assert(eventTypes.includes("tool_progress"));
      assert(eventTypes.includes("tool_end"));
      assert(eventTypes.includes("plan_phase_changed"));
      assert(eventTypes.includes("plan_created"));
      assert(eventTypes.includes("plan_step"));
      assert(eventTypes.includes("plan_review_required"));
      assert(eventTypes.includes("plan_review_resolved"));

      const toolProgress = uiEvents.find((event) =>
        event.type === "tool_progress"
      );
      assertEquals(toolProgress?.type, "tool_progress");
      if (toolProgress?.type === "tool_progress") {
        assertEquals(toolProgress.name, "read_file");
        assertEquals(toolProgress.argsSummary, "src/main.ts");
        assertEquals(toolProgress.message, "Scanning file contents");
        assertEquals(toolProgress.phase, "scan");
        assertEquals(toolProgress.tone, "running");
      }
      assertEquals(traces, ["iteration"]);
      assertEquals(metaEvents, [1]);
      assertEquals(result.text, "Let me fetch that first. done");
      assertEquals(result.stats.estimatedTokens, 123);
      assertEquals(result.stats.usage?.totalTokens, 15);

      assert(capturedChatBody !== null);
      assertEquals(capturedChatBody?.session_id, undefined);
      assertEquals(capturedChatBody?.permission_mode, "acceptEdits");
      assertEquals(capturedChatBody?.context_window, 4096);
      assertEquals(capturedChatBody?.skip_session_history, undefined);
      assertEquals(capturedChatBody?.trace, true);
      assertEquals(
        (capturedChatBody?.messages as Array<Record<string, unknown>>)[0]
          ?.attachment_ids,
        ["att_example_png", "att_example_pdf"],
      );
      assertEquals(capturedInteractionBody?.request_id, "interaction-1");
      assertEquals(capturedInteractionBody?.approved, true);
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runChatViaHost forwards agent max_tokens and maps continuation-aware turn stats", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  let capturedChatBody: Record<string, unknown> | null = null;

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createRuntimeHostHealthResponse(authToken));
    }

    if (url.pathname === "/api/chat") {
      capturedChatBody = await req.json();
      const stream = new ReadableStream({
        start(controller) {
          const emit = (obj: unknown) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          emit({ event: "start", request_id: "req-agent-max" });
          emit({ event: "token", text: "merged-response" });
          emit({
            event: "turn_stats",
            iteration: 1,
            tool_count: 0,
            continued_this_turn: true,
            continuation_count: 1,
            compaction_reason: "proactive_pressure",
          });
          emit({
            event: "complete",
            request_id: "req-agent-max",
            session_version: 1,
          });
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson",
          "X-Request-ID": "req-agent-max",
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
      const events: AgentUIEvent[] = [];
      const result = await runChatViaHost({
        mode: "agent",
        querySource: "repl_main_thread",
        model: "ollama/test-fixture",
        maxTokens: 64,
        messages: [{
          role: "user",
          content: "continue the answer",
        }],
        callbacks: {
          onAgentEvent: (event) => events.push(event),
        },
      });

      assertEquals(capturedChatBody?.mode, "agent");
      assertEquals(capturedChatBody?.query_source, "repl_main_thread");
      assertEquals(capturedChatBody?.max_tokens, 64);
      assertEquals(result.text, "merged-response");

      const turnStats = events.find((event) => event.type === "turn_stats");
      assertEquals(turnStats?.type, "turn_stats");
      if (turnStats?.type === "turn_stats") {
        assertEquals(turnStats.continuedThisTurn, true);
        assertEquals(turnStats.continuationCount, 1);
        assertEquals(turnStats.compactionReason, "proactive_pressure");
      }
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runAgentQueryViaHost forwards structured interaction options", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createRuntimeHostHealthResponse(authToken));
    }

    if (url.pathname === "/api/chat/interaction") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/chat") {
      const stream = new ReadableStream({
        start(controller) {
          const emit = (obj: unknown) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          emit({ event: "start", request_id: "req-2" });
          emit({
            event: "interaction_request",
            request_id: "interaction-2",
            mode: "question",
            question: "Which approach should I use?",
            options: [
              {
                label: "Keep signposts",
                value: "keep_signposts",
                detail: "Remove logs only.",
                recommended: true,
              },
              {
                label: "Remove all perf instrumentation",
                value: "remove_all",
                detail: "Remove logs and signposts.",
              },
            ],
          });
          emit({ event: "complete", request_id: "req-2", session_version: 1 });
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

    return new Response("Not found", { status: 404 });
  }, {
    hostname: "127.0.0.1",
    port,
    onListen: () => {},
  });

  try {
    await withEnv("HLVM_REPL_PORT", String(port), async () => {
      let capturedSelection = "";
      await runAgentQueryViaHost({
        query: "plan it",
        model: "ollama/llama3.1:8b",
        permissionMode: "plan",
        onInteraction: async (event) => {
          assertEquals(event.mode, "question");
          assertEquals(event.question, "Which approach should I use?");
          assertEquals(event.options?.[0]?.value, "keep_signposts");
          assertEquals(event.options?.[0]?.recommended, true);
          capturedSelection = event.options?.[0]?.value ?? "";
          return await Promise.resolve({
            approved: true,
            userInput: capturedSelection,
          });
        },
      });
      assertEquals(capturedSelection, "keep_signposts");
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
  }
});

Deno.test("runAgentQueryViaHost retries an early transient plan-mode stream drop before plan review", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  let chatRequestCount = 0;
  const uiEvents: string[] = [];

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createRuntimeHostHealthResponse(authToken));
    }

    if (url.pathname === "/api/chat") {
      chatRequestCount += 1;
      const stream = new ReadableStream({
        start(controller) {
          const emit = (obj: unknown) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          emit({ event: "start", request_id: `req-${chatRequestCount}` });
          emit({ event: "plan_phase_changed", phase: "researching" });
          emit({ event: "thinking", iteration: 1 });
          if (chatRequestCount === 1) {
            controller.error(
              new TypeError("error reading a body from connection"),
            );
            return;
          }
          emit({ event: "token", text: "Plan recovered." });
          emit({
            event: "complete",
            request_id: `req-${chatRequestCount}`,
            session_version: 1,
          });
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson",
          "X-Request-ID": `req-${chatRequestCount}`,
        },
      });
    }

    if (url.pathname === "/api/chat/cancel") {
      return Response.json({ cancelled: true });
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
        query: "Plan a small edit",
        model: "claude-code/claude-opus-4-6",
        permissionMode: "plan",
        callbacks: {
          onAgentEvent: (event) => uiEvents.push(event.type),
        },
      });

      assertEquals(result.text, "Plan recovered.");
      assertEquals(chatRequestCount, 2);
      assertEquals(uiEvents.includes("plan_phase_changed"), true);
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runDirectChatViaHost retries an early transient stream drop before the first token", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  let chatRequestCount = 0;

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createRuntimeHostHealthResponse(authToken));
    }

    if (url.pathname === "/api/chat") {
      chatRequestCount += 1;
      const stream = new ReadableStream({
        start(controller) {
          const emit = (obj: unknown) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          emit({ event: "start", request_id: `req-${chatRequestCount}` });
          if (chatRequestCount === 1) {
            controller.error(
              new TypeError("error reading a body from connection"),
            );
            return;
          }
          emit({ event: "token", text: "Recovered chat." });
          emit({
            event: "complete",
            request_id: `req-${chatRequestCount}`,
            session_version: 1,
          });
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson",
          "X-Request-ID": `req-${chatRequestCount}`,
        },
      });
    }

    if (url.pathname === "/api/chat/cancel") {
      return Response.json({ cancelled: true });
    }

    return new Response("Not found", { status: 404 });
  }, {
    hostname: "127.0.0.1",
    port,
    onListen: () => {},
  });

  try {
    await withEnv("HLVM_REPL_PORT", String(port), async () => {
      const result = await runDirectChatViaHost({
        query: "Say hi",
        callbacks: {
          onToken: () => {},
        },
      });

      assertEquals(result.text, "Recovered chat.");
      assertEquals(chatRequestCount, 2);
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runtime host client streams direct chat through the active conversation contract", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  let capturedChatBody: {
    mode?: string;
    session_id?: string;
    model?: string;
    messages?: Array<{ content?: string }>;
  } | null = null;

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createRuntimeHostHealthResponse(authToken));
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
      const tokens: string[] = [];
      const result = await runDirectChatViaHost({
        query: "hello",
        model: "ollama/llama3.1:8b",
        callbacks: {
          onToken: (text) => tokens.push(text),
        },
      });

      assertEquals(tokens, ["reply:hello"]);
      assertEquals(result.text, "reply:hello");
      assertEquals(result.sessionVersion, 4);
      assertEquals(capturedChatBody?.mode, "chat");
      assertEquals(capturedChatBody?.session_id, undefined);
      assertEquals(capturedChatBody?.model, "ollama/llama3.1:8b");
      assertEquals(
        capturedChatBody?.messages?.[0]?.content,
        "hello",
      );
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runtime host client registers, uploads, and fetches attachments", async () => {
  const attachmentRecord: AttachmentRecord = {
    id: "att_example_png",
    blobSha256: "a".repeat(64),
    fileName: "pixel.png",
    mimeType: "image/png",
    kind: "image",
    size: 3,
    createdAt: "2026-03-17T00:00:00.000Z",
    updatedAt: "2026-03-17T00:00:00.000Z",
    lastAccessedAt: "2026-03-17T00:00:00.000Z",
  };
  let registerBody: Record<string, unknown> | null = null;
  let uploadedFile: File | null = null;
  let uploadedSourcePath: string | null = null;
  let requestedAttachmentId: string | null = null;

  await withRuntimeHostServer(async (req, authToken) => {
    const url = new URL(req.url);
    assertEquals(req.headers.get("Authorization"), `Bearer ${authToken}`);

    if (url.pathname === "/api/attachments/register") {
      registerBody = await req.json();
      return Response.json(attachmentRecord, { status: 201 });
    }

    if (url.pathname === "/api/attachments/upload") {
      const form = await req.formData();
      const file = form.get("file");
      assert(file instanceof File);
      uploadedFile = file;
      const sourcePath = form.get("source_path");
      uploadedSourcePath = typeof sourcePath === "string" ? sourcePath : null;
      return Response.json(attachmentRecord, { status: 201 });
    }

    if (url.pathname === "/api/attachments/att_example_png") {
      requestedAttachmentId = "att_example_png";
      return Response.json(attachmentRecord);
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    const registered = await registerRuntimeAttachmentPath("/tmp/pixel.png");
    const uploaded = await uploadRuntimeAttachment(
      "pixel.png",
      new Uint8Array([1, 2, 3]),
      { mimeType: "image/png", sourcePath: "/tmp/pixel.png" },
    );
    const fetched = await getRuntimeAttachment("att_example_png");

    assertEquals(registered, attachmentRecord);
    assertEquals(uploaded, attachmentRecord);
    assertEquals(fetched, attachmentRecord);
    assertEquals(registerBody, { path: "/tmp/pixel.png" });
    assertEquals(uploadedFile?.name, "pixel.png");
    assertEquals(uploadedFile?.type, "image/png");
    assertEquals(
      Array.from(new Uint8Array(await uploadedFile!.arrayBuffer())),
      [1, 2, 3],
    );
    assertEquals(uploadedSourcePath, "/tmp/pixel.png");
    assertEquals(requestedAttachmentId, "att_example_png");
    await __testOnlyWaitForStaleFallbackHostSweep();
  });
});

Deno.test("runAgentQueryViaHost labels host request rejections as runtime-host request rejected", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createRuntimeHostHealthResponse(authToken));
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
            callbacks: {},
          }),
        RuntimeError,
      );
      assertEquals(error.code, HLVMErrorCode.REQUEST_REJECTED);
      assertStringIncludes(
        error.message,
        "Selected model does not support tool calling",
      );
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runAgentQueryViaHost maps payload-too-large responses to a dedicated host code", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createRuntimeHostHealthResponse(authToken));
    }

    if (url.pathname === "/api/chat") {
      return Response.json({
        error: "Request too large",
      }, { status: 413 });
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
            query: "send a big request",
            model: "ollama/llama3.2:3b",
            callbacks: {},
          }),
        RuntimeError,
      );
      assertEquals(error.code, HLVMErrorCode.REQUEST_TOO_LARGE);
      assertStringIncludes(error.message, "Request too large");
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runAgentQueryViaHost preserves provider codes returned by the runtime host", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createRuntimeHostHealthResponse(authToken));
    }

    if (url.pathname === "/api/chat") {
      return Response.json({
        error: "[PRV9004] Provider API key is invalid",
      }, { status: 502 });
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
            query: "call provider with bad auth",
            model: "ollama/llama3.2:3b",
            callbacks: {},
          }),
        RuntimeError,
      );
      assertEquals(error.code, ProviderErrorCode.AUTH_FAILED);
      assertStringIncludes(error.message, "[PRV9004]");
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runAgentQueryViaHost maps generic host timeouts to transport errors", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createRuntimeHostHealthResponse(authToken));
    }

    if (url.pathname === "/api/chat") {
      return Response.json({
        error: "Runtime host request timed out while waiting for worker",
      }, { status: 408 });
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
            query: "hit a timeout",
            model: "ollama/llama3.2:3b",
            callbacks: {},
          }),
        RuntimeError,
      );
      assertEquals(error.code, HLVMErrorCode.TRANSPORT_ERROR);
      assertStringIncludes(error.message, "timed out");
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runAgentQueryViaHost maps malformed runtime streams to stream protocol error", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createRuntimeHostHealthResponse(authToken));
    }

    if (url.pathname === "/api/chat") {
      return new Response(
        "this-is-not-json",
        {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson",
            "X-Request-ID": "req-invalid-stream",
          },
        },
      );
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
            query: "this stream is bad",
            model: "ollama/llama3.2:3b",
            callbacks: {},
          }),
        RuntimeError,
      );
      assertEquals(error.code, HLVMErrorCode.STREAM_ERROR);
      assertStringIncludes(
        error.message,
        "Failed to parse runtime host stream event",
      );
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runAgentQueryViaHost preserves structured HQL codes from streamed host errors", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createRuntimeHostHealthResponse(authToken));
    }

    if (url.pathname === "/api/chat") {
      return new Response(
        encoder.encode(
          `${
            JSON.stringify({
              event: "error",
              message: "[HQL5001] variable foo is not defined",
            })
          }\n`,
        ),
        {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson",
            "X-Request-ID": "req-structured-error",
          },
        },
      );
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
            query: "trigger hql runtime failure",
            model: "ollama/llama3.2:3b",
            callbacks: {},
          }),
        RuntimeError,
      );
      assertEquals(error.code, HQLErrorCode.UNDEFINED_VARIABLE);
      assertStringIncludes(error.message, "[HQL5001]");
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runAgentQueryViaHost sends stateless requests without rebinding the active conversation", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  let capturedChatBody: {
    stateless?: boolean;
    session_id?: string;
  } | null = null;

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(await createRuntimeHostHealthResponse(authToken));
    }

    if (url.pathname === "/api/chat") {
      capturedChatBody = await req.json();
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
        stateless: true,
        callbacks: {},
      });
      assertEquals(capturedChatBody?.stateless, true);
      assertEquals(capturedChatBody?.session_id, undefined);
      await __testOnlyWaitForStaleFallbackHostSweep();
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
        await createRuntimeHostHealthResponse(authToken, {
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
        callbacks: {},
      });
      assertEquals(result.text, "ready");
      assertEquals(chatRequests, 1);
      assertEquals(healthChecks >= 3, true);
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runAgentQueryViaHost surfaces non-retryable AI readiness reasons without waiting for the full poll window", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  let healthChecks = 0;
  let chatRequests = 0;

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      healthChecks += 1;
      return Response.json(
        await createRuntimeHostHealthResponse(authToken, {
          aiReady: false,
          aiReadyReason:
            "Local Julienning fallback (ollama/gemma4:e4b) is not ready for AI requests: authentication is unexpectedly required",
          aiReadyRetryable: false,
        }),
      );
    }

    if (url.pathname === "/api/chat") {
      chatRequests += 1;
      return new Response("unexpected chat request", { status: 500 });
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
            query: "blocked on runtime readiness",
            model: "ollama/llama3.1:8b",
            callbacks: {},
          }),
        RuntimeError,
      );
      assertEquals(error.code, HLVMErrorCode.REQUEST_FAILED);
      assertStringIncludes(error.message, "ollama/gemma4:e4b");
      assertEquals(chatRequests, 0);
      assertEquals(healthChecks < 10, true);
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runAgentQueryViaHost takes over runtime startup after an abandoned start lock", async () => {
  const port = await findFreePort();
  const authToken = "lock-handoff-auth-token";
  const originalPlatform = getPlatform();
  const lockPath = await withRuntimePortOverrideForTests(
    port,
    async () => await Promise.resolve(__testOnlyGetRuntimeStartLockPath()),
  );
  const serverHandleRef: { current: PlatformHttpServerHandle | null } = {
    current: null,
  };
  let spawnCount = 0;

  setPlatform({
    ...originalPlatform,
    command: {
      ...originalPlatform.command,
      run: () => {
        spawnCount += 1;
        if (!serverHandleRef.current) {
          serverHandleRef.current = originalPlatform.http.serveWithHandle!(
            async (req) => {
              const url = new URL(req.url);
              if (url.pathname === "/health") {
                return Response.json(
                  await createRuntimeHostHealthResponse(authToken),
                );
              }

              if (url.pathname === "/api/chat") {
                const stream = new ReadableStream({
                  start(controller) {
                    controller.enqueue(
                      encoder.encode(
                        JSON.stringify({ event: "token", text: "handoff" }) +
                          "\n",
                      ),
                    );
                    controller.enqueue(
                      encoder.encode(
                        JSON.stringify({
                          event: "complete",
                          request_id: "req-lock-handoff",
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
                    "X-Request-ID": "req-lock-handoff",
                  },
                });
              }

              return new Response("Not found", { status: 404 });
            },
            {
              hostname: "127.0.0.1",
              port,
              onListen: () => {},
            },
          );
        }

        return {
          status: Promise.resolve({
            success: true,
            code: 0,
            signal: undefined,
          }),
          unref: () => {},
        };
      },
    },
  });

  try {
    await originalPlatform.fs.remove(lockPath, { recursive: true }).catch(
      () => {},
    );
    await originalPlatform.fs.mkdir(lockPath);

    const releaseTimer = setTimeout(() => {
      void originalPlatform.fs.remove(lockPath, { recursive: true }).catch(
        () => {},
      );
    }, 150);

    try {
      const result = await withRuntimePortOverrideForTests(
        port,
        async () =>
          await runAgentQueryViaHost({
            query: "recover from abandoned lock",
            model: "ollama/llama3.1:8b",
            callbacks: {},
          }),
      );

      assertEquals(result.text, "handoff");
      assertEquals(spawnCount, 1);
      await __testOnlyWaitForStaleFallbackHostSweep();
    } finally {
      clearTimeout(releaseTimer);
    }
  } finally {
    setPlatform(originalPlatform);
    await originalPlatform.fs.remove(lockPath, { recursive: true }).catch(
      () => {},
    );
    const serverHandle = serverHandleRef.current;
    if (serverHandle) {
      await serverHandle.shutdown();
      await serverHandle.finished;
    }
  }
});

Deno.test("runAgentQueryViaHost reclaims an idle incompatible runtime host on the base port", async () => {
  const basePort = await findFreePort();
  const incompatibleAuthToken = "idle-incompatible-auth-token";
  const originalPlatform = getPlatform();
  let incompatibleHandle: PlatformHttpServerHandle | null = null;
  const spawnedHandles: PlatformHttpServerHandle[] = [];
  const spawnedPorts: number[] = [];
  let shutdownRequests = 0;

  incompatibleHandle = originalPlatform.http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({
        ...await createRuntimeHostHealthResponse(incompatibleAuthToken, {
          activeRequests: 0,
        }),
        buildId: "incompatible-build",
      });
    }

    if (url.pathname === "/api/runtime/shutdown") {
      shutdownRequests += 1;
      setTimeout(() => {
        void incompatibleHandle?.shutdown().catch(() => {});
      }, 0);
      return Response.json({ ok: true, shutting_down: true });
    }

    return new Response("Not found", { status: 404 });
  }, {
    hostname: "127.0.0.1",
    port: basePort,
    onListen: () => {},
  });

  setPlatform({
    ...originalPlatform,
    command: {
      ...originalPlatform.command,
      run: (options) => {
        const port = Number.parseInt(
          options.env?.HLVM_REPL_PORT ?? String(basePort),
          10,
        );
        const authToken = options.env?.HLVM_AUTH_TOKEN ?? "spawned-auth-token";
        const buildId = options.env?.HLVM_RUNTIME_BUILD_ID ?? "spawned-build";
        spawnedPorts.push(port);
        const handle = originalPlatform.http.serveWithHandle!(async (req) => {
          const url = new URL(req.url);
          if (url.pathname === "/health") {
            return Response.json({
              ...await createRuntimeHostHealthResponse(authToken, {
                activeRequests: 0,
              }),
              buildId,
            });
          }

          if (url.pathname === "/api/chat") {
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({ event: "token", text: "reclaimed" }) +
                      "\n",
                  ),
                );
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({
                      event: "complete",
                      request_id: "req-reclaimed-idle",
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
                "X-Request-ID": "req-reclaimed-idle",
              },
            });
          }

          return new Response("Not found", { status: 404 });
        }, {
          hostname: "127.0.0.1",
          port,
          onListen: () => {},
        });
        spawnedHandles.push(handle);
        return {
          status: Promise.resolve({ success: true, code: 0, signal: undefined }),
          unref: () => {},
        };
      },
    },
  });

  try {
    const result = await withRuntimePortOverrideForTests(
      basePort,
      async () =>
        await runAgentQueryViaHost({
          query: "reclaim idle incompatible host",
          model: "ollama/llama3.1:8b",
          callbacks: {},
        }),
    );

    assertEquals(result.text, "reclaimed");
    assertEquals(shutdownRequests, 1);
    assertEquals(spawnedPorts, [basePort]);
    await __testOnlyWaitForStaleFallbackHostSweep();
  } finally {
    setPlatform(originalPlatform);
    await incompatibleHandle?.shutdown().catch(() => {});
    await incompatibleHandle?.finished.catch(() => {});
    for (const handle of spawnedHandles) {
      await handle.shutdown().catch(() => {});
      await handle.finished.catch(() => {});
    }
  }
});

Deno.test("runAgentQueryViaHost fails when an active incompatible runtime host owns the base port", async () => {
  const basePort = await findFreePort();
  const incompatibleAuthToken = "active-incompatible-auth-token";
  const originalPlatform = getPlatform();
  const incompatibleHandle = originalPlatform.http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({
        ...await createRuntimeHostHealthResponse(incompatibleAuthToken, {
          activeRequests: 1,
        }),
        buildId: "incompatible-build",
      });
    }

    if (url.pathname === "/api/runtime/shutdown") {
      return new Response("unexpected shutdown", { status: 500 });
    }

    return new Response("Not found", { status: 404 });
  }, {
    hostname: "127.0.0.1",
    port: basePort,
    onListen: () => {},
  });

  const spawnedHandles: PlatformHttpServerHandle[] = [];
  const spawnedPorts: number[] = [];

  setPlatform({
    ...originalPlatform,
    command: {
      ...originalPlatform.command,
      run: (options) => {
        const port = Number.parseInt(
          options.env?.HLVM_REPL_PORT ?? String(basePort),
          10,
        );
        const authToken = options.env?.HLVM_AUTH_TOKEN ?? "spawned-auth-token";
        const buildId = options.env?.HLVM_RUNTIME_BUILD_ID ?? "spawned-build";
        spawnedPorts.push(port);
        const handle = originalPlatform.http.serveWithHandle!(async (req) => {
          const url = new URL(req.url);
          if (url.pathname === "/health") {
            return Response.json({
              ...await createRuntimeHostHealthResponse(authToken, {
                activeRequests: 0,
              }),
              buildId,
            });
          }

          if (url.pathname === "/api/chat") {
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({ event: "token", text: "expanded" }) + "\n",
                  ),
                );
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({
                      event: "complete",
                      request_id: "req-expanded-active",
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
                "X-Request-ID": "req-expanded-active",
              },
            });
          }

          return new Response("Not found", { status: 404 });
        }, {
          hostname: "127.0.0.1",
          port,
          onListen: () => {},
        });
        spawnedHandles.push(handle);
        return {
          status: Promise.resolve({ success: true, code: 0, signal: undefined }),
          unref: () => {},
        };
      },
    },
  });

  try {
    await assertRejects(
      async () =>
        await withRuntimePortOverrideForTests(
          basePort,
          async () =>
            await runAgentQueryViaHost({
              query: "preserve active incompatible host",
              model: "ollama/llama3.1:8b",
              callbacks: {},
            }),
        ),
      RuntimeError,
      `A different runtime is already using port ${basePort}`,
    );
    assertEquals(spawnedPorts, []);
    await __testOnlyWaitForStaleFallbackHostSweep();
  } finally {
    setPlatform(originalPlatform);
    await incompatibleHandle.shutdown();
    await incompatibleHandle.finished;
    for (const handle of spawnedHandles) {
      await handle.shutdown().catch(() => {});
      await handle.finished.catch(() => {});
    }
  }
});

Deno.test("runAgentQueryViaHost leaves unrelated fallback hosts untouched after attaching to a compatible base host", async () => {
  const basePort = await findFreePort();
  const fallbackPort = basePort + 1;
  const fallbackUrl = `http://127.0.0.1:${fallbackPort}`;
  const compatibleAuthToken = "base-compatible-auth-token";
  const incompatibleAuthToken = "fallback-incompatible-auth-token";
  let fallbackHandle: PlatformHttpServerHandle | null = null;
  let fallbackShutdownRequests = 0;

  const baseHandle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json(
        await createRuntimeHostHealthResponse(compatibleAuthToken, {
          activeRequests: 0,
        }),
      );
    }

    if (url.pathname === "/api/chat") {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ event: "token", text: "base" }) + "\n",
            ),
          );
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                event: "complete",
                request_id: "req-base-compatible",
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
          "X-Request-ID": "req-base-compatible",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  }, {
    hostname: "127.0.0.1",
    port: basePort,
    onListen: () => {},
  });

  fallbackHandle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({
        ...await createRuntimeHostHealthResponse(incompatibleAuthToken, {
          activeRequests: 0,
        }),
        buildId: "fallback-incompatible-build",
      });
    }

    if (url.pathname === "/api/runtime/shutdown") {
      fallbackShutdownRequests += 1;
      setTimeout(() => {
        void fallbackHandle?.shutdown().catch(() => {});
      }, 0);
      return Response.json({ ok: true, shutting_down: true });
    }

    return new Response("Not found", { status: 404 });
  }, {
    hostname: "127.0.0.1",
    port: fallbackPort,
    onListen: () => {},
  });

  try {
    const result = await withRuntimePortOverrideForTests(
      basePort,
      async () =>
        await runAgentQueryViaHost({
          query: "sweep fallback hosts",
          model: "ollama/llama3.1:8b",
          callbacks: {},
        }),
    );

    assertEquals(result.text, "base");
    const fallbackHealth = await http.fetchRaw(fallbackUrl + "/health");
    assertEquals(fallbackHealth.status, 200);
    await fallbackHealth.body?.cancel();
    assertEquals(fallbackShutdownRequests, 0);
    await __testOnlyWaitForStaleFallbackHostSweep();
  } finally {
    await baseHandle.shutdown().catch(() => {});
    await baseHandle.finished.catch(() => {});
    await fallbackHandle?.shutdown().catch(() => {});
    await fallbackHandle?.finished.catch(() => {});
  }
});

Deno.test("runAgentQueryViaHost accepts compatible runtime hosts when the compiled artifact path differs", async () => {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  let chatRequests = 0;

  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      const health = await createRuntimeHostHealthResponse(authToken);
      const buildIdParts = String(health.buildId).split("|");
      buildIdParts[1] = `/private/var/folders/runtime/${
        buildIdParts[1]?.split("/").pop() ?? "hlvm"
      }`;
      return Response.json({
        ...health,
        buildId: buildIdParts.join("|"),
      });
    }

    if (url.pathname === "/api/chat") {
      chatRequests += 1;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ event: "token", text: "compatible" }) + "\n",
            ),
          );
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                event: "complete",
                request_id: "req-compatible",
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
          "X-Request-ID": "req-compatible",
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
        query: "compatible host",
        model: "ollama/llama3.1:8b",
        callbacks: {},
      });
      assertEquals(result.text, "compatible");
      assertEquals(chatRequests, 1);
      await __testOnlyWaitForStaleFallbackHostSweep();
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
});

Deno.test("runtime host client exposes model discovery, installed models, get/delete, and pull streams", async () => {
  let deleteCalls = 0;
  const pullBodies: Array<Record<string, unknown>> = [];

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
    await __testOnlyWaitForStaleFallbackHostSweep();
  });
});

Deno.test("pullRuntimeModelViaHost cancels the response stream when the consumer stops early", async () => {
  let streamCancelled = false;

  await withRuntimeHostServer((req, authToken) => {
    const url = new URL(req.url);
    assertEquals(req.headers.get("Authorization"), `Bearer ${authToken}`);

    if (url.pathname === "/api/models/pull") {
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
        },
        cancel() {
          streamCancelled = true;
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    for await (const _progress of pullRuntimeModelViaHost("llama3.2:latest")) {
      break;
    }

    const deadline = Date.now() + 200;
    while (!streamCancelled && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assertEquals(streamCancelled, true);
    await __testOnlyWaitForStaleFallbackHostSweep();
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
        endpoint: DEFAULT_OLLAMA_ENDPOINT,
        theme: "hlvm",
      });
    }

    if (url.pathname === "/api/config" && req.method === "PATCH") {
      const body = await req.json() as Record<string, unknown>;
      seenPatches.push(body);
      return Response.json({
        model: "openai/gpt-4.1",
        endpoint: DEFAULT_OLLAMA_ENDPOINT,
        theme: "hlvm",
      });
    }

    if (url.pathname === "/api/config/reset") {
      return Response.json({
        model: "ollama/llama3.2:latest",
        endpoint: DEFAULT_OLLAMA_ENDPOINT,
        theme: "hlvm",
      });
    }

    if (url.pathname === "/api/config/reload") {
      return Response.json({
        model: "ollama/llama3.2:latest",
        endpoint: DEFAULT_OLLAMA_ENDPOINT,
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
    await __testOnlyWaitForStaleFallbackHostSweep();
  });
});

Deno.test("runtime host client exposes reachability and Telegram provisioning flows through the runtime boundary", async () => {
  const createRequests: Array<Record<string, unknown>> = [];
  const completeRequests: Array<Record<string, unknown>> = [];
  const pendingSession = {
    channel: "telegram",
    sessionId: "session-1",
    state: "pending" as const,
    setupUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_test_bot?name=HLVM",
    pairCode: "1234",
    managerBotUsername: "hlvm_manager_bot",
    botName: "HLVM",
    botUsername: "hlvm_test_bot",
    qrKind: "create_bot",
    provisionUrl:
      "https://provision.hlvm.dev/telegram/start?session=session-1",
    createUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_test_bot?name=HLVM",
    createdAt: "2026-04-21T00:00:00.000Z",
    expiresAt: "2026-04-21T00:10:00.000Z",
  };

  await withRuntimeHostServer(async (req, authToken) => {
    const url = new URL(req.url);
    assertEquals(req.headers.get("Authorization"), `Bearer ${authToken}`);

    if (url.pathname === "/api/reachability/status") {
      return Response.json({
        channels: [{
          channel: "telegram",
          configured: true,
          enabled: true,
          state: "connecting",
          mode: "direct",
          allowedIds: [],
          lastError: null,
        }],
      });
    }

    if (url.pathname === "/api/reachability/rebind") {
      return Response.json({
        channels: [{
          channel: "telegram",
          configured: true,
          enabled: true,
          state: "connected",
          mode: "direct",
          allowedIds: ["chat-1"],
          lastError: null,
        }],
      });
    }

    if (
      url.pathname === "/api/channels/telegram/provisioning/session" &&
      req.method === "POST"
    ) {
      createRequests.push(await req.json() as Record<string, unknown>);
      return Response.json(pendingSession, { status: 201 });
    }

    if (
      url.pathname === "/api/channels/telegram/provisioning/session" &&
      req.method === "GET"
    ) {
      return Response.json(pendingSession);
    }

    if (
      url.pathname === "/api/channels/telegram/provisioning/session/complete"
    ) {
      completeRequests.push(await req.json() as Record<string, unknown>);
      return Response.json({
        session: {
          ...pendingSession,
          state: "completed",
          completedAt: "2026-04-21T00:00:01.000Z",
        },
        status: {
          channel: "telegram",
          configured: true,
          enabled: true,
          state: "connected",
          mode: "direct",
          allowedIds: ["chat-1"],
          lastError: null,
        },
      });
    }

    if (
      url.pathname === "/api/channels/telegram/provisioning/session/cancel"
    ) {
      return Response.json({ cancelled: true });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    const reachability = await getRuntimeReachabilityStatus();
    const rebound = await rebindRuntimeReachability();
    const created = await createRuntimeTelegramProvisioningSession({
      botName: "HLVM",
    });
    const pending = await getRuntimeTelegramProvisioningSession();
    const completed = await completeRuntimeTelegramProvisioningSession({
      sessionId: "session-1",
      token: "123:abc",
      username: "hlvm_test_bot",
    });
    const cancelled = await cancelRuntimeTelegramProvisioningSession();

    assertEquals(reachability.channels[0]?.state, "connecting");
    assertEquals(rebound.channels[0]?.state, "connected");
    assertEquals(created.sessionId, "session-1");
    assertEquals(
      created.provisionUrl,
      "https://provision.hlvm.dev/telegram/start?session=session-1",
    );
    assertEquals(pending?.pairCode, "1234");
    assertEquals(completed?.session.state, "completed");
    assertEquals(completed?.status?.state, "connected");
    assertEquals(cancelled, true);
    assertEquals(createRequests, [{ botName: "HLVM" }]);
    assertEquals(completeRequests, [{
      sessionId: "session-1",
      token: "123:abc",
      username: "hlvm_test_bot",
    }]);
    await __testOnlyWaitForStaleFallbackHostSweep();
  });
});

Deno.test("runtime host client returns null when Telegram provisioning session is missing", async () => {
  await withRuntimeHostServer((req, authToken) => {
    const url = new URL(req.url);
    assertEquals(req.headers.get("Authorization"), `Bearer ${authToken}`);

    if (url.pathname === "/api/channels/telegram/provisioning/session") {
      return Response.json({ error: "missing" }, { status: 404 });
    }

    if (url.pathname === "/api/channels/telegram/provisioning/session/complete") {
      return Response.json({ error: "missing" }, { status: 404 });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    const pending = await getRuntimeTelegramProvisioningSession();
    const completed = await completeRuntimeTelegramProvisioningSession({
      sessionId: "missing",
      token: "123:abc",
    });

    assertEquals(pending, null);
    assertEquals(completed, null);
    await __testOnlyWaitForStaleFallbackHostSweep();
  });
});

Deno.test("runtime host client streams reachability SSE updates and cancels the stream when the consumer stops", async () => {
  let streamCancelled = false;

  await withRuntimeHostServer((req, authToken) => {
    const url = new URL(req.url);
    assertEquals(req.headers.get("Authorization"), `Bearer ${authToken}`);

    if (url.pathname === "/api/reachability/events") {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("retry: 3000\n\n"));
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
          controller.enqueue(encoder.encode(
            [
              "id: 1",
              "event: reachability_updated",
              'data: {"channels":[{"channel":"telegram","configured":true,"enabled":true,"state":"connected","mode":"direct","allowedIds":["chat-1"],"lastError":null}]}',
              "",
              "",
            ].join("\n"),
          ));
        },
        cancel() {
          streamCancelled = true;
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    const events: Array<{ id?: string; state?: string }> = [];

    for await (const event of streamRuntimeReachabilityEvents()) {
      events.push({
        id: event.id,
        state: event.data.channels[0]?.state,
      });
      break;
    }

    const deadline = Date.now() + 200;
    while (!streamCancelled && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    assertEquals(events, [{ id: "1", state: "connected" }]);
    assertEquals(streamCancelled, true);
    await __testOnlyWaitForStaleFallbackHostSweep();
  });
});

Deno.test("runtime host client exposes Ollama signin and MCP admin flows through the runtime boundary", async () => {
  let addBody: Record<string, unknown> | null = null;
  let removeBody: Record<string, unknown> | null = null;
  let loginBody: Record<string, unknown> | null = null;
  let _logoutBody: Record<string, unknown> | null = null;
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
      return Response.json({
        servers: [{
          name: "github",
          command: ["npx", "-y", "@modelcontextprotocol/server-github"],
          scope: "user",
          transport: "stdio",
          target: "npx -y @modelcontextprotocol/server-github",
          status: "✓ Connected",
          scopeLabel: "user",
          scopeDescription: "User config (available in all your projects)",
        }],
      });
    }

    if (url.pathname === "/api/mcp/servers" && req.method === "POST") {
      addBody = await req.json() as Record<string, unknown>;
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/mcp/servers" && req.method === "DELETE") {
      removeBody = await req.json() as Record<string, unknown>;
      return Response.json({ removed: true });
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
      _logoutBody = await req.json() as Record<string, unknown>;
      return Response.json({
        serverName: "github",
        messages: [],
        removed: true,
      });
    }

    return new Response("Not found", { status: 404 });
  }, async () => {
    const signin = await runRuntimeOllamaSignin();
    const listed = await listRuntimeMcpServers();
    await addRuntimeMcpServer({
      server: {
        name: "github",
        command: ["npx", "-y", "@modelcontextprotocol/server-github"],
      },
    });
    const _removed = await removeRuntimeMcpServer({
      name: "github",
    });
    const login = await loginRuntimeMcpServer({
      name: "github",
    });
    const logout = await logoutRuntimeMcpServer({
      name: "github",
    });

    assertEquals(signin.success, true);
    assertEquals(signin.browserOpened, true);
    assertEquals(signin.signinUrl, "https://ollama.com/connect?token=test");
    assertEquals(signinCalls, 1);
    assertEquals(listed.length, 1);
    assertEquals(listed[0]?.name, "github");
    assertEquals(addBody?.server !== undefined, true);
    assertEquals(removeBody?.name, "github");
    assertEquals(loginBody?.name, "github");
    assertEquals(
      login.messages.at(-1),
      "OAuth login complete for MCP server 'github'.",
    );
    assertEquals(logout.removed, true);
    await __testOnlyWaitForStaleFallbackHostSweep();
  });
});

Deno.test("runChatViaHost preserves the server's faithful stream error classification for display", async () => {
  const serverMessage =
    "Internal HLVM error while handling the request: Cannot read properties of undefined (reading 'type')";
  const serverHint =
    "This looks like an HLVM bug, not a bad command. Retry once; if it persists, keep the exact command and error text.";

  let requestCount = 0;

  await withRuntimeHostServer(async (req) => {
    const url = new URL(req.url);
    if (url.pathname !== "/api/chat") {
      return new Response("Not found", { status: 404 });
    }
    requestCount += 1;

    const stream = new ReadableStream({
      start(controller) {
        const emit = (obj: unknown) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        emit({ event: "start", request_id: "req-stream-err" });
        emit({
          event: "error",
          message: serverMessage,
          errorClass: "unknown",
          retryable: false,
          hint: serverHint,
        });
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "X-Request-ID": "req-stream-err",
      },
    });
  }, async () => {
    const caught = await assertRejects(
      async () =>
        await runChatViaHost({
          mode: "agent",
          querySource: "repl_main_thread",
          model: "ollama/test-fixture",
          messages: [{ role: "user", content: "hi" }],
        }),
      Error,
    );

    const described = await describeErrorForDisplay(caught);

    assertEquals(
      described.class,
      "unknown",
      "class must match the server's faithful classification",
    );
    assertEquals(
      described.retryable,
      false,
      "retryable must match the server's faithful classification",
    );
    assertStringIncludes(
      described.message,
      "Cannot read properties of undefined (reading 'type')",
    );
    assertEquals(
      described.hint,
      serverHint,
      "hint must be the server's faithful hint, not the REQUEST_FAILED 'Restart HLVM' fallback",
    );
    assert(
      !(described.hint ?? "").toLowerCase().includes("restart hlvm"),
      `hint must not contain the misleading "Restart HLVM" fallback, got: ${described.hint}`,
    );
    assertEquals(requestCount, 1);
    await __testOnlyWaitForStaleFallbackHostSweep();
  });
});
