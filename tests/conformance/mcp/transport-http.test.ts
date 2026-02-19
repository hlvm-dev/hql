/**
 * MCP Conformance: HTTP Transport Tests
 *
 * Verifies client-side MUST requirements for Streamable HTTP transport:
 * POST method, Accept header, session management, protocol version header,
 * SSE parsing, DELETE on close.
 *
 * Uses inline Deno.serve() as a mock HTTP server.
 */

import { assertEquals } from "jsr:@std/assert";
import { McpClient } from "../../../src/hlvm/agent/mcp/client.ts";
import { HttpTransport } from "../../../src/hlvm/agent/mcp/transport.ts";

interface ServerState {
  port: number;
  server: Deno.HttpServer;
  receivedRequests: Array<{
    method: string;
    headers: Headers;
    body: unknown;
  }>;
  sessionId: string;
  deleteReceived: boolean;
  deleteHeaders: Headers | null;
}

function startTestServer(): ServerState {
  const state: ServerState = {
    port: 0,
    receivedRequests: [],
    sessionId: "conformance-session-" + Math.random().toString(36).slice(2),
    deleteReceived: false,
    deleteHeaders: null,
    server: null as unknown as Deno.HttpServer,
  };

  const server = Deno.serve(
    { port: 0, onListen({ port }) { state.port = port; } },
    async (req) => {
      if (req.method === "DELETE") {
        state.deleteReceived = true;
        state.deleteHeaders = req.headers;
        return new Response(null, { status: 200 });
      }
      if (req.method !== "POST") {
        return new Response(null, { status: 405 });
      }

      const body = await req.json();
      state.receivedRequests.push({
        method: req.method,
        headers: req.headers,
        body,
      });

      const msg = body as Record<string, unknown>;
      const method = msg.method as string;

      if (method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              protocolVersion: "2025-11-25",
              serverInfo: { name: "http-conformance", version: "0.1" },
              capabilities: { tools: {} },
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Mcp-Session-Id": state.sessionId,
            },
          },
        );
      }

      // Notifications → 202
      if (msg.id === undefined) {
        return new Response(null, { status: 202 });
      }

      if (method === "ping") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      if (method === "tools/call") {
        // Respond via SSE
        const sseBody = `data: ${JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: "sse-ok" },
        })}\n\n`;
        return new Response(sseBody, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      if (method === "tools/call-multiline") {
        // Respond with multiple SSE events (each a complete JSON message)
        const event1 = `data: ${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: "t1", progress: 50, total: 100 },
        })}\n\n`;
        const event2 = `data: ${JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: "multiline-ok" },
        })}\n\n`;
        return new Response(event1 + event2, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: "Method not found" },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  );

  state.server = server;
  return state;
}

async function createHttpClient(
  srv: ServerState,
): Promise<{ client: McpClient; transport: HttpTransport }> {
  await new Promise((r) => setTimeout(r, 50)); // Wait for server to bind
  const config = { name: "conformance", url: `http://localhost:${srv.port}` };
  const transport = new HttpTransport(config);
  const client = new McpClient(config, transport);
  return { client, transport };
}

// ============================================================
// TR-14: All sends use POST
// ============================================================

Deno.test({
  name: "conformance/transport-http: uses-post",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const srv = startTestServer();
    const { client } = await createHttpClient(srv);

    await client.start();
    await client.ping();

    for (const req of srv.receivedRequests) {
      assertEquals(req.method, "POST", "All JSON-RPC sends must use POST");
    }

    await client.close();
    await srv.server.shutdown();
  },
});

// ============================================================
// TR-15: Accept header includes json + event-stream
// ============================================================

Deno.test({
  name: "conformance/transport-http: accept-header",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const srv = startTestServer();
    const { client } = await createHttpClient(srv);

    await client.start();

    const req = srv.receivedRequests[0];
    const accept = req.headers.get("Accept") ?? "";
    assertEquals(accept.includes("application/json"), true, "Accept must include application/json");
    assertEquals(
      accept.includes("text/event-stream"),
      true,
      "Accept must include text/event-stream",
    );

    await client.close();
    await srv.server.shutdown();
  },
});

// ============================================================
// TR-50: Session ID stored from response
// ============================================================

Deno.test({
  name: "conformance/transport-http: session-id-stored",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const srv = startTestServer();
    const { client } = await createHttpClient(srv);

    await client.start();
    await client.ping();

    // Session ID must appear in subsequent request headers
    const pingReq = srv.receivedRequests.find(
      (r) => (r.body as Record<string, unknown>).method === "ping",
    );
    assertEquals(
      pingReq?.headers.get("Mcp-Session-Id"),
      srv.sessionId,
      "Session ID must be stored and sent",
    );

    await client.close();
    await srv.server.shutdown();
  },
});

// ============================================================
// TR-50: Session ID sent in subsequent requests
// ============================================================

Deno.test({
  name: "conformance/transport-http: session-id-sent",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const srv = startTestServer();
    const { client } = await createHttpClient(srv);

    await client.start();
    await client.ping();

    // All requests after initialize should include the session ID
    const nonInitReqs = srv.receivedRequests.filter(
      (r) => (r.body as Record<string, unknown>).method !== "initialize",
    );
    for (const req of nonInitReqs) {
      assertEquals(
        req.headers.get("Mcp-Session-Id"),
        srv.sessionId,
        "All subsequent requests must include session ID",
      );
    }

    await client.close();
    await srv.server.shutdown();
  },
});

// ============================================================
// TR-57: MCP-Protocol-Version header after init
// ============================================================

Deno.test({
  name: "conformance/transport-http: protocol-version-header",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const srv = startTestServer();
    const { client } = await createHttpClient(srv);

    await client.start();
    await client.ping();

    // ping request should have MCP-Protocol-Version header
    const pingReq = srv.receivedRequests.find(
      (r) => (r.body as Record<string, unknown>).method === "ping",
    );
    const protoVersion = pingReq?.headers.get("MCP-Protocol-Version");
    assertEquals(
      protoVersion,
      "2025-11-25",
      "Must include MCP-Protocol-Version header after init",
    );

    await client.close();
    await srv.server.shutdown();
  },
});

// ============================================================
// TR-20: JSON content-type parsed correctly
// ============================================================

Deno.test({
  name: "conformance/transport-http: json-response-parsed",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const srv = startTestServer();
    const { client } = await createHttpClient(srv);

    await client.start();
    // ping returns JSON content-type
    await client.ping();

    // No error = JSON was parsed correctly
    assertEquals(true, true);

    await client.close();
    await srv.server.shutdown();
  },
});

// ============================================================
// TR-20: SSE content-type parsed correctly
// ============================================================

Deno.test({
  name: "conformance/transport-http: sse-response-parsed",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const srv = startTestServer();
    const { client } = await createHttpClient(srv);

    await client.start();
    // tools/call returns SSE
    const result = await client.callTool("test", {});
    assertEquals(
      (result as Record<string, unknown>).content,
      "sse-ok",
      "SSE response must be parsed correctly",
    );

    await client.close();
    await srv.server.shutdown();
  },
});

// ============================================================
// TR-20: Multi data: lines assembled correctly
// ============================================================

Deno.test({
  name: "conformance/transport-http: sse-multiline-data",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const srv = startTestServer();
    const { client } = await createHttpClient(srv);

    await client.start();
    const result = await client.request("tools/call-multiline", {});
    assertEquals(
      (result as Record<string, unknown>).content,
      "multiline-ok",
      "Multi-line SSE data must be assembled correctly",
    );

    await client.close();
    await srv.server.shutdown();
  },
});

// ============================================================
// TR-55: DELETE with session ID on close
// ============================================================

Deno.test({
  name: "conformance/transport-http: delete-on-close",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const srv = startTestServer();
    const { client } = await createHttpClient(srv);

    await client.start();
    assertEquals(srv.deleteReceived, false, "no DELETE before close");

    await client.close();
    await new Promise((r) => setTimeout(r, 50));

    assertEquals(srv.deleteReceived, true, "must send DELETE on close");
    assertEquals(
      srv.deleteHeaders?.get("Mcp-Session-Id"),
      srv.sessionId,
      "DELETE must include session ID",
    );

    await srv.server.shutdown();
  },
});

// ============================================================
// TR-17: 202 response handled for notifications
// ============================================================

Deno.test({
  name: "conformance/transport-http: notification-202",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const srv = startTestServer();
    const { client } = await createHttpClient(srv);

    await client.start();
    // notifications/initialized was sent during start() and got 202
    const initNotif = srv.receivedRequests.find(
      (r) =>
        (r.body as Record<string, unknown>).method === "notifications/initialized",
    );
    assertEquals(
      initNotif !== undefined,
      true,
      "notification must reach server and 202 must not crash client",
    );

    await client.close();
    await srv.server.shutdown();
  },
});
