/**
 * MCP Conformance: JSON-RPC Base Protocol Tests
 *
 * Verifies client-side MUST requirements for JSON-RPC 2.0 message framing:
 * version field, unique IDs, notification format, response routing, error handling.
 */

import { assertEquals } from "jsr:@std/assert";
import { createMockClient, MockTransport } from "./_helpers.ts";
import { McpClient } from "../../../src/hlvm/agent/mcp/client.ts";

// ============================================================
// BASE-1: All sent messages have jsonrpc: "2.0"
// ============================================================

Deno.test("conformance/jsonrpc: messages-have-jsonrpc-2.0", async () => {
  const { client, transport } = createMockClient();

  transport.onMethod("ping", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: {},
  }));

  await client.start();
  await client.ping();
  await client.close();

  for (const msg of transport.sent) {
    assertEquals(msg.jsonrpc, "2.0", `All messages must have jsonrpc: "2.0"`);
  }
});

// ============================================================
// BASE-3,5: Request IDs are unique integers
// ============================================================

Deno.test("conformance/jsonrpc: requests-have-unique-id", async () => {
  const { client, transport } = createMockClient();

  transport.onMethod("tools/list", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: { tools: [] },
  }));
  transport.onMethod("ping", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: {},
  }));

  await client.start();
  await client.listTools();
  await client.ping();
  await client.close();

  const requests = transport.sentRequests();
  const ids = requests.map((m) => m.id!);
  // All must be numbers
  for (const id of ids) {
    assertEquals(typeof id, "number", "Request IDs must be numbers");
  }
  // All must be unique
  const uniqueIds = new Set(ids);
  assertEquals(uniqueIds.size, ids.length, "Request IDs must be unique");
});

// ============================================================
// BASE-11: Notifications have no id field
// ============================================================

Deno.test("conformance/jsonrpc: notifications-have-no-id", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // notifications/initialized is a notification
  const notifications = transport.sentNotifications();
  assertEquals(notifications.length >= 1, true, "must send at least one notification");

  for (const notif of notifications) {
    assertEquals(notif.id, undefined, "Notifications must not have an id field");
    assertEquals(typeof notif.method, "string", "Notifications must have a method");
  }

  await client.close();
});

// ============================================================
// BASE-6: Matching id resolves correct promise
// ============================================================

Deno.test("conformance/jsonrpc: response-resolves-pending", async () => {
  const { client, transport } = createMockClient();

  transport.onMethod("ping", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: { pong: true },
  }));

  await client.start();
  const result = await client.ping();

  // ping returns void (result is discarded), but the promise resolved
  // Verify no error was thrown — reaching this line is success
  assertEquals(true, true);

  await client.close();
});

// ============================================================
// BASE-8,9: Error response rejects with code + message
// ============================================================

Deno.test("conformance/jsonrpc: error-response-rejects", async () => {
  const { client, transport } = createMockClient();

  transport.onMethod("tools/call", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    error: { code: -32602, message: "Invalid params" },
  }));

  await client.start();

  let caught = false;
  let errorMsg = "";
  try {
    await client.callTool("bad", {});
  } catch (e) {
    caught = true;
    errorMsg = (e as Error).message;
  }

  assertEquals(caught, true, "error response must reject promise");
  assertEquals(
    errorMsg.includes("Invalid params"),
    true,
    "error message must include server error text",
  );

  await client.close();
});

// ============================================================
// Response with unknown id — no crash
// ============================================================

Deno.test("conformance/jsonrpc: unknown-id-ignored", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // Inject a response with an id that doesn't match any pending request
  transport.injectMessage({
    jsonrpc: "2.0",
    id: 999999,
    result: { unexpected: true },
  });

  // Should not crash — reaching this line is success
  assertEquals(true, true);

  await client.close();
});

// ============================================================
// Server request dispatched to handler
// ============================================================

Deno.test("conformance/jsonrpc: server-request-dispatched", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  let handlerCalled = false;
  client.onRequest("sampling/createMessage", async (_params) => {
    handlerCalled = true;
    return { role: "assistant", content: { type: "text", text: "hi" }, model: "m" };
  });

  // Inject server request (has both id + method)
  transport.injectMessage({
    jsonrpc: "2.0",
    id: 5000,
    method: "sampling/createMessage",
    params: { messages: [], maxTokens: 10 },
  });

  await new Promise((r) => setTimeout(r, 50));
  assertEquals(handlerCalled, true, "server request must dispatch to handler");

  // Client should have sent response
  const response = transport.sent.find(
    (m) => m.id === 5000 && m.result !== undefined,
  );
  assertEquals(response !== undefined, true, "must send response for server request");

  await client.close();
});

// ============================================================
// Unregistered method → -32601 error
// ============================================================

Deno.test("conformance/jsonrpc: unhandled-method-gets-32601", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  transport.injectMessage({
    jsonrpc: "2.0",
    id: 6000,
    method: "nonexistent/method",
    params: {},
  });

  await new Promise((r) => setTimeout(r, 50));

  const errorResp = transport.sent.find(
    (m) => m.id === 6000 && m.error !== undefined,
  );
  assertEquals(errorResp !== undefined, true, "must send error for unknown method");
  assertEquals(
    (errorResp!.error as { code: number }).code,
    -32601,
    "error code must be -32601 (Method not found)",
  );

  await client.close();
});
