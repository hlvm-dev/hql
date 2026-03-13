import {
  assert,
  assertEquals,
  assertGreater,
  assertRejects,
} from "jsr:@std/assert";
import { ObservationBus } from "../../../src/hlvm/companion/bus.ts";
import { debounceObservations } from "../../../src/hlvm/companion/debounce.ts";
import { redactObservation } from "../../../src/hlvm/companion/redact.ts";
import { CompanionContext } from "../../../src/hlvm/companion/context.ts";
import { formatBatch, formatObservationPrompt } from "../../../src/hlvm/companion/format.ts";
import {
  clearAllPendingApprovals,
  getPendingApprovalCount,
  resolveApproval,
  waitForApproval,
} from "../../../src/hlvm/companion/approvals.ts";
import {
  COMPANION_CHANNEL,
  companionOnInteraction,
  runCompanionLoop,
} from "../../../src/hlvm/companion/loop.ts";
import {
  getCompanionConfig,
  isCompanionRunning,
  startCompanion,
  stopCompanion,
} from "../../../src/hlvm/companion/mod.ts";
import type { Observation, ObservationKind } from "../../../src/hlvm/companion/types.ts";
import { DEFAULT_COMPANION_CONFIG } from "../../../src/hlvm/companion/types.ts";
import { subscribe, clearSessionBuffer } from "../../../src/hlvm/store/sse-store.ts";
import {
  handleCompanionConfig,
  handleCompanionObserve,
  handleCompanionRespond,
  handleCompanionStatus,
  handleCompanionStream,
} from "../../../src/hlvm/cli/repl/handlers/companion.ts";

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

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readSSEUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
): Promise<string> {
  const decoder = new TextDecoder();
  for (let i = 0; i < 12; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    if (predicate(text)) return text;
  }
  throw new Error("SSE predicate never matched");
}

function cleanupCompanion(): void {
  clearAllPendingApprovals();
  clearSessionBuffer(COMPANION_CHANNEL);
  if (isCompanionRunning()) {
    stopCompanion();
  }
}

Deno.test("Companion bus: async drain preserves order and bounded overflow keeps newest", async () => {
  const bus = new ObservationBus(3);
  bus.append(makeObs("custom", { n: 1 }));
  bus.append(makeObs("custom", { n: 2 }));
  bus.append(makeObs("custom", { n: 3 }));
  bus.append(makeObs("custom", { n: 4 }));
  bus.close();

  const received: number[] = [];
  for await (const obs of bus) {
    received.push(obs.data.n as number);
  }

  assertEquals(received, [2, 3, 4]);
  assertEquals(bus.append(makeObs("custom")), false);
});

Deno.test({
  name: "Companion debounce: coalesces bursts and preserves priority signals under trimming",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const bus = new ObservationBus();
    bus.append(makeObs("check.failed", { error: "lint" }));
    bus.append(makeObs("custom", { n: 1 }));
    bus.append(makeObs("custom", { n: 2 }));
    bus.append(makeObs("app.switch", { appName: "Xcode" }));
    bus.append(makeObs("custom", { n: 3 }));
    bus.append(makeObs("custom", { n: 4 }));
    bus.append(makeObs("terminal.result", { output: "failed" }));
    bus.close();

    const batches: Observation[][] = [];
    for await (const batch of debounceObservations(bus, 25, 4)) {
      batches.push(batch);
    }

    assertEquals(batches.length, 1);
    assertEquals(batches[0].length, 4);
    const kinds = batches[0].map((obs) => obs.kind);
    assert(kinds.includes("check.failed"));
    assert(kinds.includes("app.switch"));
    assert(kinds.includes("terminal.result"));
  },
});

Deno.test("Companion redact: sanitizes nested strings, truncates clipboard, and preserves immutability", () => {
  const original = makeObs("clipboard.changed", {
    text: `token sk_live_abc123def456ghi789jklmnop ${"a".repeat(260)}`,
    nested: { key: "sk_live_abc123def456ghi789jklmnop" },
    items: ["ok", "sk_live_abc123def456ghi789jklmnop"],
    flag: true,
  });

  const redacted = redactObservation(original);
  const text = redacted.data.text as string;

  assertEquals((original.data.nested as { key: string }).key, "sk_live_abc123def456ghi789jklmnop");
  assertEquals(text.includes("sk_live"), false);
  assertEquals(text.includes("[REDACTED"), true);
  assertEquals(text.includes("...["), true);
  assertEquals(((redacted.data.nested as { key: string }).key).includes("sk_live"), false);
  assertEquals((redacted.data.items as string[])[0], "ok");
  assertEquals((redacted.data.flag as boolean), true);
  assertGreater(300, text.length);
});

Deno.test({
  name: "Companion context and format: summarize active state without duplicating history in context",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const context = new CompanionContext(2);
    context.addBatch([
      makeObs("app.switch", { appName: "VSCode" }),
      makeObs("ui.window.title.changed", { title: "main.ts" }),
      makeObs("clipboard.changed", { text: "const x = 1" }),
    ]);

    assertEquals(context.getActiveApp(), "VSCode");
    assertEquals(context.getActiveWindowTitle(), "main.ts");
    assertEquals(context.getBufferSize(), 2);
    assertEquals(context.isUserActive(5_000), true);

    await sleep(60);
    assertEquals(context.isUserActive(10), false);

    const summary = context.buildPromptContext();
    assert(summary.includes("VSCode"));
    assert(summary.includes("main.ts"));
    assert(summary.includes("const x = 1"));
    assertEquals(summary.includes("## Recent Activity"), false);

    const formatted = formatObservationPrompt([makeObs("check.failed", { error: "build failed" })], context);
    assert(formatted.includes("[Companion Observation]"));
    assert(formatted.includes("## Recent Activity"));
    assert(formatted.includes("build failed"));
    assertEquals(formatBatch([]), "");
  },
});

Deno.test({
  name: "Companion approvals: resolve and clear are the only lifecycle transitions",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const resolvedPromise = waitForApproval("approval-resolve", undefined, 5_000);
    assertEquals(getPendingApprovalCount(), 1);
    assertEquals(resolveApproval({ eventId: "approval-resolve", approved: true }), true);
    assertEquals((await resolvedPromise).approved, true);

    const pending = waitForApproval("approval-clear", undefined, 5_000).catch((error) => error);
    assertEquals(getPendingApprovalCount(), 1);
    clearAllPendingApprovals();
    const cleared = await pending;
    assertEquals(getPendingApprovalCount(), 0);
    assert(cleared instanceof Error);
    assert(String(cleared.message).includes("Approval cleared"));
  },
});

Deno.test({
  name: "Companion approvals: timeout rejects and removes the pending entry",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await assertRejects(
      () => waitForApproval("approval-timeout", undefined, 20),
      Error,
      "Approval timeout",
    );
    assertEquals(getPendingApprovalCount(), 0);
  },
});

Deno.test({
  name: "companionOnInteraction: L0 tools auto-approve while L1 tools route through SSE approval",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    cleanupCompanion();
    const captured: { event_type: string; data: unknown }[] = [];
    const unsubscribe = subscribe(COMPANION_CHANNEL, (event) => captured.push(event));

    const handler = companionOnInteraction();
    assertEquals((await handler({
      type: "interaction_request",
      requestId: "req-l0",
      mode: "permission",
      toolName: "read_file",
      toolArgs: JSON.stringify({ path: "/tmp/file.txt" }),
    })).approved, true);

    const pendingResponse = handler({
      type: "interaction_request",
      requestId: "req-l1",
      mode: "permission",
      toolName: "write_file",
      toolArgs: JSON.stringify({ path: "/tmp/file.txt", content: "hello" }),
    });

    await sleep(20);
    const approvalEvent = captured.find((event) =>
      event.event_type === "companion_event" &&
      (event.data as { type?: string }).type === "action_request"
    );
    assert(approvalEvent);
    resolveApproval({ eventId: (approvalEvent.data as { id: string }).id, approved: true });
    assertEquals((await pendingResponse).approved, true);

    unsubscribe();
    cleanupCompanion();
  },
});

Deno.test({
  name: "Companion handlers: observe rejects when stopped, config toggles running state, and respond resolves approvals",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    cleanupCompanion();

    const rejected = await handleCompanionObserve(jsonRequest(makeObs("custom")));
    assertEquals(rejected.status, 503);

    const started = await handleCompanionConfig(jsonRequest({ enabled: true, debounceWindowMs: 25 }));
    assertEquals(started.status, 200);
    assertEquals(isCompanionRunning(), true);
    assertEquals(getCompanionConfig().debounceWindowMs, 25);

    const status = await handleCompanionStatus().json();
    assertEquals(status.running, true);
    assertEquals(typeof status.state, "string");

    const approvalPromise = waitForApproval("http-approval", undefined, 5_000);
    const responded = await handleCompanionRespond(jsonRequest({ eventId: "http-approval", approved: true }));
    assertEquals(responded.status, 200);
    assertEquals((await approvalPromise).approved, true);

    const stopped = await handleCompanionConfig(jsonRequest({ enabled: false }));
    assertEquals(stopped.status, 200);
    assertEquals(isCompanionRunning(), false);
  },
});

Deno.test({
  name: "Companion loop: high-signal batches emit formatted prompts, low-signal batches only update context",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    cleanupCompanion();
    const bus = new ObservationBus();
    const context = new CompanionContext();
    const captured: { event_type: string; data: unknown }[] = [];
    const unsubscribe = subscribe(COMPANION_CHANNEL, (event) => captured.push(event));

    bus.append(makeObs("app.switch", { appName: "Xcode" }));
    bus.append(makeObs("clipboard.changed", { text: "hello" }));
    bus.append(makeObs("check.failed", { error: "ENOENT" }));
    bus.close();

    await runCompanionLoop(bus, {
      ...DEFAULT_COMPANION_CONFIG,
      enabled: true,
      debounceWindowMs: 10,
      quietWhileTypingMs: 0,
      maxNotifyPerMinute: 3,
      maxBufferSize: 100,
    }, context, new AbortController().signal);

    const messages = captured.filter((event) => (event.data as { type?: string }).type === "message");
    assertEquals(messages.length, 1);
    const content = (messages[0].data as { content: string }).content;
    assert(content.includes("[Companion Observation]"));
    assert(content.includes("check.failed"));
    assertEquals(context.getActiveApp(), "Xcode");

    unsubscribe();
    cleanupCompanion();
  },
});

Deno.test({
  name: "Companion loop: DND and rate limiting suppress extra notifications",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    cleanupCompanion();
    const dndBus = new ObservationBus();
    const dndContext = new CompanionContext();
    const dndEvents: { event_type: string; data: unknown }[] = [];
    const unsubscribeDnd = subscribe(COMPANION_CHANNEL, (event) => dndEvents.push(event));

    dndBus.append(makeObs("ui.selection.changed"));
    setTimeout(() => dndBus.append(makeObs("check.failed", { error: "suppressed" })), 40);
    setTimeout(() => dndBus.close(), 90);

    await runCompanionLoop(dndBus, {
      ...DEFAULT_COMPANION_CONFIG,
      enabled: true,
      debounceWindowMs: 15,
      quietWhileTypingMs: 30_000,
      maxNotifyPerMinute: 3,
      maxBufferSize: 100,
    }, dndContext, new AbortController().signal);

    const dndMessages = dndEvents.filter((event) => (event.data as { type?: string }).type === "message");
    assertEquals(dndMessages.length, 0);
    unsubscribeDnd();
    cleanupCompanion();

    const rateBus = new ObservationBus();
    const rateContext = new CompanionContext();
    const rateEvents: { event_type: string; data: unknown }[] = [];
    const unsubscribeRate = subscribe(COMPANION_CHANNEL, (event) => rateEvents.push(event));

    rateBus.append(makeObs("check.failed", { error: "one" }));
    setTimeout(() => rateBus.append(makeObs("check.failed", { error: "two" })), 40);
    setTimeout(() => rateBus.append(makeObs("check.failed", { error: "three" })), 80);
    setTimeout(() => rateBus.close(), 140);

    await runCompanionLoop(rateBus, {
      ...DEFAULT_COMPANION_CONFIG,
      enabled: true,
      debounceWindowMs: 15,
      quietWhileTypingMs: 0,
      maxNotifyPerMinute: 2,
      maxBufferSize: 100,
    }, rateContext, new AbortController().signal);

    const rateMessages = rateEvents.filter((event) => (event.data as { type?: string }).type === "message");
    assertEquals(rateMessages.length, 2);

    unsubscribeRate();
    cleanupCompanion();
  },
});

Deno.test({
  name: "Companion HTTP SSE: observe-to-stream delivers a redacted formatted prompt end-to-end",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    cleanupCompanion();
    startCompanion({
      enabled: true,
      debounceWindowMs: 25,
      quietWhileTypingMs: 0,
      maxNotifyPerMinute: 3,
    });

    try {
      const response = handleCompanionStream(new Request("http://localhost/api/companion/stream"));
      assertEquals(response.headers.get("Content-Type"), "text/event-stream");
      const reader = response.body!.getReader();

      await readSSEUntil(reader, (text) => text.includes("comp-init-"));

      const observe = await handleCompanionObserve(jsonRequest({
        kind: "check.failed",
        timestamp: new Date().toISOString(),
        source: "xcode-build",
        data: { error: "auth failed with sk_live_abc123def456ghi789jklmnop" },
      }));
      assertEquals(observe.status, 201);

      const chunk = await readSSEUntil(reader, (text) =>
        text.includes("[Companion Observation]") && text.includes("check.failed")
      );
      assert(chunk.includes("companion_event"));
      assert(chunk.includes("xcode-build"));
      assertEquals(chunk.includes("sk_live"), false);
      assert(chunk.includes("[REDACTED"));

      reader.releaseLock();
      await response.body?.cancel();
    } finally {
      cleanupCompanion();
    }
  },
});
