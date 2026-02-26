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

import { subscribe } from "../../../src/hlvm/store/sse-store.ts";
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

Deno.test("ACT decision dispatch: validateDecision routes ACT with actions correctly", () => {
  const actions = [
    { id: "a1", label: "Run build", description: "deno task build", requiresApproval: true },
    { id: "a2", label: "Run tests", description: "deno task test", requiresApproval: true },
  ];
  const decision = validateDecision({ type: "ACT", message: "I'll build and test", actions });
  assertEquals(decision.type, "ACT");
  assertEquals(decision.actions?.length, 2);
  assertEquals(decision.message, "I'll build and test");
});

Deno.test("ASK_VISION decision dispatch: validateDecision routes ASK_VISION", () => {
  const decision = validateDecision({ type: "ASK_VISION", message: "Need to see the UI state" });
  assertEquals(decision.type, "ASK_VISION");
  assertEquals(decision.message, "Need to see the UI state");
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
  name: "companionOnInteraction: L1 tool routes through SSE approval",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const handler = companionOnInteraction();
    // write_file is L1+ — will emit action_request and wait for approval
    // Since no approval comes, it will timeout. Use a short timeout indirectly
    // by resolving the approval from outside.
    const resultPromise = handler({
      type: "interaction_request",
      requestId: "req-2",
      mode: "permission",
      toolName: "write_file",
      toolArgs: JSON.stringify({ path: "/tmp/test.txt", content: "hello" }),
    });

    // Give it a moment to emit and register the approval
    await new Promise((r) => setTimeout(r, 50));

    // The approval was registered with a comp-perm-* eventId
    // We need to find and resolve it — since we can't predict the exact ID,
    // we test the timeout path instead (approval count > 0 means it was registered)
    assertEquals(getPendingApprovalCount() > 0, true);

    // Clear to avoid timeout leak
    clearAllPendingApprovals();
    const result = await resultPromise;
    assertEquals(result.approved, false); // denied because cleared
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
