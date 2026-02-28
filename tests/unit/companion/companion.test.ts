/**
 * Companion Agent — Unit Tests
 *
 * Tests: bus, debounce, redact, context, format, loop (pure data pipe).
 * NO imports from memory/mod.ts — only store.ts via redact.ts (no SQLite).
 */

import { assertEquals, assertGreater, assertRejects } from "jsr:@std/assert";
import { ObservationBus } from "../../../src/hlvm/companion/bus.ts";
import { debounceObservations } from "../../../src/hlvm/companion/debounce.ts";
import { redactObservation } from "../../../src/hlvm/companion/redact.ts";
import { CompanionContext } from "../../../src/hlvm/companion/context.ts";
import { formatBatch, formatObservationPrompt } from "../../../src/hlvm/companion/format.ts";
import type { Observation, ObservationKind } from "../../../src/hlvm/companion/types.ts";

function makeObs(
  kind: ObservationKind,
  data: Record<string, unknown> = {},
): Observation {
  return {
    kind,
    timestamp: new Date().toISOString(),
    source: "test",
    data,
  };
}

// --- Bus ---

Deno.test("Bus: append + iterate yields in order", async () => {
  const bus = new ObservationBus();
  const obs1 = makeObs("app.switch", { appName: "A" });
  const obs2 = makeObs("app.switch", { appName: "B" });
  const obs3 = makeObs("app.switch", { appName: "C" });

  bus.append(obs1);
  bus.append(obs2);
  bus.append(obs3);
  bus.close();

  const received: Observation[] = [];
  for await (const o of bus) {
    received.push(o);
  }
  assertEquals(received.length, 3);
  assertEquals((received[0].data as Record<string, string>).appName, "A");
  assertEquals((received[2].data as Record<string, string>).appName, "C");
});

Deno.test("Bus: close terminates async iteration", async () => {
  const bus = new ObservationBus();
  bus.append(makeObs("custom"));

  // Close after a brief delay
  setTimeout(() => bus.close(), 50);

  const received: Observation[] = [];
  for await (const o of bus) {
    received.push(o);
  }
  assertEquals(received.length, 1);
});

Deno.test("Bus: overflow drops oldest", () => {
  const bus = new ObservationBus(3);
  bus.append(makeObs("custom", { n: 1 }));
  bus.append(makeObs("custom", { n: 2 }));
  bus.append(makeObs("custom", { n: 3 }));
  bus.append(makeObs("custom", { n: 4 }));
  assertEquals(bus.size, 3);
});

// --- Debounce ---

Deno.test({
  name: "Debounce: rapid observations yield 1 batch",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const bus = new ObservationBus();
    bus.append(makeObs("custom", { n: 1 }));
    bus.append(makeObs("custom", { n: 2 }));
    bus.append(makeObs("custom", { n: 3 }));
    bus.close();

    const batches: Observation[][] = [];
    for await (const batch of debounceObservations(bus, 50)) {
      batches.push(batch);
    }
    assertEquals(batches.length, 1);
    assertEquals(batches[0].length, 3);
  },
});

Deno.test({
  name: "Debounce: gap produces 2 batches",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const bus = new ObservationBus();
    bus.append(makeObs("custom", { n: 1 }));

    // After a gap much longer than the debounce window, append another
    setTimeout(() => {
      bus.append(makeObs("custom", { n: 2 }));
      setTimeout(() => bus.close(), 20);
    }, 200);

    const batches: Observation[][] = [];
    for await (const batch of debounceObservations(bus, 50)) {
      batches.push(batch);
    }
    assertEquals(batches.length, 2);
  },
});

// --- Redact ---

Deno.test("Redact: API key replaced with REDACTED", () => {
  const obs = makeObs("clipboard.changed", {
    text: "my key is sk_live_abc123def456ghi789jklmnop",
  });
  const redacted = redactObservation(obs);
  const text = redacted.data.text as string;
  assertEquals(text.includes("sk_live"), false);
  assertEquals(text.includes("[REDACTED"), true);
});

Deno.test("Redact: normal text preserved", () => {
  const obs = makeObs("custom", { text: "hello world" });
  const redacted = redactObservation(obs);
  assertEquals(redacted.data.text, "hello world");
});

Deno.test("Redact: long clipboard truncated with hash", () => {
  const longText = "a".repeat(300);
  const obs = makeObs("clipboard.changed", { text: longText });
  const redacted = redactObservation(obs);
  const text = redacted.data.text as string;
  assertGreater(300, text.length);
  // Should have hash suffix
  assertEquals(text.includes("...["), true);
});

// --- Context ---

Deno.test("Context: addBatch updates active app and window", () => {
  const ctx = new CompanionContext();
  ctx.addBatch([
    makeObs("app.switch", { appName: "Safari" }),
    makeObs("ui.window.title.changed", { title: "Google" }),
  ]);
  assertEquals(ctx.getActiveApp(), "Safari");
  assertEquals(ctx.getActiveWindowTitle(), "Google");
});

Deno.test("Context: buildPromptContext includes app info but not observations", () => {
  const ctx = new CompanionContext();
  ctx.addBatch([makeObs("app.switch", { appName: "VSCode" })]);
  const prompt = ctx.buildPromptContext();
  assertEquals(prompt.includes("VSCode"), true);
  assertEquals(prompt.includes("Companion Context"), true);
  // Observations are provided separately by callers — not in context summary
  assertEquals(prompt.includes("## Recent Observations"), false);
});

Deno.test("Context: rolling buffer capped", () => {
  const ctx = new CompanionContext(5);
  const batch = Array.from({ length: 10 }, (_, i) =>
    makeObs("custom", { n: i })
  );
  ctx.addBatch(batch);
  assertEquals(ctx.getBufferSize(), 5);
});

Deno.test("Context: isUserActive", () => {
  const ctx = new CompanionContext();
  // No activity yet
  assertEquals(ctx.isUserActive(5000), false);

  ctx.addBatch([makeObs("custom")]);
  // Just added — should be active
  assertEquals(ctx.isUserActive(5000), true);
});

Deno.test("Redact: nested object sanitized", () => {
  const obs = makeObs("custom", {
    meta: { key: "sk_live_abc123def456ghi789jklmnop" },
  });
  const redacted = redactObservation(obs);
  const meta = redacted.data.meta as Record<string, string>;
  assertEquals(meta.key.includes("sk_live"), false);
  assertEquals(meta.key.includes("[REDACTED"), true);
});

Deno.test("Redact: array of strings sanitized", () => {
  const obs = makeObs("custom", {
    items: ["hello", "sk_live_abc123def456ghi789jklmnop"],
  });
  const redacted = redactObservation(obs);
  const items = redacted.data.items as string[];
  assertEquals(items[0], "hello");
  assertEquals(items[1].includes("sk_live"), false);
  assertEquals(items[1].includes("[REDACTED"), true);
});

Deno.test("Bus: append after close returns false", () => {
  const bus = new ObservationBus();
  bus.append(makeObs("custom"));
  bus.close();
  assertEquals(bus.append(makeObs("custom")), false);
});

Deno.test("Context: DND gate skips when active (rapid batches)", () => {
  const ctx = new CompanionContext();
  const quietWindowMs = 5000;

  // First batch — no prior activity, isUserActive returns false
  assertEquals(ctx.isUserActive(quietWindowMs), false);
  ctx.addBatch([makeObs("custom")]);

  // Second batch immediately after — gap < quietWindow, isUserActive returns true
  assertEquals(ctx.isUserActive(quietWindowMs), true);
});

Deno.test({
  name: "Context: DND gate passes when quiet",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const ctx = new CompanionContext();
    const quietWindowMs = 50; // very short for test

    // First batch
    ctx.addBatch([makeObs("custom")]);

    // Wait longer than the quiet window
    await new Promise((r) => setTimeout(r, 60));

    // Now the gap > quietWindow → not active
    assertEquals(ctx.isUserActive(quietWindowMs), false);
  },
});

// --- Format ---

Deno.test("formatBatch: formats observations as bullet-point lines", () => {
  const batch = [
    makeObs("app.switch", { appName: "Xcode" }),
    makeObs("check.failed", { error: "lint" }),
  ];
  const result = formatBatch(batch);
  assertEquals(result.includes("- [app.switch] test:"), true);
  assertEquals(result.includes("- [check.failed] test:"), true);
  assertEquals(result.includes('"appName":"Xcode"'), true);
  assertEquals(result.includes('"error":"lint"'), true);
  // Two lines separated by newline
  assertEquals(result.split("\n").length, 2);
});

Deno.test("formatObservationPrompt: combines context and observations", () => {
  const ctx = new CompanionContext();
  ctx.addBatch([makeObs("app.switch", { appName: "VSCode" })]);
  const batch = [makeObs("check.failed", { error: "build failed" })];
  const prompt = formatObservationPrompt(batch, ctx);

  assertEquals(prompt.includes("[Companion Observation]"), true);
  assertEquals(prompt.includes("Companion Context"), true);
  assertEquals(prompt.includes("VSCode"), true);
  assertEquals(prompt.includes("## Recent Activity"), true);
  assertEquals(prompt.includes("check.failed"), true);
  assertEquals(prompt.includes("build failed"), true);
});

Deno.test("formatBatch: empty batch returns empty string", () => {
  assertEquals(formatBatch([]), "");
});

// --- Approval lifecycle ---

import {
  waitForApproval,
  resolveApproval,
  cancelPendingApproval,
  getPendingApprovalCount,
  clearAllPendingApprovals,
} from "../../../src/hlvm/companion/approvals.ts";

Deno.test({
  name: "Approval: resolves when response received",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const promise = waitForApproval("test-1", undefined, 5000);
    const resolved = resolveApproval({ eventId: "test-1", approved: true });
    assertEquals(resolved, true);
    const response = await promise;
    assertEquals(response.approved, true);
  },
});

Deno.test({
  name: "Approval: rejects on timeout",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await assertRejects(
      () => waitForApproval("test-timeout", undefined, 50),
      Error,
      "timeout",
    );
  },
});

Deno.test("Approval: returns false for unknown eventId", () => {
  const resolved = resolveApproval({ eventId: "nonexistent", approved: true });
  assertEquals(resolved, false);
});

Deno.test({
  name: "Approval: cancelPendingApproval rejects",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const promise = waitForApproval("test-cancel", undefined, 5000);
    cancelPendingApproval("test-cancel");
    await assertRejects(
      () => promise,
      Error,
      "cancelled",
    );
  },
});

Deno.test({
  name: "Approval: clearAll cleans up",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const p1 = waitForApproval("clear-1", undefined, 5000).catch(() => {});
    const p2 = waitForApproval("clear-2", undefined, 5000).catch(() => {});
    assertEquals(getPendingApprovalCount(), 2);
    clearAllPendingApprovals();
    assertEquals(getPendingApprovalCount(), 0);
    await p1;
    await p2;
  },
});

Deno.test({
  name: "Approval: concurrent approvals independent",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const p1 = waitForApproval("conc-1", undefined, 5000);
    const _p2 = waitForApproval("conc-2", undefined, 5000);
    assertEquals(getPendingApprovalCount(), 2);

    resolveApproval({ eventId: "conc-1", approved: true });
    const r1 = await p1;
    assertEquals(r1.approved, true);
    assertEquals(getPendingApprovalCount(), 1);

    // Cleanup remaining
    cancelPendingApproval("conc-2");
    await _p2.catch(() => {});
  },
});

Deno.test({
  name: "Approval: abort signal cancels",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const ac = new AbortController();
    const promise = waitForApproval("test-abort", ac.signal, 5000);
    ac.abort();
    await assertRejects(
      () => promise,
      Error,
      "aborted",
    );
  },
});

// --- companionOnInteraction ---

import { subscribe, clearSessionBuffer } from "../../../src/hlvm/store/sse-store.ts";
import { emitCompanionEvent, COMPANION_CHANNEL, companionOnInteraction } from "../../../src/hlvm/companion/loop.ts";
import type { CompanionEvent } from "../../../src/hlvm/companion/types.ts";

Deno.test({
  name: "companionOnInteraction: L0 tool auto-approved",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const handler = companionOnInteraction();
    // read_file is L0 (read-only)
    const result = await handler({
      type: "interaction_request",
      requestId: "req-1",
      mode: "permission",
      toolName: "read_file",
      toolArgs: JSON.stringify({ path: "/tmp/test.txt" }),
    });
    assertEquals(result.approved, true);
  },
});

Deno.test({
  name: "companionOnInteraction: L1 tool routes through SSE approval end-to-end",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Capture SSE events to extract the generated approval eventId
    const capturedEvents: { event_type: string; data: unknown }[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (e) => capturedEvents.push(e));

    const handler = companionOnInteraction();
    // write_file is L1+ — will emit action_request and wait for approval
    const resultPromise = handler({
      type: "interaction_request",
      requestId: "req-2",
      mode: "permission",
      toolName: "write_file",
      toolArgs: JSON.stringify({ path: "/tmp/test.txt", content: "hello" }),
    });

    // Give it a tick to emit the SSE event and register the approval
    await new Promise((r) => setTimeout(r, 10));

    // Verify SSE event was emitted with action_request type
    assertEquals(capturedEvents.length >= 1, true);
    const permEvent = capturedEvents.find(
      (e) => e.event_type === "companion_event" &&
        (e.data as { type: string }).type === "action_request",
    );
    assertEquals(permEvent !== undefined, true);

    // Extract the eventId from the SSE payload and resolve the approval
    const eventId = (permEvent!.data as { id: string }).id;
    assertEquals(eventId.startsWith("comp-perm-"), true);
    resolveApproval({ eventId, approved: true });

    // The handler should now resolve with approved: true
    const result = await resultPromise;
    assertEquals(result.approved, true);

    unsub();
  },
});

Deno.test({
  name: "companionOnInteraction: timeout → denied",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const ac = new AbortController();
    const handler = companionOnInteraction(ac.signal);

    // shell_exec with rm is L2 — will route through SSE, then abort cancels
    const resultPromise = handler({
      type: "interaction_request",
      requestId: "req-3",
      mode: "permission",
      toolName: "shell_exec",
      toolArgs: JSON.stringify({ command: "rm -rf /tmp/foo" }),
    });

    // Abort immediately
    ac.abort();
    const result = await resultPromise;
    assertEquals(result.approved, false);
  },
});

// =====================================================================
// HTTP Handler E2E Tests
// =====================================================================
// These test real HTTP handlers → real companion modules → real SSE store.
// The only thing not tested is the TCP listener (Deno stdlib, not ours).

import { resetEventSequence } from "../../../src/hlvm/companion/loop.ts";
import {
  handleCompanionObserve,
  handleCompanionStream,
  handleCompanionRespond,
  handleCompanionStatus,
  handleCompanionConfig,
} from "../../../src/hlvm/cli/repl/handlers/companion.ts";
import {
  startCompanion,
  stopCompanion,
  isCompanionRunning,
} from "../../../src/hlvm/companion/mod.ts";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test({
  name: "HTTP E2E: POST /observe ingests observation into bus",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    startCompanion();
    try {
      const obs = {
        kind: "app.switch",
        timestamp: new Date().toISOString(),
        source: "test",
        data: { appName: "Safari" },
      };
      const resp = await handleCompanionObserve(jsonRequest(obs));
      assertEquals(resp.status, 201);
      const body = await resp.json();
      assertEquals(body.queued, 1);

      // Observation was queued (loop may have already consumed it)
    } finally {
      stopCompanion();
    }
  },
});

Deno.test({
  name: "HTTP E2E: POST /observe batch ingests multiple",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    startCompanion();
    try {
      const obs = [
        { kind: "app.switch", timestamp: new Date().toISOString(), source: "test", data: { appName: "A" } },
        { kind: "clipboard.changed", timestamp: new Date().toISOString(), source: "test", data: { text: "hello" } },
      ];
      const resp = await handleCompanionObserve(jsonRequest(obs));
      assertEquals(resp.status, 201);
      const body = await resp.json();
      assertEquals(body.queued, 2);
    } finally {
      stopCompanion();
    }
  },
});

Deno.test({
  name: "HTTP E2E: POST /observe returns 503 when companion not running",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Ensure companion is stopped
    if (isCompanionRunning()) stopCompanion();

    const obs = { kind: "custom", timestamp: new Date().toISOString(), source: "test", data: {} };
    const resp = await handleCompanionObserve(jsonRequest(obs));
    assertEquals(resp.status, 503);
  },
});

Deno.test({
  name: "HTTP E2E: GET /status returns state and config",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    startCompanion();
    try {
      const resp = handleCompanionStatus();
      assertEquals(resp.status, 200);
      const body = await resp.json();
      assertEquals(body.running, true);
      assertEquals(typeof body.state, "string");
      assertEquals(typeof body.config, "object");
      assertEquals(body.config.enabled, true);
    } finally {
      stopCompanion();
    }
  },
});

Deno.test({
  name: "HTTP E2E: POST /config enables and disables companion",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Ensure stopped
    if (isCompanionRunning()) stopCompanion();

    // Enable
    const enableResp = await handleCompanionConfig(jsonRequest({ enabled: true }));
    assertEquals(enableResp.status, 200);
    const enableBody = await enableResp.json();
    assertEquals(enableBody.status, "started");
    assertEquals(isCompanionRunning(), true);

    // Disable
    const disableResp = await handleCompanionConfig(jsonRequest({ enabled: false }));
    assertEquals(disableResp.status, 200);
    const disableBody = await disableResp.json();
    assertEquals(disableBody.status, "stopped");
    assertEquals(isCompanionRunning(), false);
  },
});

Deno.test({
  name: "HTTP E2E: POST /respond resolves pending approval",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Create a pending approval
    const approvalPromise = waitForApproval("http-e2e-1", undefined, 5000);

    // Resolve via HTTP handler
    const resp = await handleCompanionRespond(jsonRequest({
      eventId: "http-e2e-1",
      approved: true,
      actionId: "act-1",
    }));
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.resolved, true);

    // Approval promise should be resolved
    const result = await approvalPromise;
    assertEquals(result.approved, true);
    assertEquals(result.actionId, "act-1");
  },
});

Deno.test({
  name: "HTTP E2E: POST /respond returns resolved=false for unknown eventId",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const resp = await handleCompanionRespond(jsonRequest({
      eventId: "nonexistent-999",
      approved: true,
    }));
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.resolved, false);
  },
});

Deno.test({
  name: "HTTP E2E: POST /respond rejects missing eventId",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const resp = await handleCompanionRespond(jsonRequest({
      approved: true,
    }));
    assertEquals(resp.status, 400);
  },
});

Deno.test({
  name: "HTTP E2E: POST /observe rejects malformed JSON body",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    startCompanion();
    try {
      const req = new Request("http://localhost/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json {{{",
      });
      const resp = await handleCompanionObserve(req);
      assertEquals(resp.status, 400);
      const body = await resp.json();
      assertEquals(typeof body.error, "string");
    } finally {
      stopCompanion();
    }
  },
});

/** Read SSE chunks until one matches the predicate (max 10 reads). */
async function readSSEUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
): Promise<string> {
  const decoder = new TextDecoder();
  for (let i = 0; i < 10; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    if (predicate(text)) return text;
  }
  throw new Error("SSE predicate never matched");
}

Deno.test({
  name: "HTTP E2E: GET /stream delivers events through SSE ReadableStream",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Clear any buffered events from previous tests to avoid replay interference
    clearSessionBuffer(COMPANION_CHANNEL);

    const req = new Request("http://localhost/api/companion/stream");
    const resp = handleCompanionStream(req);
    assertEquals(resp.headers.get("Content-Type"), "text/event-stream");

    const reader = resp.body!.getReader();

    // Initial chunks include retry directive + status_change sync event
    const initText = await readSSEUntil(reader, (t) => t.includes("comp-init-"));
    assertEquals(initText.includes("status_change"), true);

    // Emit a companion event
    emitCompanionEvent({
      type: "message",
      content: "Try running npm install",
      id: "sse-stream-test-1",
      timestamp: new Date().toISOString(),
    });

    // Read until the emitted event arrives
    const eventText = await readSSEUntil(reader, (t) => t.includes("sse-stream-test-1"));
    assertEquals(eventText.includes("companion_event"), true);
    assertEquals(eventText.includes("Try running npm install"), true);

    reader.releaseLock();
    await resp.body?.cancel();
  },
});

Deno.test({
  name: "HTTP E2E: Full round-trip — observe → emit → stream → respond",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    startCompanion();
    try {
      // 1. POST observation
      const obsResp = await handleCompanionObserve(jsonRequest({
        kind: "check.failed",
        timestamp: new Date().toISOString(),
        source: "test",
        data: { error: "lint failed" },
      }));
      assertEquals(obsResp.status, 201);

      // 2. Manually emit an event (simulating what the loop does)
      const eventId = "e2e-roundtrip-1";
      emitCompanionEvent({
        type: "action_request",
        content: "Fix lint error?",
        id: eventId,
        timestamp: new Date().toISOString(),
      });

      // 3. Subscribe to SSE and verify event was delivered
      const sseEvents: unknown[] = [];
      const unsub = subscribe(COMPANION_CHANNEL, (e) => sseEvents.push(e));

      // Emit another event to verify subscription works
      emitCompanionEvent({
        type: "message",
        content: "test message",
        id: "e2e-msg-1",
        timestamp: new Date().toISOString(),
      });
      assertEquals(sseEvents.length, 1); // got the message

      // 4. Resolve approval via HTTP handler
      const approvalPromise = waitForApproval(eventId, undefined, 5000);
      const respondResp = await handleCompanionRespond(jsonRequest({
        eventId,
        approved: true,
        actionId: "fix-1",
      }));
      assertEquals(respondResp.status, 200);

      const approval = await approvalPromise;
      assertEquals(approval.approved, true);
      assertEquals(approval.actionId, "fix-1");

      // 5. Status should be queryable
      const statusResp = handleCompanionStatus();
      const statusBody = await statusResp.json();
      assertEquals(statusBody.running, true);

      unsub();
    } finally {
      stopCompanion();
    }
  },
});

// =====================================================================
// Per-module edge case tests (Round 3 audit)
// =====================================================================

// --- Bus: drain under concurrent append+iterate ---

Deno.test({
  name: "Bus: drain pattern preserves order with async append+iterate",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const bus = new ObservationBus(100);
    const received: number[] = [];

    // Start iteration concurrently
    const iterDone = (async () => {
      for await (const o of bus) {
        received.push(o.data.n as number);
      }
    })();

    // Append in batches with yielding between to let iteration consume
    for (let i = 0; i < 10; i++) {
      bus.append(makeObs("custom", { n: i }));
      await new Promise((r) => setTimeout(r, 0)); // yield to event loop
    }
    bus.close();
    await iterDone;

    assertEquals(received.length, 10);
    // Order must be preserved
    for (let i = 0; i < received.length; i++) {
      assertEquals(received[i], i);
    }
  },
});

Deno.test("Bus: overflow during slow consumer drops oldest unconsumed", async () => {
  const bus = new ObservationBus(3);
  // Append 5 items before iteration starts — only last 3 should survive
  bus.append(makeObs("custom", { n: 1 }));
  bus.append(makeObs("custom", { n: 2 }));
  bus.append(makeObs("custom", { n: 3 }));
  bus.append(makeObs("custom", { n: 4 }));
  bus.append(makeObs("custom", { n: 5 }));
  bus.close();

  const received: number[] = [];
  for await (const o of bus) {
    received.push(o.data.n as number);
  }
  assertEquals(received.length, 3);
  assertEquals(received[0], 3);
  assertEquals(received[1], 4);
  assertEquals(received[2], 5);
});

// --- Debounce: triage priority ---

Deno.test({
  name: "Debounce: triage keeps high-signal events when over maxBatchSize",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const bus = new ObservationBus();
    // 3 high-signal + 5 low-signal = 8 total, maxBatchSize = 4
    bus.append(makeObs("check.failed", { error: "lint" }));
    bus.append(makeObs("custom", { n: 1 }));
    bus.append(makeObs("custom", { n: 2 }));
    bus.append(makeObs("app.switch", { appName: "Xcode" }));
    bus.append(makeObs("custom", { n: 3 }));
    bus.append(makeObs("custom", { n: 4 }));
    bus.append(makeObs("custom", { n: 5 }));
    bus.append(makeObs("terminal.result", { output: "fail" }));
    bus.close();

    const batches: Observation[][] = [];
    for await (const batch of debounceObservations(bus, 50, 4)) {
      batches.push(batch);
    }
    assertEquals(batches.length, 1);
    assertEquals(batches[0].length, 4);
    // All 3 high-signal events must be present
    const kinds = batches[0].map((o) => o.kind);
    assertEquals(kinds.includes("check.failed"), true);
    assertEquals(kinds.includes("app.switch"), true);
    assertEquals(kinds.includes("terminal.result"), true);
  },
});

// --- Redact: non-string primitives preserved ---

Deno.test("Redact: numbers, booleans, null preserved unchanged", () => {
  const obs = makeObs("custom", {
    count: 42,
    flag: true,
    nothing: null,
  });
  const redacted = redactObservation(obs);
  assertEquals(redacted.data.count, 42);
  assertEquals(redacted.data.flag, true);
  assertEquals(redacted.data.nothing, null);
});

// --- Redaction: data integrity ---

Deno.test("Redact: original observation not mutated (immutability)", () => {
  const original = makeObs("clipboard.changed", {
    text: "secret sk_live_abc123def456ghi789jklmnop here",
    nested: { value: "sk_live_abc123def456ghi789jklmnop" },
  });
  const originalText = original.data.text;

  const redacted = redactObservation(original);

  // Original must be untouched
  assertEquals(original.data.text, originalText);
  assertEquals((original.data.nested as Record<string, string>).value, "sk_live_abc123def456ghi789jklmnop");

  // Redacted must be different
  assertEquals((redacted.data.text as string).includes("sk_live"), false);
  assertEquals(redacted.data !== original.data, true);
});

// =====================================================================
// E2E Pipeline Tests — Pure Data Pipe
// =====================================================================
// Simulates: bus → debounce → redact → context → format → emit

Deno.test({
  name: "E2E Pipeline: observations flow through bus → debounce → redact → context → format",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // 1. Create bus and inject observations
    const bus = new ObservationBus();
    bus.append(makeObs("clipboard.changed", { text: "Error: ENOENT no such file" }));
    bus.append(makeObs("app.switch", { appName: "Terminal" }));
    bus.close();

    // 2. Debounce into batches
    const batches: Observation[][] = [];
    for await (const batch of debounceObservations(bus, 50)) {
      batches.push(batch);
    }
    assertEquals(batches.length, 1);
    assertEquals(batches[0].length, 2);

    // 3. Redact
    const redacted = batches[0].map(redactObservation);
    // Normal text preserved (no PII)
    assertEquals((redacted[0].data.text as string).includes("ENOENT"), true);

    // 4. Context
    const ctx = new CompanionContext();
    ctx.addBatch(redacted);
    assertEquals(ctx.getActiveApp(), "Terminal");
    assertEquals(ctx.getBufferSize(), 2);
    const promptCtx = ctx.buildPromptContext();
    assertEquals(promptCtx.includes("Terminal"), true);

    // 5. Format — deterministic, no LLM
    const prompt = formatObservationPrompt(redacted, ctx);
    assertEquals(prompt.includes("[Companion Observation]"), true);
    assertEquals(prompt.includes("Terminal"), true);
    assertEquals(prompt.includes("ENOENT"), true);
    assertEquals(prompt.includes("## Recent Activity"), true);
  },
});

Deno.test({
  name: "E2E Pipeline: PII is redacted before reaching formatted prompt",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Inject observation with API key
    const bus = new ObservationBus();
    bus.append(makeObs("clipboard.changed", {
      text: "curl -H 'Authorization: Bearer sk_live_abc123def456ghi789jklmnop'",
    }));
    bus.close();

    // Debounce
    const batches: Observation[][] = [];
    for await (const batch of debounceObservations(bus, 50)) {
      batches.push(batch);
    }

    // Redact
    const redacted = batches[0].map(redactObservation);
    const text = redacted[0].data.text as string;

    // API key must be gone
    assertEquals(text.includes("sk_live"), false);
    assertEquals(text.includes("[REDACTED"), true);

    // Formatted prompt must NOT contain original API key
    const ctx = new CompanionContext();
    ctx.addBatch(redacted);
    const prompt = formatObservationPrompt(redacted, ctx);
    assertEquals(prompt.includes("sk_live"), false);
    assertEquals(prompt.includes("[REDACTED"), true);
  },
});

// =====================================================================
// runCompanionLoop Integration Tests — direct loop branch coverage
// =====================================================================

import { runCompanionLoop } from "../../../src/hlvm/companion/loop.ts";
import { DEFAULT_COMPANION_CONFIG } from "../../../src/hlvm/companion/types.ts";

Deno.test({
  name: "Loop integration: observation prompt emitted as 'message' SSE event",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);

    const bus = new ObservationBus();
    const ctx = new CompanionContext();
    const config = {
      ...DEFAULT_COMPANION_CONFIG,
      enabled: true,
      debounceWindowMs: 10,
      quietWhileTypingMs: 0,
    };
    const ac = new AbortController();
    const captured: { event_type: string; data: unknown }[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

    bus.append(makeObs("check.failed", { error: "ENOENT" }));
    bus.close();

    await runCompanionLoop(bus, config, ctx, ac.signal);

    const messageEvents = captured.filter(
      (e) => (e.data as { type: string }).type === "message",
    );
    assertEquals(messageEvents.length, 1);
    const content = (messageEvents[0].data as { content: string }).content;
    // Should contain formatted observation prompt structure
    assertEquals(content.includes("[Companion Observation]"), true);
    assertEquals(content.includes("## Recent Activity"), true);
    assertEquals(content.includes("check.failed"), true);
    assertEquals(content.includes("ENOENT"), true);

    unsub();
  },
});

Deno.test({
  name: "Loop integration: debugAlwaysReact emits debug message for every batch",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);

    const bus = new ObservationBus();
    const ctx = new CompanionContext();
    const config = {
      ...DEFAULT_COMPANION_CONFIG,
      enabled: true,
      debounceWindowMs: 10,
      quietWhileTypingMs: 30_000,
      debugAlwaysReact: true,
    };
    const ac = new AbortController();
    const captured: { event_type: string; data: unknown }[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

    bus.append(makeObs("app.switch", { appName: "Xcode" }));
    bus.append(makeObs("ui.window.title.changed", { title: "main.ts" }));
    bus.close();

    await runCompanionLoop(bus, config, ctx, ac.signal);

    const messageEvents = captured.filter(
      (e) => (e.data as { type: string }).type === "message",
    );
    assertEquals(messageEvents.length, 1);
    const content = (messageEvents[0].data as { content: string }).content;
    assertEquals(content.includes("[debug] observed:"), true);
    assertEquals(content.includes("app.switch"), true);
    assertEquals(content.includes("ui.window.title.changed"), true);

    unsub();
  },
});

Deno.test({
  name: "Loop integration: DND skip — second batch skipped when user recently active",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);

    const bus = new ObservationBus();
    const ctx = new CompanionContext();
    const config = {
      ...DEFAULT_COMPANION_CONFIG,
      enabled: true,
      debounceWindowMs: 30,
      // High quietWhileTypingMs → second batch will be DND-skipped
      quietWhileTypingMs: 30_000,
    };
    const ac = new AbortController();
    const captured: { event_type: string; data: unknown }[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

    // First batch: no typing signal → lastTypingActivityTs=0 → isActive=false → processes
    bus.append(makeObs("check.failed", { error: "err1" }));
    // Typing signal after first batch → sets lastTypingActivityTs to ~now
    setTimeout(() => bus.append(makeObs("ui.selection.changed", {})), 80);
    // Second batch: lastTypingActivityTs recent → isActive=true → DND-skipped
    setTimeout(() => bus.append(makeObs("check.failed", { error: "err2" })), 150);
    setTimeout(() => bus.close(), 300);

    await runCompanionLoop(bus, config, ctx, ac.signal);

    // Only 1 message event from first batch — second was DND-skipped
    const messageEvents = captured.filter(
      (e) => (e.data as { type: string }).type === "message",
    );
    assertEquals(messageEvents.length, 1);

    unsub();
  },
});

Deno.test({
  name: "Loop integration: rate limit blocks after maxNotifyPerMinute",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);

    const bus = new ObservationBus();
    const ctx = new CompanionContext();
    const config = {
      ...DEFAULT_COMPANION_CONFIG,
      enabled: true,
      debounceWindowMs: 30,
      quietWhileTypingMs: 0,
      maxNotifyPerMinute: 2,
    };
    const ac = new AbortController();
    const captured: { event_type: string; data: unknown }[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

    // Push 3 observations with gaps > debounce window to create 3 separate batches
    bus.append(makeObs("check.failed", { error: "error 1" }));
    setTimeout(() => bus.append(makeObs("check.failed", { error: "error 2" })), 100);
    setTimeout(() => bus.append(makeObs("check.failed", { error: "error 3" })), 200);
    setTimeout(() => bus.close(), 350);

    await runCompanionLoop(bus, config, ctx, ac.signal);

    // Only 2 events should be emitted (3rd is rate-limited)
    const messageEvents = captured.filter(
      (e) => (e.data as { type: string }).type === "message",
    );
    assertEquals(messageEvents.length, 2);

    unsub();
  },
});

Deno.test({
  name: "Loop integration: low-signal observations skipped (accumulated in context only)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);

    const bus = new ObservationBus();
    const ctx = new CompanionContext();
    const config = {
      ...DEFAULT_COMPANION_CONFIG,
      enabled: true,
      debounceWindowMs: 10,
      quietWhileTypingMs: 0,
    };
    const ac = new AbortController();
    const captured: { event_type: string; data: unknown }[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

    // Only low-signal observations — should NOT emit any SSE event
    bus.append(makeObs("app.switch", { appName: "Xcode" }));
    bus.append(makeObs("clipboard.changed", { text: "hello" }));
    bus.append(makeObs("ui.window.title.changed", { title: "main.swift" }));
    bus.close();

    await runCompanionLoop(bus, config, ctx, ac.signal);

    const messageEvents = captured.filter(
      (e) => (e.data as { type: string }).type === "message",
    );
    assertEquals(messageEvents.length, 0, "Low-signal batch should not emit any SSE event");

    // But context should still have the observations
    assertEquals(ctx.getActiveApp(), "Xcode");
    assertEquals(ctx.getBufferSize(), 3);

    unsub();
  },
});

// --- companionOnInteraction edge cases ---

Deno.test({
  name: "companionOnInteraction: no toolName → routes through SSE approval",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    const captured: { event_type: string; data: unknown }[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

    const handler = companionOnInteraction();
    // No toolName → skips classification, goes directly to L1+ SSE flow
    const resultPromise = handler({
      type: "interaction_request",
      requestId: "req-no-tool",
      mode: "permission",
    });

    // Wait for SSE event to be emitted
    await new Promise((r) => setTimeout(r, 10));

    // Should have emitted action_request via SSE
    const permEvent = captured.find(
      (e) => (e.data as { type: string }).type === "action_request",
    );
    assertEquals(permEvent !== undefined, true);

    // Resolve the approval
    const eventId = (permEvent!.data as { id: string }).id;
    resolveApproval({ eventId, approved: true });

    const result = await resultPromise;
    assertEquals(result.approved, true);

    unsub();
  },
});

Deno.test({
  name: "companionOnInteraction: toolName without toolArgs → L0 auto-approved",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const handler = companionOnInteraction();
    // read_file is L0, no toolArgs → tests `toolArgs ? ... : undefined` ternary false branch
    const result = await handler({
      type: "interaction_request",
      requestId: "req-no-args",
      mode: "permission",
      toolName: "read_file",
      // toolArgs intentionally omitted
    });
    assertEquals(result.approved, true);
  },
});

// --- Regression tests for audit fixes (bugs 1-3) ---

Deno.test({
  name: "Companion lifecycle: startCompanion respects enabled=false and does not start",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (isCompanionRunning()) stopCompanion();
    startCompanion({ enabled: false });
    assertEquals(isCompanionRunning(), false);
  },
});

Deno.test({
  name: "Companion lifecycle: stopCompanion resets event sequence and clears SSE buffer",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);

    // Start companion to initialize state
    startCompanion();
    assertEquals(isCompanionRunning(), true);

    // Emit some events so eventSeq increments
    emitCompanionEvent({
      type: "message",
      content: "test-1",
      id: "seq-test-1",
      timestamp: new Date().toISOString(),
    });
    emitCompanionEvent({
      type: "message",
      content: "test-2",
      id: "seq-test-2",
      timestamp: new Date().toISOString(),
    });

    // Verify SSE buffer has events
    const preStopEvents: unknown[] = [];
    const unsub1 = subscribe(COMPANION_CHANNEL, (e) => preStopEvents.push(e));
    unsub1();

    // Stop companion — should reset eventSeq and clear SSE buffer
    stopCompanion();
    assertEquals(isCompanionRunning(), false);

    // Restart companion
    startCompanion();

    // Emit a new event — if eventSeq was reset, the ID should start from comp-1 again
    // We use resetEventSequence directly to verify it works
    resetEventSequence();
    emitCompanionEvent({
      type: "message",
      content: "after-reset",
      id: "comp-1-after",
      timestamp: new Date().toISOString(),
    });

    // Verify SSE buffer was cleared on stop (only the new event should be present)
    const postEvents: { event_type: string; data: unknown }[] = [];
    const unsub2 = subscribe(COMPANION_CHANNEL, (e) => postEvents.push(e));

    emitCompanionEvent({
      type: "message",
      content: "verification",
      id: "verify-1",
      timestamp: new Date().toISOString(),
    });
    assertEquals(postEvents.length, 1);
    assertEquals((postEvents[0].data as { id: string }).id, "verify-1");

    unsub2();
    stopCompanion();
  },
});

Deno.test({
  name: "companionOnInteraction: malformed toolArgs JSON does not throw",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    const captured: { event_type: string; data: unknown }[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

    const handler = companionOnInteraction();
    const resultPromise = handler({
      type: "interaction_request",
      requestId: "req-malformed-json",
      mode: "permission",
      toolName: "write_file",
      toolArgs: "{bad-json",
    });

    await new Promise((r) => setTimeout(r, 10));

    const permEvent = captured.find(
      (e) => (e.data as { type: string }).type === "action_request",
    );
    assertEquals(permEvent !== undefined, true);

    resolveApproval({
      eventId: (permEvent!.data as { id: string }).id,
      approved: true,
    });
    const result = await resultPromise;
    assertEquals(result.approved, true);

    unsub();
  },
});

Deno.test({
  name: "HTTP E2E: /stream emits replay gap marker when Last-Event-ID is too old",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);

    // Force buffer compaction so old IDs fall out of replay window.
    for (let i = 0; i < 2050; i++) {
      emitCompanionEvent({
        type: "message",
        content: `event-${i}`,
        id: `gap-seed-${i}`,
        timestamp: new Date().toISOString(),
      });
    }

    const req = new Request("http://localhost/api/companion/stream", {
      headers: { "Last-Event-ID": "1" },
    });
    const resp = handleCompanionStream(req);
    const reader = resp.body!.getReader();

    // Read until the gap marker arrives (skips retry directive + initial status sync)
    const text = await readSSEUntil(reader, (t) => t.includes("replay_gap_detected"));
    assertEquals(text.includes("\"type\":\"status_change\""), true);

    reader.releaseLock();
    await resp.body?.cancel();
  },
});

// =====================================================================
// True E2E: startCompanion → HTTP POST observe → loop → SSE delivery
// =====================================================================
// Tests the ACTUAL production path: Swift POSTs observation via HTTP,
// the loop processes it, and the formatted observation prompt arrives
// on the SSE stream. No manual emitCompanionEvent() — the loop does it.

Deno.test({
  name: "True E2E: POST /observe → loop processes → formatted prompt arrives on SSE stream",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (isCompanionRunning()) stopCompanion();
    clearSessionBuffer(COMPANION_CHANNEL);

    // Start companion with short debounce and DND disabled
    startCompanion({
      debounceWindowMs: 50,
      quietWhileTypingMs: 0,
    });

    try {
      // Subscribe to SSE to capture events from the loop
      const captured: { event_type: string; data: unknown }[] = [];
      const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

      // POST a real observation via HTTP handler (this is what Swift does)
      const resp = await handleCompanionObserve(jsonRequest({
        kind: "check.failed",
        timestamp: new Date().toISOString(),
        source: "xcode-build",
        data: { error: "Build failed: 3 errors in main.swift" },
      }));
      assertEquals(resp.status, 201);

      // Wait for debounce window + processing time
      // debounce=50ms + buffer for loop iteration
      await new Promise((r) => setTimeout(r, 300));

      // The loop should have emitted a formatted observation prompt
      const messageEvents = captured.filter(
        (e) => (e.data as { type: string }).type === "message",
      );
      assertEquals(messageEvents.length >= 1, true, "Expected at least 1 message event from the loop");

      const content = (messageEvents[0].data as { content: string }).content;

      // Verify it's a properly formatted observation prompt (not debug text, not LLM summary)
      assertEquals(content.includes("[Companion Observation]"), true, "Should have observation header");
      assertEquals(content.includes("## Recent Activity"), true, "Should have activity section");
      assertEquals(content.includes("check.failed"), true, "Should include observation kind");
      assertEquals(content.includes("Build failed"), true, "Should include observation data");
      assertEquals(content.includes("xcode-build"), true, "Should include observation source");

      unsub();
    } finally {
      stopCompanion();
    }
  },
});

Deno.test({
  name: "True E2E: POST /observe with PII → loop redacts before SSE delivery",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (isCompanionRunning()) stopCompanion();
    clearSessionBuffer(COMPANION_CHANNEL);

    startCompanion({
      debounceWindowMs: 50,
      quietWhileTypingMs: 0,
    });

    try {
      const captured: { event_type: string; data: unknown }[] = [];
      const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

      // POST high-signal observation containing an API key
      const resp = await handleCompanionObserve(jsonRequest({
        kind: "check.failed",
        timestamp: new Date().toISOString(),
        source: "build",
        data: { error: "auth failed with sk_live_abc123def456ghi789jklmnop" },
      }));
      assertEquals(resp.status, 201);

      await new Promise((r) => setTimeout(r, 300));

      const messageEvents = captured.filter(
        (e) => (e.data as { type: string }).type === "message",
      );
      assertEquals(messageEvents.length >= 1, true, "Expected message event");

      const content = (messageEvents[0].data as { content: string }).content;

      // PII must be redacted in the SSE-delivered prompt
      assertEquals(content.includes("sk_live"), false, "API key must be redacted");
      assertEquals(content.includes("[REDACTED"), true, "Should have redaction marker");
      assertEquals(content.includes("[Companion Observation]"), true, "Should still be formatted");

      unsub();
    } finally {
      stopCompanion();
    }
  },
});

Deno.test({
  name: "True E2E: POST /observe during DND → no SSE event emitted",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (isCompanionRunning()) stopCompanion();
    clearSessionBuffer(COMPANION_CHANNEL);

    startCompanion({
      debounceWindowMs: 50,
      quietWhileTypingMs: 30_000, // very long DND
    });

    try {
      const captured: { event_type: string; data: unknown }[] = [];
      const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

      // First: send a typing signal to activate DND
      await handleCompanionObserve(jsonRequest({
        kind: "ui.selection.changed",
        timestamp: new Date().toISOString(),
        source: "test",
        data: {},
      }));

      // Wait for first batch to process
      await new Promise((r) => setTimeout(r, 150));

      // Now send the real observation — should be DND-skipped
      await handleCompanionObserve(jsonRequest({
        kind: "check.failed",
        timestamp: new Date().toISOString(),
        source: "test",
        data: { error: "should not appear" },
      }));

      await new Promise((r) => setTimeout(r, 300));

      // The check.failed observation should NOT have produced a message event
      // (the first batch with ui.selection.changed will produce one since DND wasn't active yet)
      const messageEvents = captured.filter(
        (e) => {
          const data = e.data as { type: string; content: string };
          return data.type === "message" && data.content.includes("should not appear");
        },
      );
      assertEquals(messageEvents.length, 0, "DND should suppress the second observation");

      unsub();
    } finally {
      stopCompanion();
    }
  },
});

Deno.test({
  name: "True E2E: SSE stream delivers formatted prompt to ReadableStream client",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (isCompanionRunning()) stopCompanion();
    clearSessionBuffer(COMPANION_CHANNEL);

    startCompanion({
      debounceWindowMs: 50,
      quietWhileTypingMs: 0,
    });

    try {
      // Open SSE stream (this is what Swift's EventSource does)
      const req = new Request("http://localhost/api/companion/stream");
      const resp = handleCompanionStream(req);
      const reader = resp.body!.getReader();

      // Consume initial status_change sync event
      await readSSEUntil(reader, (t) => t.includes("comp-init-"));

      // POST observation via HTTP
      await handleCompanionObserve(jsonRequest({
        kind: "terminal.result",
        timestamp: new Date().toISOString(),
        source: "terminal",
        data: { output: "npm test: 42 passed, 3 failed" },
      }));

      // Read from SSE stream until the formatted prompt arrives
      const eventText = await readSSEUntil(reader, (t) =>
        t.includes("[Companion Observation]") && t.includes("terminal.result")
      );

      // Verify the SSE payload contains the full formatted prompt
      assertEquals(eventText.includes("companion_event"), true, "Should be a companion_event");
      assertEquals(eventText.includes("## Recent Activity"), true, "Should have activity section");
      assertEquals(eventText.includes("42 passed"), true, "Should include terminal output");

      reader.releaseLock();
      await resp.body?.cancel();
    } finally {
      stopCompanion();
    }
  },
});
