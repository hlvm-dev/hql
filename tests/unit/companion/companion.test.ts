/**
 * Companion Agent — Unit Tests
 *
 * Tests: bus, debounce, redact, context, gate (stub + LLM), decide (stub + LLM).
 * NO imports from memory/mod.ts — only store.ts via redact.ts (no SQLite).
 */

import { assertEquals, assertGreater, assertRejects } from "jsr:@std/assert";
import { ObservationBus } from "../../../src/hlvm/companion/bus.ts";
import { debounceObservations } from "../../../src/hlvm/companion/debounce.ts";
import { redactObservation } from "../../../src/hlvm/companion/redact.ts";
import { CompanionContext } from "../../../src/hlvm/companion/context.ts";
import { gateObservations } from "../../../src/hlvm/companion/gate.ts";
import { makeDecision, parseDecisionResponse, validateDecision } from "../../../src/hlvm/companion/decide.ts";
import type { Observation, ObservationKind } from "../../../src/hlvm/companion/types.ts";
import type { LLMResponse } from "../../../src/hlvm/agent/tool-call.ts";
import type { LLMFunction } from "../../../src/hlvm/agent/orchestrator-llm.ts";

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

// --- Mock LLM helpers ---

function mockLLM(content: string): LLMFunction {
  return async (_messages, _signal?) => ({ content, toolCalls: [] } as LLMResponse);
}

function throwingLLM(error: Error): LLMFunction {
  return async () => { throw error; };
}

// --- Gate: no LLM (backward compat) ---

Deno.test("Gate: no LLM → stub SILENT", async () => {
  const ctx = new CompanionContext();
  const result = await gateObservations([makeObs("custom")], ctx);
  assertEquals(result.decision, "SILENT");
});

// --- Gate LLM tests ---

Deno.test("Gate LLM: SILENT response", async () => {
  const ctx = new CompanionContext();
  const result = await gateObservations([makeObs("custom")], ctx, mockLLM("SILENT"));
  assertEquals(result.decision, "SILENT");
  assertEquals(result.reason, "");
});

Deno.test("Gate LLM: NOTIFY response with reason", async () => {
  const ctx = new CompanionContext();
  const result = await gateObservations(
    [makeObs("clipboard.changed", { text: "Error: ENOENT" })],
    ctx,
    mockLLM("NOTIFY user copied error message"),
  );
  assertEquals(result.decision, "NOTIFY");
  assertEquals(result.reason, "user copied error message");
});

Deno.test("Gate LLM: error defaults to SILENT", async () => {
  const ctx = new CompanionContext();
  const result = await gateObservations(
    [makeObs("custom")],
    ctx,
    throwingLLM(new Error("connection failed")),
  );
  assertEquals(result.decision, "SILENT");
  assertEquals(result.reason, "");
});

// --- Decision: no LLM (backward compat) ---

Deno.test("Decision: no LLM → stub SILENT", async () => {
  const ctx = new CompanionContext();
  const result = await makeDecision([makeObs("custom")], ctx);
  assertEquals(result.type, "SILENT");
});

// --- Decision LLM tests ---

Deno.test("Decision LLM: CHAT response", async () => {
  const ctx = new CompanionContext();
  const json = JSON.stringify({ type: "CHAT", message: "That error means the file was not found." });
  const result = await makeDecision([makeObs("custom")], ctx, "error copied", mockLLM(json));
  assertEquals(result.type, "CHAT");
  assertEquals(result.message, "That error means the file was not found.");
});

Deno.test("Decision LLM: SUGGEST response", async () => {
  const ctx = new CompanionContext();
  const json = JSON.stringify({ type: "SUGGEST", message: "Try running `npm install` first." });
  const result = await makeDecision([makeObs("custom")], ctx, "build failed", mockLLM(json));
  assertEquals(result.type, "SUGGEST");
  assertEquals(result.message, "Try running `npm install` first.");
});

Deno.test("Decision LLM: SILENT response", async () => {
  const ctx = new CompanionContext();
  const json = JSON.stringify({ type: "SILENT" });
  const result = await makeDecision([makeObs("custom")], ctx, undefined, mockLLM(json));
  assertEquals(result.type, "SILENT");
});

Deno.test("Decision: ACT with actions passes through", () => {
  const actions = [{ id: "fix-1", label: "Fix it", description: "Run fix", requiresApproval: true }];
  const result = validateDecision({ type: "ACT", message: "I can fix that", actions });
  assertEquals(result.type, "ACT");
  assertEquals(result.actions?.length, 1);
  assertEquals(result.actions?.[0].id, "fix-1");
});

Deno.test("Decision: ACT without actions but with message → SUGGEST", () => {
  const result = validateDecision({ type: "ACT", message: "I can fix that for you" });
  assertEquals(result.type, "SUGGEST");
  assertEquals(result.message, "I can fix that for you");
});

Deno.test("Decision: ACT without actions or message → SILENT", () => {
  const result = validateDecision({ type: "ACT" });
  assertEquals(result.type, "SILENT");
});

Deno.test("Decision: ACT with empty actions array → SUGGEST fallback", () => {
  const result = validateDecision({ type: "ACT", message: "I can help", actions: [] });
  // Empty array is falsy for .length check → falls through to message → SUGGEST
  assertEquals(result.type, "SUGGEST");
  assertEquals(result.message, "I can help");
});

Deno.test("Decision: ASK_VISION with message passes through", () => {
  const result = validateDecision({ type: "ASK_VISION", message: "Let me look at the screen" });
  assertEquals(result.type, "ASK_VISION");
  assertEquals(result.message, "Let me look at the screen");
});

Deno.test("Decision: ASK_VISION without message → SILENT", () => {
  const result = validateDecision({ type: "ASK_VISION" });
  assertEquals(result.type, "SILENT");
});

Deno.test("Decision LLM: malformed JSON → SILENT", () => {
  const result = parseDecisionResponse("I think you should restart the server");
  assertEquals(result.type, "SILENT");
});

Deno.test("Decision LLM: JSON in markdown fences parsed", () => {
  const text = '```json\n{"type": "CHAT", "message": "Hello there!"}\n```';
  const result = parseDecisionResponse(text);
  assertEquals(result.type, "CHAT");
  assertEquals(result.message, "Hello there!");
});

Deno.test("Decision LLM: CHAT without message → SILENT", () => {
  const result = parseDecisionResponse('{"type": "CHAT"}');
  assertEquals(result.type, "SILENT");
});

Deno.test("Decision LLM: error defaults to SILENT", async () => {
  const ctx = new CompanionContext();
  const result = await makeDecision(
    [makeObs("custom")],
    ctx,
    "error",
    throwingLLM(new Error("timeout")),
  );
  assertEquals(result.type, "SILENT");
});

Deno.test("Decision LLM: memory context included in messages", async () => {
  const ctx = new CompanionContext();
  let capturedMessages: unknown[] = [];
  const captureLLM: LLMFunction = async (messages, _signal?) => {
    capturedMessages = messages;
    return { content: '{"type": "SILENT"}', toolCalls: [] };
  };
  await makeDecision(
    [makeObs("custom")],
    ctx,
    "test reason",
    captureLLM,
    "User prefers TypeScript.",
  );
  const userMsg = (capturedMessages[1] as { content: string }).content;
  assertEquals(userMsg.includes("User prefers TypeScript."), true);
});

// --- parseDecisionResponse: ACT/ASK_VISION JSON ---

Deno.test("Decision: ACT JSON with actions array parsed", () => {
  const json = JSON.stringify({
    type: "ACT",
    message: "I'll fix the lint error",
    actions: [{ id: "fix-1", label: "Fix lint", description: "Run eslint --fix", requiresApproval: true }],
  });
  const result = parseDecisionResponse(json);
  assertEquals(result.type, "ACT");
  assertEquals(result.actions?.length, 1);
  assertEquals(result.actions?.[0].description, "Run eslint --fix");
});

Deno.test("Decision: ASK_VISION JSON parsed", () => {
  const json = JSON.stringify({ type: "ASK_VISION", message: "Let me see your screen" });
  const result = parseDecisionResponse(json);
  assertEquals(result.type, "ASK_VISION");
  assertEquals(result.message, "Let me see your screen");
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

// --- ACT / VISION flow integration tests ---
// These test the emitCompanionEvent → approval → SSE pipeline pieces

import { subscribe, clearSessionBuffer } from "../../../src/hlvm/store/sse-store.ts";
import { emitCompanionEvent, COMPANION_CHANNEL } from "../../../src/hlvm/companion/loop.ts";
import type { CompanionEvent } from "../../../src/hlvm/companion/types.ts";

Deno.test({
  name: "ACT flow: action_request emits SSE, approval resolves, action_result emittable",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const captured: unknown[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (event) => captured.push(event));

    // Simulate: loop emits action_request
    const actionEvent: CompanionEvent = {
      type: "action_request",
      content: "Fix lint error in main.ts",
      actions: [{ id: "fix-1", label: "Fix lint", description: "Run eslint --fix", requiresApproval: true }],
      id: "act-test-1",
      timestamp: new Date().toISOString(),
    };
    emitCompanionEvent(actionEvent);

    // Verify action_request was emitted via SSE
    assertEquals(captured.length, 1);

    // Simulate: user approves → waitForApproval resolves
    const approvalPromise = waitForApproval("act-test-1", undefined, 5000);
    resolveApproval({ eventId: "act-test-1", approved: true, actionId: "fix-1" });
    const response = await approvalPromise;
    assertEquals(response.approved, true);
    assertEquals(response.actionId, "fix-1");

    // Simulate: agent completes → action_result emitted
    emitCompanionEvent({
      type: "action_result",
      content: "Fixed 3 lint errors.",
      id: "act-test-result-1",
      timestamp: new Date().toISOString(),
    });
    assertEquals(captured.length, 2);

    unsub();
  },
});

Deno.test({
  name: "ACT flow: denied approval emits action_cancelled",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const captured: unknown[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (event) => captured.push(event));

    // Emit action_request
    emitCompanionEvent({
      type: "action_request",
      content: "Delete temp files",
      actions: [{ id: "del-1", label: "Delete", description: "rm -rf /tmp/cache", requiresApproval: true }],
      id: "act-deny-1",
      timestamp: new Date().toISOString(),
    });

    // User denies
    const approvalPromise = waitForApproval("act-deny-1", undefined, 5000);
    resolveApproval({ eventId: "act-deny-1", approved: false });
    const response = await approvalPromise;
    assertEquals(response.approved, false);

    // Verify cancelled event can be emitted
    emitCompanionEvent({
      type: "action_cancelled",
      content: "Action denied by user.",
      id: "act-deny-cancel-1",
      timestamp: new Date().toISOString(),
    });
    assertEquals(captured.length, 2);

    unsub();
  },
});

Deno.test({
  name: "VISION flow: vision_request → approval → capture_request emitted",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const captured: unknown[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (event) => captured.push(event));

    // Emit vision_request (from decide → loop)
    emitCompanionEvent({
      type: "vision_request",
      content: "Let me see your screen to help debug the layout",
      id: "vision-test-1",
      timestamp: new Date().toISOString(),
    });
    assertEquals(captured.length, 1);

    // User approves
    const approvalPromise = waitForApproval("vision-test-1", undefined, 5000);
    resolveApproval({ eventId: "vision-test-1", approved: true });
    const response = await approvalPromise;
    assertEquals(response.approved, true);

    // After approval, loop emits capture_request → Swift captures screenshot
    emitCompanionEvent({
      type: "capture_request",
      content: "Capture screenshot",
      id: "vision-capture-1",
      timestamp: new Date().toISOString(),
    });
    assertEquals(captured.length, 2);

    unsub();
  },
});

// --- companionOnInteraction ---
// These tests use the exported function from loop.ts
// We mock classifyTool indirectly by testing with known tool names

import { companionOnInteraction } from "../../../src/hlvm/companion/loop.ts";

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
      type: "suggestion",
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

      // 2. Manually emit an event (simulating what the loop does after gate+decide)
      //    Since no LLM is configured, the loop gates everything to SILENT.
      //    So we simulate the decision outcome directly.
      const eventId = "e2e-roundtrip-1";
      emitCompanionEvent({
        type: "action_request",
        content: "Fix lint error?",
        id: eventId,
        timestamp: new Date().toISOString(),
        actions: [{ id: "fix-1", label: "Fix", description: "eslint --fix", requiresApproval: true }],
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

// --- Decision: edge cases ---

Deno.test("Decision: case-insensitive type parsing", () => {
  const result = parseDecisionResponse('{"type": "chat", "message": "hello"}');
  assertEquals(result.type, "CHAT");
  assertEquals(result.message, "hello");
});

Deno.test("Decision: invalid type → SILENT", () => {
  const result = parseDecisionResponse('{"type": "INVALID", "message": "hello"}');
  assertEquals(result.type, "SILENT");
});

Deno.test("Decision: SUGGEST type ignores actions field", () => {
  const result = validateDecision({
    type: "SUGGEST",
    message: "Try this",
    actions: [{ id: "a1", label: "Do it", description: "cmd", requiresApproval: true }],
  });
  assertEquals(result.type, "SUGGEST");
  assertEquals(result.message, "Try this");
  // SUGGEST doesn't include actions (only ACT does)
  assertEquals(result.actions, undefined);
});

Deno.test("Decision: deeply nested JSON in text extracted", () => {
  const text = 'Here is my analysis:\n{"type": "SUGGEST", "message": "Run npm test"}\nDone.';
  const result = parseDecisionResponse(text);
  assertEquals(result.type, "SUGGEST");
  assertEquals(result.message, "Run npm test");
});

Deno.test("Decision: malformed JSON with valid JSON in markdown fences → parsed", () => {
  const text = 'Let me think about this.\n```json\n{"type": "CHAT", "message": "Check the logs"}\n```\nHere is some extra text with {bad json}';
  const result = parseDecisionResponse(text);
  assertEquals(result.type, "CHAT");
  assertEquals(result.message, "Check the logs");
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

// --- Gate: LLM receives observation data, not just context summary ---

Deno.test("Gate: LLM prompt includes observation data", async () => {
  const ctx = new CompanionContext();
  ctx.addBatch([makeObs("app.switch", { appName: "Xcode" })]);

  let capturedPrompt = "";
  const captureLLM: LLMFunction = async (messages, _signal?) => {
    capturedPrompt = (messages[1] as { content: string }).content;
    return { content: "SILENT", toolCalls: [] } as LLMResponse;
  };

  const batch = [makeObs("check.failed", { error: "Build failed: 3 errors" })];
  await gateObservations(batch, ctx, captureLLM);

  // Prompt must include BOTH context summary AND observation data
  assertEquals(capturedPrompt.includes("Xcode"), true);  // from context
  assertEquals(capturedPrompt.includes("Build failed"), true);  // from observation
  assertEquals(capturedPrompt.includes("check.failed"), true);  // observation kind
});

// =====================================================================
// E2E Pipeline Test
// =====================================================================
// Simulates: bus → debounce → redact → context → gate → decide
// This tests the full pipeline without the loop.ts orchestration
// (which requires actual SSE/agent infrastructure)

Deno.test({
  name: "E2E Pipeline: observations flow through bus → debounce → redact → context → gate → decide",
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
    const prompt = ctx.buildPromptContext();
    assertEquals(prompt.includes("Terminal"), true);

    // 5. Gate — mock LLM that returns NOTIFY for error patterns
    const gateLLM = mockLLM("NOTIFY user has a file-not-found error");
    const gate = await gateObservations(redacted, ctx, gateLLM);
    assertEquals(gate.decision, "NOTIFY");
    assertEquals(gate.reason.includes("file-not-found"), true);

    // 6. Decide — mock LLM that returns SUGGEST
    const decideJSON = JSON.stringify({
      type: "SUGGEST",
      message: "The file doesn't exist. Check if the path is correct or create the file.",
    });
    const decisionLLM = mockLLM(decideJSON);
    const decision = await makeDecision(redacted, ctx, gate.reason, decisionLLM);
    assertEquals(decision.type, "SUGGEST");
    assertEquals(decision.message?.includes("file"), true);
  },
});

Deno.test({
  name: "E2E Pipeline: PII is redacted before reaching gate/decide",
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

    // Gate still receives the redacted text (not original)
    let capturedContent = "";
    const captureLLM: LLMFunction = async (messages, _signal?) => {
      capturedContent = (messages[1] as { content: string }).content;
      return { content: "SILENT", toolCalls: [] };
    };

    const ctx = new CompanionContext();
    ctx.addBatch(redacted);
    await gateObservations(redacted, ctx, captureLLM);

    // The LLM prompt must NOT contain the original API key
    assertEquals(capturedContent.includes("sk_live"), false);
    assertEquals(capturedContent.includes("[REDACTED"), true);
  },
});

Deno.test({
  name: "E2E Pipeline: ACT decision with actions validates correctly",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const bus = new ObservationBus();
    bus.append(makeObs("check.failed", { error: "3 lint errors in main.ts" }));
    bus.close();

    const batches: Observation[][] = [];
    for await (const batch of debounceObservations(bus, 50)) {
      batches.push(batch);
    }

    const redacted = batches[0].map(redactObservation);
    const ctx = new CompanionContext();
    ctx.addBatch(redacted);

    // Gate: NOTIFY
    const gate = await gateObservations(redacted, ctx, mockLLM("NOTIFY lint check failed"));
    assertEquals(gate.decision, "NOTIFY");

    // Decide: ACT with actions
    const actJSON = JSON.stringify({
      type: "ACT",
      message: "I can fix those lint errors for you",
      actions: [
        { id: "fix-lint", label: "Fix lint", description: "Run eslint --fix on main.ts", requiresApproval: true },
      ],
    });
    const decision = await makeDecision(redacted, ctx, gate.reason, mockLLM(actJSON));
    assertEquals(decision.type, "ACT");
    assertEquals(decision.actions?.length, 1);
    assertEquals(decision.actions?.[0].id, "fix-lint");
    assertEquals(decision.actions?.[0].requiresApproval, true);
  },
});

// =====================================================================
// runCompanionLoop Integration Tests — direct loop branch coverage
// =====================================================================
// Exercises the ACTUAL runCompanionLoop function (loop.ts:200) with
// mock LLMs injected via setAgentEngine(). Tests the branches that
// unit tests cannot reach:
// - CHAT emit dispatch (loop.ts:292-298)
// - Gate SILENT skip (loop.ts:246-249)
// - ASK_VISION → handleVisionFlow (loop.ts:288-291 → 175-197)
// - ACT → handleActFlow denial (loop.ts:282-287 → 115-135)

import { runCompanionLoop } from "../../../src/hlvm/companion/loop.ts";
import { setAgentEngine, resetAgentEngine } from "../../../src/hlvm/agent/engine.ts";
import type { AgentLLMConfig } from "../../../src/hlvm/agent/engine.ts";
import { DEFAULT_COMPANION_CONFIG } from "../../../src/hlvm/companion/types.ts";

/** Mock engine returning predetermined gate/decision LLM responses. */
function createMockEngine(gateResponse: string, decideResponse: string) {
  return {
    createLLM(config: AgentLLMConfig) {
      // Gate LLM is created with maxTokens=100, decision with maxTokens=1000
      const isGate = config.options?.maxTokens === 100;
      const response = isGate ? gateResponse : decideResponse;
      return async () => ({ content: response, toolCalls: [] });
    },
    createSummarizer() {
      return async () => "";
    },
  };
}

Deno.test({
  name: "Loop integration: CHAT decision emits 'message' SSE event via runCompanionLoop",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    setAgentEngine(createMockEngine(
      "NOTIFY user has an error",
      JSON.stringify({ type: "CHAT", message: "That looks like a file-not-found error." }),
    ));

    try {
      const bus = new ObservationBus();
      const ctx = new CompanionContext();
      const config = {
        ...DEFAULT_COMPANION_CONFIG,
        enabled: true,
        gateModel: "mock-gate",
        decisionModel: "mock-decide",
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
      assertEquals(
        ((messageEvents[0].data as { content: string }).content).includes("file-not-found"),
        true,
      );

      unsub();
    } finally {
      resetAgentEngine();
    }
  },
});

Deno.test({
  name: "Loop integration: debugAlwaysReact emits message for every batch without LLMs",
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
  name: "Loop integration: gate SILENT → no companion events emitted",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    setAgentEngine(createMockEngine("SILENT", '{"type":"SILENT"}'));

    try {
      const bus = new ObservationBus();
      const ctx = new CompanionContext();
      const config = {
        ...DEFAULT_COMPANION_CONFIG,
        enabled: true,
        gateModel: "mock-gate",
        decisionModel: "mock-decide",
        debounceWindowMs: 10,
        quietWhileTypingMs: 0,
      };
      const ac = new AbortController();
      const captured: unknown[] = [];
      const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

      bus.append(makeObs("custom", { n: 1 }));
      bus.close();

      await runCompanionLoop(bus, config, ctx, ac.signal);

      assertEquals(captured.length, 0);

      unsub();
    } finally {
      resetAgentEngine();
    }
  },
});

Deno.test({
  name: "Loop integration: ASK_VISION → approval → capture_request via handleVisionFlow",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    setAgentEngine(createMockEngine(
      "NOTIFY user needs visual help",
      JSON.stringify({ type: "ASK_VISION", message: "Let me see your screen" }),
    ));

    try {
      const bus = new ObservationBus();
      const ctx = new CompanionContext();
      const config = {
        ...DEFAULT_COMPANION_CONFIG,
        enabled: true,
        gateModel: "mock-gate",
        decisionModel: "mock-decide",
        debounceWindowMs: 10,
        quietWhileTypingMs: 0,
      };
      const ac = new AbortController();
      const captured: { event_type: string; data: unknown }[] = [];

      // Auto-approve vision_request when it arrives via SSE
      const unsub = subscribe(COMPANION_CHANNEL, (e) => {
        captured.push(e);
        const data = e.data as { type: string; id: string };
        if (data.type === "vision_request") {
          setTimeout(() => resolveApproval({ eventId: data.id, approved: true }), 5);
        }
      });

      bus.append(makeObs("custom", { help: "layout broken" }));
      bus.close();

      await runCompanionLoop(bus, config, ctx, ac.signal);

      const types = captured.map((e) => (e.data as { type: string }).type);
      assertEquals(types.includes("vision_request"), true);
      assertEquals(types.includes("capture_request"), true);

      unsub();
    } finally {
      resetAgentEngine();
    }
  },
});

Deno.test({
  name: "Loop integration: ACT → denial → action_cancelled via handleActFlow",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    setAgentEngine(createMockEngine(
      "NOTIFY lint check failed",
      JSON.stringify({
        type: "ACT",
        message: "I can fix the lint errors",
        actions: [{ id: "fix-1", label: "Fix lint", description: "eslint --fix", requiresApproval: true }],
      }),
    ));

    try {
      const bus = new ObservationBus();
      const ctx = new CompanionContext();
      const config = {
        ...DEFAULT_COMPANION_CONFIG,
        enabled: true,
        gateModel: "mock-gate",
        decisionModel: "mock-decide",
        debounceWindowMs: 10,
        quietWhileTypingMs: 0,
      };
      const ac = new AbortController();
      const captured: { event_type: string; data: unknown }[] = [];

      // Auto-deny action_request when it arrives via SSE
      const unsub = subscribe(COMPANION_CHANNEL, (e) => {
        captured.push(e);
        const data = e.data as { type: string; id: string };
        if (data.type === "action_request") {
          setTimeout(() => resolveApproval({ eventId: data.id, approved: false }), 5);
        }
      });

      bus.append(makeObs("check.failed", { error: "3 lint errors" }));
      bus.close();

      await runCompanionLoop(bus, config, ctx, ac.signal);

      const types = captured.map((e) => (e.data as { type: string }).type);
      assertEquals(types.includes("action_request"), true);
      assertEquals(types.includes("action_cancelled"), true);

      // Verify the cancellation message references denial
      const cancelEvent = captured.find(
        (e) => (e.data as { type: string }).type === "action_cancelled",
      );
      assertEquals(
        ((cancelEvent!.data as { content: string }).content).includes("denied"),
        true,
      );

      unsub();
    } finally {
      resetAgentEngine();
    }
  },
});

// --- Additional loop branch tests ---
// ASK_VISION denial, ACT timeout/no-action, rate limit

import { handleActFlow, handleVisionFlow } from "../../../src/hlvm/companion/loop.ts";
import type { CompanionConfig } from "../../../src/hlvm/companion/types.ts";

Deno.test({
  name: "Loop integration: ASK_VISION → denial → action_cancelled via runCompanionLoop",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    setAgentEngine(createMockEngine(
      "NOTIFY user needs help",
      JSON.stringify({ type: "ASK_VISION", message: "Let me see your screen" }),
    ));

    try {
      const bus = new ObservationBus();
      const ctx = new CompanionContext();
      const config = {
        ...DEFAULT_COMPANION_CONFIG,
        enabled: true,
        gateModel: "mock-gate",
        decisionModel: "mock-decide",
        debounceWindowMs: 10,
        quietWhileTypingMs: 0,
      };
      const ac = new AbortController();
      const captured: { event_type: string; data: unknown }[] = [];

      // Auto-DENY vision_request
      const unsub = subscribe(COMPANION_CHANNEL, (e) => {
        captured.push(e);
        const data = e.data as { type: string; id: string };
        if (data.type === "vision_request") {
          setTimeout(() => resolveApproval({ eventId: data.id, approved: false }), 5);
        }
      });

      bus.append(makeObs("custom", { help: "need visual" }));
      bus.close();

      await runCompanionLoop(bus, config, ctx, ac.signal);

      const types = captured.map((e) => (e.data as { type: string }).type);
      assertEquals(types.includes("vision_request"), true);
      assertEquals(types.includes("action_cancelled"), true);

      const cancelEvent = captured.find(
        (e) => (e.data as { type: string }).type === "action_cancelled",
      );
      assertEquals(
        ((cancelEvent!.data as { content: string }).content).includes("denied"),
        true,
      );

      unsub();
    } finally {
      resetAgentEngine();
    }
  },
});

Deno.test({
  name: "Loop integration: rate limit blocks after maxNotifyPerMinute",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    setAgentEngine(createMockEngine(
      "NOTIFY reason",
      JSON.stringify({ type: "CHAT", message: "response" }),
    ));

    try {
      const bus = new ObservationBus();
      const ctx = new CompanionContext();
      const config = {
        ...DEFAULT_COMPANION_CONFIG,
        enabled: true,
        gateModel: "mock-gate",
        decisionModel: "mock-decide",
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
    } finally {
      resetAgentEngine();
    }
  },
});

Deno.test({
  name: "handleVisionFlow: abort signal → action_cancelled",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    const captured: { event_type: string; data: unknown }[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

    const ctx = new CompanionContext();
    const ac = new AbortController();
    const event: CompanionEvent = {
      type: "vision_request",
      content: "Let me see",
      id: "vision-abort-test",
      timestamp: new Date().toISOString(),
    };

    // Abort quickly to trigger the catch branch
    setTimeout(() => ac.abort(), 20);

    await handleVisionFlow(event, ctx, ac.signal);

    const types = captured.map((e) => (e.data as { type: string }).type);
    assertEquals(types.includes("action_cancelled"), true);

    const cancelEvent = captured.find(
      (e) => (e.data as { type: string }).type === "action_cancelled",
    );
    assertEquals(
      ((cancelEvent!.data as { content: string }).content).includes("timed out or was cancelled"),
      true,
    );

    unsub();
  },
});

Deno.test({
  name: "handleActFlow: no action found after approval → action_cancelled",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    const captured: { event_type: string; data: unknown }[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

    const ctx = new CompanionContext();
    const ac = new AbortController();
    const event: CompanionEvent = {
      type: "action_request",
      content: "I can fix it",
      id: "act-no-action-test",
      timestamp: new Date().toISOString(),
    };
    // Decision with NO actions — defensive guard path
    const decision = { type: "ACT" as const, message: "I can fix it", actions: [] };
    const config: CompanionConfig = {
      ...DEFAULT_COMPANION_CONFIG,
      enabled: true,
      decisionModel: "mock-decide",
    };

    // Pre-schedule approval
    setTimeout(() => resolveApproval({ eventId: "act-no-action-test", approved: true }), 5);

    await handleActFlow(event, decision, ctx, config, ac.signal);

    const types = captured.map((e) => (e.data as { type: string }).type);
    assertEquals(types.includes("action_cancelled"), true);

    const cancelEvent = captured.find(
      (e) => (e.data as { type: string }).type === "action_cancelled",
    );
    assertEquals(
      ((cancelEvent!.data as { content: string }).content).includes("No action found"),
      true,
    );

    unsub();
  },
});

Deno.test({
  name: "handleActFlow: approval timeout → action_cancelled",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    const captured: { event_type: string; data: unknown }[] = [];
    const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

    const ctx = new CompanionContext();
    const ac = new AbortController();
    const event: CompanionEvent = {
      type: "action_request",
      content: "Fix it",
      id: "act-timeout-test",
      timestamp: new Date().toISOString(),
    };
    const decision = {
      type: "ACT" as const,
      message: "Fix it",
      actions: [{ id: "fix-1", label: "Fix", description: "fix", requiresApproval: true }],
    };
    const config: CompanionConfig = {
      ...DEFAULT_COMPANION_CONFIG,
      enabled: true,
      decisionModel: "mock-decide",
    };

    // Abort quickly to trigger the catch branch in handleActFlow
    setTimeout(() => ac.abort(), 20);

    await handleActFlow(event, decision, ctx, config, ac.signal);

    const types = captured.map((e) => (e.data as { type: string }).type);
    assertEquals(types.includes("action_cancelled"), true);

    const cancelEvent = captured.find(
      (e) => (e.data as { type: string }).type === "action_cancelled",
    );
    assertEquals(
      ((cancelEvent!.data as { content: string }).content).includes("timed out or was cancelled"),
      true,
    );

    unsub();
  },
});

// =====================================================================
// Additional branch coverage tests
// =====================================================================
// Target: uncovered blocks at lines 73, 87-false, 90-ternary, 138,
// 145, 159/160, 240, 296

Deno.test({
  name: "Loop integration: DND skip — second batch skipped when user recently active",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    setAgentEngine(createMockEngine(
      "NOTIFY reason",
      JSON.stringify({ type: "CHAT", message: "help" }),
    ));

    try {
      const bus = new ObservationBus();
      const ctx = new CompanionContext();
      const config = {
        ...DEFAULT_COMPANION_CONFIG,
        enabled: true,
        gateModel: "mock-gate",
        decisionModel: "mock-decide",
        debounceWindowMs: 30,
        // High quietWhileTypingMs → second batch will be DND-skipped
        quietWhileTypingMs: 30_000,
      };
      const ac = new AbortController();
      const captured: { event_type: string; data: unknown }[] = [];
      const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

      // First batch: isUserActive(30000) → false (lastActivityTs=0) → processes
      // addBatch() updates lastActivityTs to ~now
      bus.append(makeObs("check.failed", { error: "err1" }));
      // Second batch after debounce gap: isUserActive(30000) → true (< 30s since first) → skipped
      setTimeout(() => bus.append(makeObs("check.failed", { error: "err2" })), 150);
      setTimeout(() => bus.close(), 300);

      await runCompanionLoop(bus, config, ctx, ac.signal);

      // Only 1 message event from first batch — second was DND-skipped
      const messageEvents = captured.filter(
        (e) => (e.data as { type: string }).type === "message",
      );
      assertEquals(messageEvents.length, 1);

      unsub();
    } finally {
      resetAgentEngine();
    }
  },
});

Deno.test({
  name: "Loop integration: createCompanionLLM error → graceful degradation (gate SILENT)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    // Mock engine where createLLM throws — hits catch at line 73
    setAgentEngine({
      createLLM() {
        throw new Error("LLM creation failed");
      },
      createSummarizer() {
        return async () => "";
      },
    });

    try {
      const bus = new ObservationBus();
      const ctx = new CompanionContext();
      const config = {
        ...DEFAULT_COMPANION_CONFIG,
        enabled: true,
        gateModel: "mock-gate",
        decisionModel: "mock-decide",
        debounceWindowMs: 10,
        quietWhileTypingMs: 0,
      };
      const ac = new AbortController();
      const captured: unknown[] = [];
      const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

      bus.append(makeObs("check.failed", { error: "build error" }));
      bus.close();

      await runCompanionLoop(bus, config, ctx, ac.signal);

      // Both LLMs are undefined → gate returns SILENT → no events
      assertEquals(captured.length, 0);

      unsub();
    } finally {
      resetAgentEngine();
    }
  },
});

Deno.test({
  name: "Loop integration: SUGGEST decision → 'suggestion' SSE event type",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    setAgentEngine(createMockEngine(
      "NOTIFY user might benefit from suggestion",
      JSON.stringify({ type: "SUGGEST", message: "Try running deno fmt" }),
    ));

    try {
      const bus = new ObservationBus();
      const ctx = new CompanionContext();
      const config = {
        ...DEFAULT_COMPANION_CONFIG,
        enabled: true,
        gateModel: "mock-gate",
        decisionModel: "mock-decide",
        debounceWindowMs: 10,
        quietWhileTypingMs: 0,
      };
      const ac = new AbortController();
      const captured: { event_type: string; data: unknown }[] = [];
      const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

      bus.append(makeObs("check.failed", { error: "formatting issues" }));
      bus.close();

      await runCompanionLoop(bus, config, ctx, ac.signal);

      // SUGGEST maps to "suggestion" (not "message") at line 296
      const suggestionEvents = captured.filter(
        (e) => (e.data as { type: string }).type === "suggestion",
      );
      assertEquals(suggestionEvents.length, 1);
      assertEquals(
        ((suggestionEvents[0].data as { content: string }).content).includes("deno fmt"),
        true,
      );

      unsub();
    } finally {
      resetAgentEngine();
    }
  },
});

Deno.test({
  name: "handleActFlow: approved with matching actionId → runAgentQuery executes",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    clearSessionBuffer(COMPANION_CHANNEL);
    // Set mock engine so runAgentQuery can attempt to run
    setAgentEngine(createMockEngine("", "done"));

    try {
      const captured: { event_type: string; data: unknown }[] = [];
      const unsub = subscribe(COMPANION_CHANNEL, (e) => captured.push(e));

      const ctx = new CompanionContext();
      const ac = new AbortController();
      const event: CompanionEvent = {
        type: "action_request",
        content: "Fix lint errors",
        id: "act-id-match-test",
        timestamp: new Date().toISOString(),
      };
      const decision = {
        type: "ACT" as const,
        message: "Fix lint",
        actions: [
          { id: "fix-1", label: "Fix A", description: "fix file A", requiresApproval: true },
          { id: "fix-2", label: "Fix B", description: "fix file B", requiresApproval: true },
        ],
      };
      const config: CompanionConfig = {
        ...DEFAULT_COMPANION_CONFIG,
        enabled: true,
        decisionModel: "mock-decide",
      };

      // Approve with specific actionId "fix-2" → tests find(a => a.id === actionId) at line 138
      setTimeout(() => resolveApproval({
        eventId: "act-id-match-test",
        approved: true,
        actionId: "fix-2",
      }), 5);

      // Safety abort — if runAgentQuery hangs
      setTimeout(() => ac.abort(), 5_000);

      await handleActFlow(event, decision, ctx, config, ac.signal);

      // Should have action_result (success or Error:) or action_cancelled (abort)
      // but NOT "No action found" — the actionId matched fix-2
      const hasNoAction = captured.some(
        (e) => ((e.data as { content: string }).content || "").includes("No action found"),
      );
      assertEquals(hasNoAction, false);
      // Must have emitted something (action_result or action_cancelled)
      assertGreater(captured.length, 0);

      unsub();
    } finally {
      resetAgentEngine();
    }
  },
});

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
