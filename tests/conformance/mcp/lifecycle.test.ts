/**
 * MCP Conformance: Lifecycle Tests
 *
 * Verifies client-side MUST requirements for MCP lifecycle management:
 * initialization, version negotiation, capabilities, and shutdown.
 */

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { createMockClient, createRawClient, MockTransport } from "./_helpers.ts";
import { McpClient } from "../../../src/hlvm/agent/mcp/client.ts";

// ============================================================
// LC-2: initialize sends required fields
// ============================================================

Deno.test("conformance/lifecycle: init-sends-required-fields", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  const initMsg = transport.sentByMethod("initialize")[0];
  assertEquals(initMsg !== undefined, true, "initialize message must be sent");
  assertEquals(initMsg.jsonrpc, "2.0");
  assertEquals(typeof initMsg.id, "number");

  const params = initMsg.params as Record<string, unknown>;
  assertEquals(typeof params.protocolVersion, "string", "must have protocolVersion");
  assertEquals(typeof params.clientInfo, "object", "must have clientInfo");
  assertEquals(typeof params.capabilities, "object", "must have capabilities");

  const clientInfo = params.clientInfo as Record<string, unknown>;
  assertEquals(typeof clientInfo.name, "string", "clientInfo must have name");
  assertEquals(typeof clientInfo.version, "string", "clientInfo must have version");

  await client.close();
});

// ============================================================
// LC-4: notifications/initialized sent after init response
// ============================================================

Deno.test("conformance/lifecycle: init-sends-initialized", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  const initialized = transport.sentByMethod("notifications/initialized");
  assertEquals(initialized.length, 1, "must send exactly one notifications/initialized");
  assertEquals(initialized[0].id, undefined, "notifications/initialized must be a notification (no id)");

  // Verify ordering: initialize request before initialized notification
  const initIdx = transport.sent.findIndex((m) => m.method === "initialize");
  const initializedIdx = transport.sent.findIndex(
    (m) => m.method === "notifications/initialized",
  );
  assertEquals(initIdx < initializedIdx, true, "initialize must precede notifications/initialized");

  await client.close();
});

// ============================================================
// LC-9,10: version negotiation — accept 2024-11-05
// ============================================================

Deno.test("conformance/lifecycle: version-accept-2024-11-05", async () => {
  const { client, transport } = createMockClient({ tools: {} }, "2024-11-05");
  await client.start();

  // Client should accept and send initialized
  const initialized = transport.sentByMethod("notifications/initialized");
  assertEquals(initialized.length, 1, "must accept 2024-11-05 and send initialized");
  assertEquals(client.hasCapability("tools"), true);

  await client.close();
});

// ============================================================
// LC-9,10: version negotiation — accept 2025-03-26
// ============================================================

Deno.test("conformance/lifecycle: version-accept-2025-03-26", async () => {
  const { client, transport } = createMockClient({ tools: {} }, "2025-03-26");
  await client.start();

  const initialized = transport.sentByMethod("notifications/initialized");
  assertEquals(initialized.length, 1, "must accept 2025-03-26 and send initialized");

  await client.close();
});

// ============================================================
// LC-12: unknown version → transport.close()
// ============================================================

Deno.test("conformance/lifecycle: version-reject-unknown", async () => {
  const transport = new MockTransport();
  transport.setupInitialize({ tools: {} }, "9999-99-99");
  const client = new McpClient(
    { name: "mock", command: ["mock"] },
    transport,
  );

  await client.start();

  // Transport should have been closed
  assertEquals(transport.closeCalled, true, "must close transport on unknown version");

  // Should NOT have sent initialized
  const initialized = transport.sentByMethod("notifications/initialized");
  assertEquals(initialized.length, 0, "must not send initialized on unknown version");
});

// ============================================================
// Bug 1: close() must NOT send "shutdown" notification
// ============================================================

Deno.test("conformance/lifecycle: close-no-shutdown-msg", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  await client.close();

  const shutdownMsgs = transport.sent.filter(
    (m) => m.method === "shutdown",
  );
  assertEquals(shutdownMsgs.length, 0, "close() must not send 'shutdown' notification");
});

// ============================================================
// close() fails all pending requests
// ============================================================

Deno.test("conformance/lifecycle: close-fails-pending", async () => {
  const { client } = createMockClient();
  await client.start();

  // Create a pending request that won't resolve
  const pending = client.request("slow/op", {}).catch((e) => e);

  await client.close();

  const err = await pending;
  assertEquals(err instanceof Error, true, "pending request must reject on close");
  assertEquals(
    (err as Error).message.includes("closed"),
    true,
    "error message should mention closed",
  );
});

// ============================================================
// close() is idempotent
// ============================================================

Deno.test("conformance/lifecycle: close-idempotent", async () => {
  const { client } = createMockClient();
  await client.start();

  await client.close();
  // Second close should not throw
  await client.close();
});

// ============================================================
// request() after close throws
// ============================================================

Deno.test("conformance/lifecycle: closed-rejects-requests", async () => {
  const { client } = createMockClient();
  await client.start();
  await client.close();

  await assertRejects(
    () => client.request("some/method", {}),
    Error,
    "closed",
  );
});

// ============================================================
// Bug 5: start() timeout on hanging transport
// ============================================================

Deno.test("conformance/lifecycle: start-timeout", async () => {
  const transport = new MockTransport();
  transport.hangOnStart = true;
  const client = new McpClient(
    { name: "hanging", command: ["mock"] },
    transport,
  );

  await assertRejects(
    () => client.start(),
    Error,
    "timed out",
  );
});

// ============================================================
// LC-15: capabilities tracked from server response
// ============================================================

Deno.test("conformance/lifecycle: capabilities-tracked", async () => {
  const { client } = createMockClient({
    tools: {},
    resources: { subscribe: true },
    prompts: {},
    logging: {},
  });
  await client.start();

  assertEquals(client.hasCapability("tools"), true);
  assertEquals(client.hasCapability("resources"), true);
  assertEquals(client.hasCapability("prompts"), true);
  assertEquals(client.hasCapability("logging"), true);
  assertEquals(client.hasCapability("nonexistent"), false);

  await client.close();
});

// ============================================================
// CANCEL-2: initialize request ID never cancelled
// ============================================================

Deno.test("conformance/lifecycle: no-init-cancel", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // Get the initialize request ID
  const initMsg = transport.sentByMethod("initialize")[0];
  const initId = initMsg.id!;

  // Cancel all pending — the init request should NOT appear in cancellations
  // (it already resolved, so it won't be in pending map)
  client.cancelAllPending("test");

  const cancellations = transport.sentByMethod("notifications/cancelled");
  const cancelledIds = cancellations.map(
    (m) => (m.params as Record<string, unknown>).requestId,
  );
  assertEquals(
    cancelledIds.includes(initId),
    false,
    "initialize request must never be cancelled",
  );

  await client.close();
});
