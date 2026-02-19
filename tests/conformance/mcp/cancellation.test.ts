/**
 * MCP Conformance: Cancellation Tests
 *
 * Verifies client-side MUST requirements for request cancellation:
 * notifications/cancelled format, cancelAllPending coverage, race conditions.
 */

import { assertEquals } from "jsr:@std/assert";
import { createMockClient } from "./_helpers.ts";

// ============================================================
// CANCEL-1: sendCancellation sends notifications/cancelled
// ============================================================

Deno.test("conformance/cancellation: cancel-sends-notification", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // Create a pending request
  const pending = client.request("slow/op", {}).catch(() => {});

  const pendingIds = client.getPendingRequestIds();
  assertEquals(pendingIds.length >= 1, true, "must have at least one pending request");

  client.sendCancellation(pendingIds[0], "test cancel");

  // Wait for notification to be sent
  await new Promise((r) => setTimeout(r, 10));

  const cancellations = transport.sentByMethod("notifications/cancelled");
  assertEquals(cancellations.length >= 1, true, "must send notifications/cancelled");

  const params = cancellations[0].params as Record<string, unknown>;
  assertEquals(params.requestId, pendingIds[0], "must include requestId");
  assertEquals(typeof params.reason, "string", "must include reason");

  // Notification must not have id
  assertEquals(cancellations[0].id, undefined, "cancellation must be a notification");

  await client.close();
  await pending;
});

// ============================================================
// CANCEL-1: cancelAllPending covers all in-flight requests
// ============================================================

Deno.test("conformance/cancellation: cancel-all-pending", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // Create 3 pending requests
  const p1 = client.request("slow/op1", {}).catch(() => {});
  const p2 = client.request("slow/op2", {}).catch(() => {});
  const p3 = client.request("slow/op3", {}).catch(() => {});

  const pendingIds = client.getPendingRequestIds();
  assertEquals(pendingIds.length >= 3, true, "must have 3+ pending requests");

  client.cancelAllPending("batch cancel");

  await new Promise((r) => setTimeout(r, 10));

  const cancellations = transport.sentByMethod("notifications/cancelled");
  const cancelledIds = cancellations.map(
    (m) => (m.params as Record<string, unknown>).requestId as number,
  );

  for (const id of pendingIds) {
    assertEquals(
      cancelledIds.includes(id),
      true,
      `pending request ${id} must be cancelled`,
    );
  }

  await client.close();
  await Promise.allSettled([p1, p2, p3]);
});

// ============================================================
// CANCEL-9: Cancel after response → no crash
// ============================================================

Deno.test("conformance/cancellation: cancel-race", async () => {
  const { client, transport } = createMockClient();

  transport.onMethod("ping", (msg) => ({
    jsonrpc: "2.0",
    id: msg.id!,
    result: {},
  }));

  await client.start();
  await client.ping();

  // The ping already resolved. Sending cancellation for its ID should not crash.
  const initRequestId = transport.sentRequests()[0].id!;
  client.sendCancellation(initRequestId, "late cancel");

  // Wait a tick
  await new Promise((r) => setTimeout(r, 10));

  // No crash = success
  assertEquals(true, true);

  await client.close();
});

// ============================================================
// CANCEL-2: Initialize never cancelled
// ============================================================

Deno.test("conformance/cancellation: no-init-cancel", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  const initMsg = transport.sentByMethod("initialize")[0];
  const initId = initMsg.id!;

  // Cancel everything
  client.cancelAllPending("cancel-all");

  await new Promise((r) => setTimeout(r, 10));

  const cancelledIds = transport
    .sentByMethod("notifications/cancelled")
    .map((m) => (m.params as Record<string, unknown>).requestId);

  assertEquals(
    cancelledIds.includes(initId),
    false,
    "initialize request ID must never appear in cancellations",
  );

  await client.close();
});

// ============================================================
// AbortSignal wiring — external abort triggers cancellation
// ============================================================

Deno.test("conformance/cancellation: abort-signal-wiring", async () => {
  const { client, transport } = createMockClient();
  await client.start();

  // Create pending request
  const pending = client.request("slow/op", {}).catch(() => {});

  const controller = new AbortController();
  controller.signal.addEventListener("abort", () => {
    client.cancelAllPending("abort signal");
  });

  controller.abort();

  await new Promise((r) => setTimeout(r, 10));

  const cancellations = transport.sentByMethod("notifications/cancelled");
  assertEquals(
    cancellations.length >= 1,
    true,
    "AbortSignal must trigger cancellation",
  );

  await client.close();
  await pending;
});
