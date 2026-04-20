import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import {
  DEFAULT_CONFIG,
  type HlvmConfig,
} from "../../../src/common/config/types.ts";
import { createChannelRuntime } from "../../../src/hlvm/channels/core/runtime.ts";
import {
  formatChannelSessionId,
  isChannelSessionId,
} from "../../../src/hlvm/channels/core/session-key.ts";
import type {
  ChannelStatus,
  ChannelTransportContext,
} from "../../../src/hlvm/channels/core/types.ts";

Deno.test("channels: session ids are namespaced and reserved", async () => {
  assertEquals(formatChannelSessionId("telegram", "123456789"), "channel:telegram:123456789");
  assertEquals(isChannelSessionId("channel:telegram:123456789"), true);
  assertEquals(isChannelSessionId("visible-session"), false);
  assertThrows(
    () => formatChannelSessionId("tele:gram", "123"),
    Error,
    "must not contain ':'",
  );
  // remoteId containing ':' would break the parser — also rejected.
  assertThrows(
    () => formatChannelSessionId("telegram", "remote:id"),
    Error,
    "must not contain ':'",
  );
});

Deno.test("channels: runtime normalizes inbound chat into one queued agent request and reply", async () => {
  const sent: Array<{ sessionId: string; remoteId: string; text: string }> = [];
  const runs: Array<{ sessionId: string; permissionMode: string; noInput: boolean }> = [];
  let resolveContext!: (context: ChannelTransportContext) => void;
  const contextPromise = new Promise<ChannelTransportContext>((resolve) => {
    resolveContext = resolve;
  });

  const runtime = createChannelRuntime({
    telegram: () => ({
      channel: "telegram",
      async start(nextContext) {
        resolveContext(nextContext);
      },
      async send(message) {
        sent.push({
          sessionId: message.sessionId,
          remoteId: message.remoteId,
          text: message.text,
        });
      },
      async stop() {},
    }),
  }, {
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      permissionMode: "bypassPermissions",
      channels: {
        telegram: {
          enabled: true,
          allowedIds: ["123456789"],
          transport: {
            mode: "relay",
          },
        },
      },
    }),
    runQuery: async (options) => {
      runs.push({
        sessionId: options.sessionId,
        permissionMode: options.permissionMode,
        noInput: options.noInput,
      });
      return { text: `Echo: ${options.query}` };
    },
  });

  await runtime.reconfigure();
  const transportContext = await contextPromise;
  await transportContext.receive({
    channel: "telegram",
    remoteId: "123456789",
    text: "hello",
  });

  assertEquals(runs, [{
    sessionId: "channel:telegram:123456789",
    permissionMode: "default",
    noInput: true,
  }]);
  assertEquals(sent, [{
    sessionId: "channel:telegram:123456789",
    remoteId: "123456789",
    text: "Echo: hello",
  }]);
  assertEquals(runtime.listStatuses()[0]?.state, "connected");

  await runtime.stop();
});

Deno.test("channels: enabled but unimplemented transports report unsupported status", async () => {
  const runtime = createChannelRuntime({}, {
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      channels: {
        kakao: {
          enabled: true,
          transport: {
            mode: "relay",
          },
        },
      },
    }),
    runQuery: async () => ({ text: "unused" }),
  });

  await runtime.reconfigure();

  assertEquals(runtime.listStatuses(), [{
    channel: "kakao",
    configured: true,
    enabled: true,
    state: "unsupported",
    mode: "relay",
    allowedIds: [],
    lastError: null,
  }]);
});

function buildAllowlistRuntime(
  channelConfig: { allowedIds?: string[] },
) {
  const runs: string[] = [];
  const sent: string[] = [];
  let resolveContext!: (context: ChannelTransportContext) => void;
  const contextPromise = new Promise<ChannelTransportContext>((resolve) => {
    resolveContext = resolve;
  });

  const runtime = createChannelRuntime({
    telegram: () => ({
      channel: "telegram",
      async start(nextContext) {
        resolveContext(nextContext);
      },
      async send(message) {
        sent.push(message.text);
      },
      async stop() {},
    }),
  }, {
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      channels: {
        telegram: {
          enabled: true,
          ...channelConfig,
          transport: { mode: "relay" },
        },
      },
    }),
    runQuery: async (options) => {
      runs.push(options.query);
      return { text: `Echo: ${options.query}` };
    },
  });

  return { runtime, runs, sent, contextPromise };
}

Deno.test("channels: rejects inbound message when sender not in allowedIds", async () => {
  const { runtime, runs, sent, contextPromise } = buildAllowlistRuntime({
    allowedIds: ["approved"],
  });
  await runtime.reconfigure();
  const ctx = await contextPromise;

  await ctx.receive({
    channel: "telegram",
    remoteId: "intruder",
    text: "hello",
  });

  assertEquals(runs, []);
  assertEquals(sent, []);
  await runtime.stop();
});

Deno.test("channels: deny-all when allowedIds is empty or undefined", async () => {
  const { runtime, runs, contextPromise } = buildAllowlistRuntime({});
  await runtime.reconfigure();
  const ctx = await contextPromise;

  await ctx.receive({
    channel: "telegram",
    remoteId: "anyone",
    text: "hi",
  });

  assertEquals(runs, []);

  const { runtime: runtime2, runs: runs2, contextPromise: ctxP2 } =
    buildAllowlistRuntime({ allowedIds: [] });
  await runtime2.reconfigure();
  const ctx2 = await ctxP2;
  await ctx2.receive({
    channel: "telegram",
    remoteId: "anyone",
    text: "hi",
  });
  assertEquals(runs2, []);

  await runtime.stop();
  await runtime2.stop();
});

Deno.test("channels: sender.id takes precedence over remoteId for allowlist", async () => {
  const { runtime, runs, contextPromise } = buildAllowlistRuntime({
    allowedIds: ["sender-identity"],
  });
  await runtime.reconfigure();
  const ctx = await contextPromise;

  await ctx.receive({
    channel: "telegram",
    remoteId: "remote-chat-id",
    sender: { id: "sender-identity", display: "Alice" },
    text: "hi",
  });

  assertEquals(runs, ["hi"]);
  await runtime.stop();
});

Deno.test("channels: sender.id mismatch rejects even when remoteId matches allowedIds", async () => {
  // allowedIds contains "sender-identity". remoteId also happens to be
  // "sender-identity" but sender.id is "different" — because sender.id
  // takes precedence, this must still be rejected.
  const { runtime, runs, contextPromise } = buildAllowlistRuntime({
    allowedIds: ["sender-identity"],
  });
  await runtime.reconfigure();
  const ctx = await contextPromise;

  await ctx.receive({
    channel: "telegram",
    remoteId: "sender-identity",
    sender: { id: "different-sender" },
    text: "hello",
  });

  assertEquals(runs, [], "must reject — sender.id mismatch overrides remoteId match");
  await runtime.stop();
});

Deno.test("channels: reconfigure picks up config changes without a process restart", async () => {
  const startCalls: string[] = [];
  const stopCalls: string[] = [];
  let enabled = true;

  const runtime = createChannelRuntime({
    telegram: () => ({
      channel: "telegram",
      async start() {
        startCalls.push("start");
      },
      async send() {},
      async stop() {
        stopCalls.push("stop");
      },
    }),
  }, {
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      channels: {
        telegram: {
          enabled,
          allowedIds: ["x"],
          transport: { mode: "relay" },
        },
      },
    }),
    runQuery: async () => ({ text: "unused" }),
  });

  await runtime.reconfigure();
  assertEquals(startCalls.length, 1);
  assertEquals(runtime.getStatus("telegram")?.state, "connected");

  enabled = false;
  await runtime.reconfigure();

  assertEquals(stopCalls.length, 1);
  assertEquals(runtime.getStatus("telegram")?.state, "disabled");
  await runtime.stop();
});

Deno.test("channels: concurrent reconfigure calls serialize", async () => {
  let inStart = 0;
  let maxOverlap = 0;
  const gate = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 5));

  const runtime = createChannelRuntime({
    telegram: () => ({
      channel: "telegram",
      async start() {
        inStart++;
        maxOverlap = Math.max(maxOverlap, inStart);
        await gate();
        inStart--;
      },
      async send() {},
      async stop() {
        await gate();
      },
    }),
  }, {
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      channels: {
        telegram: {
          enabled: true,
          allowedIds: ["x"],
          transport: { mode: "relay" },
        },
      },
    }),
    runQuery: async () => ({ text: "unused" }),
  });

  await Promise.all([
    runtime.reconfigure(),
    runtime.reconfigure(),
    runtime.reconfigure(),
  ]);

  assertEquals(maxOverlap, 1);
  await runtime.stop();
});

Deno.test("channels: subscribe fires on status transitions and swallows listener errors", async () => {
  const snapshots: ChannelStatus[][] = [];
  let badCalled = 0;
  const okListener = (channels: ChannelStatus[]) => {
    snapshots.push(channels);
  };
  const badListener = () => {
    badCalled++;
    throw new Error("listener boom");
  };

  const runtime = createChannelRuntime({
    telegram: () => ({
      channel: "telegram",
      async start() {},
      async send() {},
      async stop() {},
    }),
  }, {
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      channels: {
        telegram: {
          enabled: true,
          allowedIds: ["x"],
          transport: { mode: "relay" },
        },
      },
    }),
    runQuery: async () => ({ text: "unused" }),
  });

  const unsubBad = runtime.subscribe(badListener);
  const unsubOk = runtime.subscribe(okListener);

  await runtime.reconfigure();

  // The bad listener MUST have been called at least once — otherwise
  // the "errors are swallowed" guarantee is vacuously true.
  assert(
    badCalled > 0,
    "bad listener was never invoked; swallow guarantee is unverified",
  );
  assert(
    snapshots.length > 0,
    "good listener never fired despite the bad one throwing",
  );
  const last = snapshots.at(-1)!;
  assertEquals(last[0]?.state, "connected");

  unsubOk();
  unsubBad();
  await runtime.stop();
});

Deno.test("channels: transport.start() throwing puts channel in error state", async () => {
  const runtime = createChannelRuntime({
    telegram: () => ({
      channel: "telegram",
      async start() {
        throw new Error("start boom");
      },
      async send() {},
      async stop() {},
    }),
  }, {
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      channels: {
        telegram: {
          enabled: true,
          allowedIds: ["x"],
          transport: { mode: "relay" },
        },
      },
    }),
    runQuery: async () => ({ text: "unused" }),
  });

  await runtime.reconfigure();

  const status = runtime.getStatus("telegram");
  assertEquals(status?.state, "error");
  assert(
    status?.lastError?.includes("start boom"),
    `expected lastError to contain "start boom", got: ${status?.lastError}`,
  );

  await runtime.stop();
});

Deno.test("channels: transport.stop() throwing puts channel in error state", async () => {
  let stopCalls = 0;
  const runtime = createChannelRuntime({
    telegram: () => ({
      channel: "telegram",
      async start() {},
      async send() {},
      async stop() {
        stopCalls++;
        throw new Error("stop boom");
      },
    }),
  }, {
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      channels: {
        telegram: {
          enabled: true,
          allowedIds: ["x"],
          transport: { mode: "relay" },
        },
      },
    }),
    runQuery: async () => ({ text: "unused" }),
  });

  await runtime.reconfigure(); // starts
  assertEquals(runtime.getStatus("telegram")?.state, "connected");

  // runtime.stop() (not reconfigure — which would restart) triggers
  // stopActiveTransports, which wraps each transport.stop in try/catch
  // and records the error on status.
  await runtime.stop();

  assertEquals(stopCalls, 1);
  const status = runtime.getStatus("telegram");
  assertEquals(status?.state, "error");
  assert(
    status?.lastError?.includes("stop boom"),
    `expected lastError to contain "stop boom", got: ${status?.lastError}`,
  );
});

Deno.test("channels: per-chat queue serializes two inbound messages for same remoteId", async () => {
  // Two messages for the same remoteId arriving in parallel must process
  // one-at-a-time (FIFO). This is the core invariant the queue provides.
  const order: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let resolveContext!: (context: ChannelTransportContext) => void;
  const contextPromise = new Promise<ChannelTransportContext>((resolve) => {
    resolveContext = resolve;
  });

  const runtime = createChannelRuntime({
    telegram: () => ({
      channel: "telegram",
      async start(ctx) {
        resolveContext(ctx);
      },
      async send() {},
      async stop() {},
    }),
  }, {
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      channels: {
        telegram: {
          enabled: true,
          allowedIds: ["approved"],
          transport: { mode: "relay" },
        },
      },
    }),
    runQuery: async (opts) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(`start:${opts.query}`);
      await new Promise((r) => setTimeout(r, 15));
      order.push(`end:${opts.query}`);
      inFlight--;
      return { text: `Echo: ${opts.query}` };
    },
  });

  await runtime.reconfigure();
  const ctx = await contextPromise;

  // Fire two inbound for the SAME remoteId in parallel.
  await Promise.all([
    ctx.receive({ channel: "telegram", remoteId: "approved", text: "first" }),
    ctx.receive({ channel: "telegram", remoteId: "approved", text: "second" }),
  ]);

  assertEquals(maxInFlight, 1, "queue must serialize — no concurrent runQuery");
  assertEquals(order, [
    "start:first",
    "end:first",
    "start:second",
    "end:second",
  ], "FIFO order violated");

  await runtime.stop();
});

Deno.test("channels: queue does NOT serialize across different remoteIds", async () => {
  // Two messages for DIFFERENT remoteIds in parallel must be allowed
  // to overlap (per-chat, not global, queue).
  let inFlight = 0;
  let maxInFlight = 0;
  let resolveContext!: (context: ChannelTransportContext) => void;
  const contextPromise = new Promise<ChannelTransportContext>((resolve) => {
    resolveContext = resolve;
  });

  const runtime = createChannelRuntime({
    telegram: () => ({
      channel: "telegram",
      async start(ctx) {
        resolveContext(ctx);
      },
      async send() {},
      async stop() {},
    }),
  }, {
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      channels: {
        telegram: {
          enabled: true,
          allowedIds: ["alice", "bob"],
          transport: { mode: "relay" },
        },
      },
    }),
    runQuery: async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return { text: "echo" };
    },
  });

  await runtime.reconfigure();
  const ctx = await contextPromise;

  await Promise.all([
    ctx.receive({ channel: "telegram", remoteId: "alice", text: "hi alice" }),
    ctx.receive({ channel: "telegram", remoteId: "bob", text: "hi bob" }),
  ]);

  assertEquals(maxInFlight, 2, "different remoteIds must be allowed to overlap");

  await runtime.stop();
});

Deno.test("channels: transport updateConfig preserves sibling channels", async () => {
  const patchCalls: Array<Partial<HlvmConfig>> = [];
  let resolveContext!: (context: ChannelTransportContext) => void;
  const contextPromise = new Promise<ChannelTransportContext>((resolve) => {
    resolveContext = resolve;
  });

  const runtime = createChannelRuntime({
    telegram: () => ({
      channel: "telegram",
      async start(nextContext) {
        resolveContext(nextContext);
      },
      async send() {},
      async stop() {},
    }),
  }, {
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      channels: {
        telegram: {
          enabled: true,
          allowedIds: ["x"],
          transport: { mode: "relay" },
        },
        messages: {
          enabled: false,
          allowedIds: ["self"],
          transport: { mode: "local" },
        },
      },
    }),
    runQuery: async () => ({ text: "unused" }),
    patchConfig: async (updates) => {
      patchCalls.push(updates);
      return { ...DEFAULT_CONFIG, ...updates } as HlvmConfig;
    },
  });

  await runtime.reconfigure();
  const ctx = await contextPromise;

  await ctx.updateConfig({ transport: { mode: "relay", cursor: 42 } });

  assertEquals(patchCalls.length, 1);
  const patched = patchCalls[0].channels!;
  assertEquals(patched.telegram?.transport?.cursor, 42);
  assertEquals(patched.messages?.enabled, false, "sibling must be preserved");
  assertEquals(patched.messages?.transport?.mode, "local");
  await runtime.stop();
});
