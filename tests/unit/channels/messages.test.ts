import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { DEFAULT_CONFIG } from "../../../src/common/config/types.ts";
import { createChannelRuntime } from "../../../src/hlvm/channels/core/runtime.ts";
import { createMessagesTransport } from "../../../src/hlvm/channels/messages/plugin.ts";
import * as bridge from "../../../src/hlvm/channels/messages/bridge.ts";
import type { ChannelReply } from "../../../src/hlvm/channels/core/types.ts";

function buildRuntime(options: {
  allowedIds?: string[];
  enabled?: boolean;
  runQuery?: (opts: { query: string; sessionId: string }) => Promise<{ text: string }>;
}) {
  const calls: Array<{ query: string; sessionId: string }> = [];
  return {
    calls,
    runtime: createChannelRuntime({
      messages: createMessagesTransport,
    }, {
      loadConfig: async () => ({
        ...DEFAULT_CONFIG,
        channels: {
          messages: {
            enabled: options.enabled ?? true,
            allowedIds: options.allowedIds ?? ["approved"],
            transport: { mode: "local" },
          },
        },
      }),
      runQuery: options.runQuery ??
        (async (opts) => {
          calls.push({ query: opts.query, sessionId: opts.sessionId });
          return { text: `Echo: ${opts.query}` };
        }),
    }),
  };
}

async function waitForOutbox(
  replies: ChannelReply[],
  count: number,
  timeoutMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (replies.length < count && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2));
  }
  if (replies.length < count) {
    throw new Error(
      `waitForOutbox timeout: expected ${count} replies, got ${replies.length}`,
    );
  }
}

async function waitForState(
  runtime: { getStatus(ch: string): { state: string; lastError: string | null } | null },
  channel: string,
  state: string,
  timeoutMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (runtime.getStatus(channel)?.state === state) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  const actual = runtime.getStatus(channel);
  throw new Error(
    `waitForState timeout: ${channel} never reached ${state}, actual=${actual?.state} lastError=${actual?.lastError}`,
  );
}

Deno.test("messages: inbound round-trip delivers one reply to outbox subscriber", async () => {
  bridge.resetForTesting();

  const { runtime, calls } = buildRuntime({ allowedIds: ["approved"] });
  const replies: ChannelReply[] = [];
  const unsub = bridge.subscribeOutbox((reply) => replies.push(reply));

  await runtime.reconfigure();
  await bridge.pushInbound({
    channel: "messages",
    remoteId: "approved",
    text: "hello",
  });

  await waitForOutbox(replies, 1);
  assertEquals(calls.length, 1);
  assertEquals(replies.length, 1);
  assertEquals(replies[0].text, "Echo: hello");
  assertEquals(replies[0].remoteId, "approved");
  assertEquals(replies[0].sessionId, "channel:messages:approved");

  unsub();
  await runtime.stop();
  bridge.resetForTesting();
});

Deno.test("messages: allowlist rejects unknown senders before runQuery", async () => {
  bridge.resetForTesting();

  const { runtime, calls } = buildRuntime({ allowedIds: ["approved"] });
  const replies: ChannelReply[] = [];
  const unsub = bridge.subscribeOutbox((reply) => replies.push(reply));

  await runtime.reconfigure();
  await bridge.pushInbound({
    channel: "messages",
    remoteId: "intruder",
    text: "hello",
  });

  // Give any queued work a chance to fire (it should not).
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(calls.length, 0);
  assertEquals(replies.length, 0);

  unsub();
  await runtime.stop();
  bridge.resetForTesting();
});

Deno.test("messages: pushInbound before connect throws", async () => {
  bridge.resetForTesting();

  await assertRejects(
    () =>
      bridge.pushInbound({
        channel: "messages",
        remoteId: "approved",
        text: "hello",
      }),
    Error,
    "Messages channel not connected",
  );
});

Deno.test("messages: stop clears active context", async () => {
  bridge.resetForTesting();

  const { runtime } = buildRuntime({ allowedIds: ["approved"] });
  await runtime.reconfigure();
  assertEquals(bridge.hasActiveContext(), true);

  await runtime.stop();
  assertEquals(bridge.hasActiveContext(), false);

  await assertRejects(
    () =>
      bridge.pushInbound({
        channel: "messages",
        remoteId: "approved",
        text: "hello",
      }),
    Error,
    "Messages channel not connected",
  );

  bridge.resetForTesting();
});

Deno.test("messages: no-subscriber drop flips status to error", async () => {
  bridge.resetForTesting();

  const { runtime } = buildRuntime({ allowedIds: ["approved"] });
  await runtime.reconfigure();

  // No subscriber attached before inbound arrives.
  await bridge.pushInbound({
    channel: "messages",
    remoteId: "approved",
    text: "hello",
  });

  // Deterministic wait: poll status until error transition or timeout.
  await waitForState(runtime, "messages", "error");

  const status = runtime.getStatus("messages");
  assertEquals(status?.state, "error");
  assertEquals(status?.lastError, "no outbox subscriber");

  await runtime.stop();
  bridge.resetForTesting();
});

Deno.test("messages: subscriber re-connects and status recovers to connected", async () => {
  bridge.resetForTesting();

  const { runtime } = buildRuntime({ allowedIds: ["approved"] });
  await runtime.reconfigure();

  // First inbound with no subscriber → error state
  await bridge.pushInbound({
    channel: "messages",
    remoteId: "approved",
    text: "first",
  });
  await waitForState(runtime, "messages", "error");

  // A subscriber arrives
  const replies: ChannelReply[] = [];
  const unsub = bridge.subscribeOutbox((reply) => replies.push(reply));

  const recovered = runtime.getStatus("messages");
  assertEquals(recovered?.state, "connected");
  assertEquals(recovered?.lastError, null);

  // New inbound should now deliver
  await bridge.pushInbound({
    channel: "messages",
    remoteId: "approved",
    text: "second",
  });
  await waitForOutbox(replies, 1);
  assertEquals(replies.length, 1);
  assertEquals(replies[0].text, "Echo: second");

  unsub();
  await runtime.stop();
  bridge.resetForTesting();
});

Deno.test("messages: resetForTesting clears both context and listeners", async () => {
  bridge.resetForTesting();

  const { runtime } = buildRuntime({ allowedIds: ["approved"] });
  const listener = () => {};
  bridge.subscribeOutbox(listener);
  await runtime.reconfigure();
  assert(bridge.hasActiveContext());

  bridge.resetForTesting();
  assertEquals(bridge.hasActiveContext(), false);

  // After reset, emitOutbox has no listeners, so it throws the same
  // "no outbox subscriber" error the real send path raises.
  assertThrows(
    () =>
      bridge.emitOutbox({
        channel: "messages",
        remoteId: "approved",
        sessionId: "channel:messages:approved",
        text: "anything",
      }),
    Error,
    "no outbox subscriber",
  );

  await runtime.stop();
  bridge.resetForTesting();
});

Deno.test("messages: outbox listener errors are swallowed", async () => {
  bridge.resetForTesting();

  const { runtime } = buildRuntime({ allowedIds: ["approved"] });
  const okReplies: ChannelReply[] = [];
  let badCalled = 0;
  const unsubBad = bridge.subscribeOutbox(() => {
    badCalled++;
    throw new Error("listener boom");
  });
  const unsubOk = bridge.subscribeOutbox((reply) => okReplies.push(reply));

  await runtime.reconfigure();
  await bridge.pushInbound({
    channel: "messages",
    remoteId: "approved",
    text: "hi",
  });
  await waitForOutbox(okReplies, 1);

  // The bad listener MUST have been invoked — otherwise the swallow
  // guarantee is vacuously true.
  assert(badCalled > 0, "bad listener was never invoked");
  // Good listener still received the reply despite the bad one throwing.
  assertEquals(okReplies.length, 1);

  unsubOk();
  unsubBad();
  await runtime.stop();
  bridge.resetForTesting();
});
