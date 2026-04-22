import { assert, assertEquals } from "jsr:@std/assert";
import {
  handleReachabilityEvents,
  handleReachabilityRebind,
  handleReachabilityStatus,
} from "../../../src/hlvm/cli/repl/handlers/reachability.ts";
import { createChannelRuntime } from "../../../src/hlvm/channels/core/runtime.ts";
import {
  DEFAULT_CONFIG,
  type HlvmConfig,
} from "../../../src/common/config/types.ts";

function buildTestRuntime(config: Partial<HlvmConfig>) {
  return createChannelRuntime({
    telegram: () => ({
      channel: "telegram",
      async start() {},
      async send() {},
      async stop() {},
    }),
    discord: () => ({
      channel: "discord",
      async start() {},
      async send() {},
      async stop() {},
    }),
  }, {
    loadConfig: async () => ({ ...DEFAULT_CONFIG, ...config }),
    runQuery: async () => ({ text: "unused" }),
  });
}

Deno.test("reachability handler: status merges config + runtime statuses", async () => {
  const runtime = buildTestRuntime({
    channels: {
      telegram: {
        enabled: true,
        allowedIds: ["x"],
        transport: { mode: "relay" },
      },
      discord: {
        enabled: false,
        allowedIds: [],
        transport: { mode: "local" },
      },
    },
  });
  await runtime.reconfigure();

  const res = await handleReachabilityStatus({
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      channels: {
        telegram: {
          enabled: true,
          allowedIds: ["x"],
          transport: { mode: "relay" },
        },
        discord: {
          enabled: false,
          allowedIds: [],
          transport: { mode: "local" },
        },
      },
    }),
    runtime,
  });

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.channels.length, 2);

  // Sorted by channel name → discord first, then telegram
  assertEquals(body.channels[0].channel, "discord");
  assertEquals(body.channels[0].state, "disabled");
  assertEquals(body.channels[1].channel, "telegram");
  assertEquals(body.channels[1].state, "connected");
  assertEquals(body.channels[1].mode, "relay");

  await runtime.stop();
});

Deno.test("reachability handler: status falls back to config when channel missing from runtime", async () => {
  // Runtime has no kakao factory, but config does — status handler should
  // synthesize a disabled/unsupported status from the config alone.
  const runtime = buildTestRuntime({
    channels: {},
  });
  await runtime.reconfigure();

  const res = await handleReachabilityStatus({
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      channels: {
        kakao: {
          enabled: true,
          allowedIds: ["y"],
          transport: { mode: "relay" },
        },
      },
    }),
    runtime,
  });

  const body = await res.json();
  assertEquals(body.channels.length, 1);
  assertEquals(body.channels[0].channel, "kakao");
  assertEquals(body.channels[0].configured, true);
  assertEquals(body.channels[0].enabled, true);
  assertEquals(body.channels[0].state, "unsupported");
  assertEquals(body.channels[0].mode, "relay");

  await runtime.stop();
});

Deno.test("reachability handler: rebind calls runtime.reconfigure and returns current statuses", async () => {
  let reconfigureCalls = 0;
  const runtime = buildTestRuntime({
    channels: {
      telegram: {
        enabled: true,
        allowedIds: ["x"],
        transport: { mode: "relay" },
      },
    },
  });
  const realReconfigure = runtime.reconfigure.bind(runtime);
  const instrumentedRuntime = {
    ...runtime,
    listStatuses: runtime.listStatuses.bind(runtime),
    subscribe: runtime.subscribe.bind(runtime),
    async reconfigure() {
      reconfigureCalls++;
      await realReconfigure();
    },
  };

  const res = await handleReachabilityRebind({ runtime: instrumentedRuntime });

  assertEquals(reconfigureCalls, 1);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.channels.length, 1);
  assertEquals(body.channels[0].channel, "telegram");
  assertEquals(body.channels[0].state, "connected");

  await runtime.stop();
});

Deno.test({
  name: "reachability handler: events SSE seeds with snapshot and emits on status change",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const runtime = buildTestRuntime({
      channels: {
        telegram: {
          enabled: true,
          allowedIds: ["x"],
          transport: { mode: "relay" },
        },
      },
    });
    await runtime.reconfigure();

    const aborter = new AbortController();
    const req = new Request(
      "http://test.local/api/reachability/events",
      { signal: aborter.signal },
    );
    const res = handleReachabilityEvents(req, { runtime });

    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // 1) retry preamble
    const preamble = decoder.decode((await reader.read()).value!);
    assert(preamble.includes("retry:"));

    // 2) snapshot emitted by setup()
    const snapshot = decoder.decode((await reader.read()).value!);
    assert(snapshot.startsWith("id: 1\n"));
    assert(snapshot.includes("event: reachability_updated\n"));
    assert(snapshot.includes(`"channel":"telegram"`));
    assert(snapshot.includes(`"state":"connected"`));

    // 3) trigger a status change → second event
    await runtime.reconfigure();
    const secondChunk = decoder.decode((await reader.read()).value!);
    assert(
      secondChunk.includes("event: reachability_updated\n"),
      `expected reachability_updated on second event, got ${secondChunk}`,
    );

    aborter.abort();
    await reader.cancel().catch(() => {});
    await runtime.stop();
  },
});

Deno.test({
  name: "reachability handler: events SSE abort runs cleanup without throwing",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // We cannot introspect the runtime's listener Set from outside, so
    // instead we verify the public-facing invariant: after abort, the
    // runtime keeps working (subsequent reconfigure doesn't throw even
    // though the handler's emit callback would be writing to a closed
    // stream if its unsubscribe had leaked).
    const runtime = buildTestRuntime({
      channels: {
        telegram: {
          enabled: true,
          allowedIds: ["x"],
          transport: { mode: "relay" },
        },
      },
    });
    await runtime.reconfigure();

    const aborter = new AbortController();
    const req = new Request(
      "http://test.local/api/reachability/events",
      { signal: aborter.signal },
    );
    const res = handleReachabilityEvents(req, { runtime });
    const reader = res.body!.getReader();

    await reader.read(); // preamble → triggers setup, subscribes
    await reader.read(); // snapshot
    await new Promise((r) => setTimeout(r, 5));

    aborter.abort();
    await reader.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, 5));

    // After abort, force an emit. If the handler leaked its subscriber,
    // the listener would still try to `emit()` into a closed SSE stream.
    // createSSEResponse swallows that error via its internal cleanup, so
    // we instead assert the runtime reports the new state correctly and
    // doesn't hang — a basic liveness check.
    await runtime.reconfigure();
    assertEquals(runtime.getStatus("telegram")?.state, "connected");

    await runtime.stop();
  },
});
