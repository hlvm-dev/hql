import { assert, assertEquals } from "jsr:@std/assert";
import { loadMcpTools } from "../../../src/hlvm/agent/mcp/mod.ts";
import { getTool } from "../../../src/hlvm/agent/registry.ts";
import { sanitizeToolName } from "../../../src/hlvm/agent/tool-schema.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import type { PlatformHttpServerHandle } from "../../../src/platform/types.ts";
import {
  serveWithRetry,
  withServePermissionGuard,
} from "./oauth-test-helpers.ts";
import { withTempHlvmDir } from "../helpers.ts";

interface SseFixtureState {
  port: number;
  server: PlatformHttpServerHandle;
  streamController: ReadableStreamDefaultController<Uint8Array> | null;
}

function encodeSseMessage(
  event: string,
  payload?: unknown,
  options?: { rawData?: boolean },
): Uint8Array {
  const lines = [`event: ${event}`];
  if (payload !== undefined) {
    lines.push(
      options?.rawData ? `data: ${String(payload)}` : `data: ${JSON.stringify(payload)}`,
    );
  }
  lines.push("", "");
  return new TextEncoder().encode(lines.join("\n"));
}

async function startSseFixture(): Promise<SseFixtureState> {
  const state: SseFixtureState = {
    port: 0,
    server: null as unknown as PlatformHttpServerHandle,
    streamController: null,
  };
  const { promise: listening, resolve: onListening } = Promise.withResolvers<
    void
  >();

  const server = await serveWithRetry(
    {
      port: 0,
      hostname: "127.0.0.1",
      onListen({ port }) {
        state.port = port;
        onListening();
      },
    },
    async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/sse" && req.method === "GET") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            state.streamController = controller;
            controller.enqueue(
              encodeSseMessage(
                "endpoint",
                `http://127.0.0.1:${state.port}/messages`,
                { rawData: true },
              ),
            );
          },
          cancel() {
            state.streamController = null;
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      if (url.pathname === "/messages" && req.method === "POST") {
        const payload = await req.json() as
          | { id?: number | string; method: string; params?: Record<string, unknown> }
          | Array<{ id?: number | string; method: string; params?: Record<string, unknown> }>;
        const messages = Array.isArray(payload) ? payload : [payload];
        for (const message of messages) {
          if (message.method === "initialize") {
            state.streamController?.enqueue(encodeSseMessage("message", {
              jsonrpc: "2.0",
              id: message.id,
              result: {
                protocolVersion: "2025-11-25",
                serverInfo: { name: "sse-test", version: "0.1.0" },
                capabilities: { tools: {} },
              },
            }));
          } else if (message.method === "notifications/initialized") {
            // No response for notifications.
          } else if (message.method === "tools/list") {
            state.streamController?.enqueue(encodeSseMessage("message", {
              jsonrpc: "2.0",
              id: message.id,
              result: {
                tools: [{
                  name: "echo",
                  description: "Echo back the input",
                  inputSchema: {
                    type: "object",
                    properties: {
                      message: { type: "string", description: "Message to echo" },
                    },
                  },
                }],
              },
            }));
          } else if (message.method === "tools/call") {
            const argumentsRecord = message.params?.arguments &&
                typeof message.params.arguments === "object"
              ? message.params.arguments as Record<string, unknown>
              : undefined;
            state.streamController?.enqueue(encodeSseMessage("message", {
              jsonrpc: "2.0",
              id: message.id,
              result: {
                content: [{
                  type: "text",
                  text: String(argumentsRecord?.message ?? ""),
                }],
              },
            }));
          } else if (message.id !== undefined) {
            state.streamController?.enqueue(encodeSseMessage("message", {
              jsonrpc: "2.0",
              id: message.id,
              error: { code: -32601, message: "Method not found" },
            }));
          }
        }
        return new Response(null, { status: 202 });
      }

      return new Response("Not Found", { status: 404 });
    },
  );

  state.server = server;
  await listening;
  return state;
}

async function withWorkspace(
  fn: (workspace: string) => Promise<void>,
): Promise<void> {
  const platform = getPlatform();
  const workspace = await platform.fs.makeTempDir({ prefix: "hlvm-mcp-sse-" });
  try {
    await fn(workspace);
  } finally {
    await platform.fs.remove(workspace, { recursive: true });
  }
}

Deno.test({
  name: "MCP SSE: dedicated SSE transport registers and executes remote tools",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withTempHlvmDir(async () => {
      await withServePermissionGuard(async () => {
        const fixture = await startSseFixture();
        try {
          await withWorkspace(async (workspace) => {
            const echoToolName = sanitizeToolName("mcp_sse-test_echo");
            const { tools, dispose } = await loadMcpTools(workspace, [{
              name: "sse-test",
              url: `http://127.0.0.1:${fixture.port}/sse`,
              transport: "sse",
            }]);

            try {
              assert(tools.includes(echoToolName));
              const result = await getTool(echoToolName).fn(
                { message: "hello over sse" },
                workspace,
              ) as { content: Array<{ type: string; text: string }> };
              assertEquals(result.content[0]?.text, "hello over sse");
            } finally {
              await dispose();
            }
          });
        } finally {
          fixture.streamController?.close();
          await fixture.server.shutdown();
        }
      });
    });
  },
});
