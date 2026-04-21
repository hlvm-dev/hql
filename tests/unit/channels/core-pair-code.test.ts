import { assert, assertEquals } from "jsr:@std/assert";
import {
  DEFAULT_CONFIG,
  type HlvmConfig,
} from "../../../src/common/config/types.ts";
import { createChannelRuntime } from "../../../src/hlvm/channels/core/runtime.ts";
import type {
  ChannelReply,
  ChannelTransportContext,
} from "../../../src/hlvm/channels/core/types.ts";

// Helper: build a runtime with a telegram factory that captures
// reply-send attempts + resolves the transport context so tests can
// drive inbound messages directly.
function buildPairingRuntime(options: {
  allowedIds?: string[];
  initialConfig?: Partial<HlvmConfig["channels"]>;
}) {
  const sent: ChannelReply[] = [];
  const runs: string[] = [];
  const patches: Array<Partial<HlvmConfig>> = [];
  let resolveContext!: (ctx: ChannelTransportContext) => void;
  const contextPromise = new Promise<ChannelTransportContext>((resolve) => {
    resolveContext = resolve;
  });

  // Starts with this config; further patches mutate it in memory so the
  // post-pair runtime sees the updated allowedIds on the next inbound.
  let configState: HlvmConfig = {
    ...DEFAULT_CONFIG,
    channels: {
      telegram: {
        enabled: true,
        allowedIds: options.allowedIds ?? [],
        transport: { mode: "relay" },
      },
      ...(options.initialConfig ?? {}),
    },
  };

  const runtime = createChannelRuntime({
    telegram: () => ({
      channel: "telegram",
      async start(ctx) {
        resolveContext(ctx);
      },
      async send(reply) {
        sent.push(reply);
      },
      async stop() {},
    }),
  }, {
    loadConfig: async () => configState,
    runQuery: async (opts) => {
      runs.push(opts.query);
      return { text: `Echo: ${opts.query}` };
    },
    patchConfig: async (updates) => {
      patches.push(updates);
      // Apply the merge so subsequent loadConfig calls reflect the
      // change (mirrors what the real config.patch + merge would do).
      configState = {
        ...configState,
        ...(updates as HlvmConfig),
      };
      if (updates.channels) {
        configState = {
          ...configState,
          channels: updates.channels as HlvmConfig["channels"],
        };
      }
      return configState;
    },
  });

  return { runtime, sent, runs, patches, contextPromise };
}

Deno.test("pair-code: match records sender, clears code, sends canned reply, no agent call", async () => {
  const { runtime, sent, runs, patches, contextPromise } = buildPairingRuntime(
    { allowedIds: [] },
  );
  await runtime.reconfigure();
  const ctx = await contextPromise;

  runtime.armPairCode("telegram", "1234");

  await ctx.receive({
    channel: "telegram",
    remoteId: "+15551234567",
    text: "HLVM-1234",
  });

  // No agent call — pair message must short-circuit runQuery.
  assertEquals(runs, [], "runQuery must NOT be invoked on pair-code message");
  // Exactly one canned reply sent.
  assertEquals(sent.length, 1);
  assertEquals(sent[0].text, "✨ You're in. Text me anytime.");
  assertEquals(sent[0].remoteId, "+15551234567");
  // Sender recorded in allowedIds via patchConfig.
  assertEquals(patches.length, 1);
  const patched = patches[0].channels!;
  assertEquals(patched.telegram?.allowedIds, ["+15551234567"]);
  // Code cleared so a second send can't replay pairing.
  assertEquals(runtime.hasPairCodeArmed("telegram"), false);

  await runtime.stop();
});

Deno.test("pair-code: agent runs on the NEXT inbound after pairing", async () => {
  const { runtime, sent, runs, contextPromise } = buildPairingRuntime(
    { allowedIds: [] },
  );
  await runtime.reconfigure();
  const ctx = await contextPromise;

  runtime.armPairCode("telegram", "1234");

  // First inbound: pair-code message — short-circuits.
  await ctx.receive({
    channel: "telegram",
    remoteId: "+15551234567",
    text: "HLVM-1234",
  });
  assertEquals(runs.length, 0);
  assertEquals(sent.length, 1);

  // Second inbound: the REAL first user message — runs the agent.
  await ctx.receive({
    channel: "telegram",
    remoteId: "+15551234567",
    text: "what's the weather?",
  });
  assertEquals(runs, ["what's the weather?"]);
  // Two replies total: canned + agent echo.
  assertEquals(sent.length, 2);
  assertEquals(sent[1].text, "Echo: what's the weather?");

  await runtime.stop();
});

Deno.test("pair-code: text that contains code but doesn't start with HLVM- → silent drop", async () => {
  const { runtime, sent, runs, patches, contextPromise } = buildPairingRuntime(
    { allowedIds: [] },
  );
  await runtime.reconfigure();
  const ctx = await contextPromise;

  runtime.armPairCode("telegram", "1234");

  // Substring match would have false-positived here. Anchored regex rejects.
  await ctx.receive({
    channel: "telegram",
    remoteId: "+15551234567",
    text: "got it, HLVM-1234 sent to you",
  });

  assertEquals(runs, []);
  assertEquals(sent, []);
  assertEquals(patches, []);
  assertEquals(runtime.hasPairCodeArmed("telegram"), true, "code stays armed");

  await runtime.stop();
});

Deno.test("pair-code: off-by-one-digit drift rejected by \\b", async () => {
  const { runtime, sent, runs, contextPromise } = buildPairingRuntime(
    { allowedIds: [] },
  );
  await runtime.reconfigure();
  const ctx = await contextPromise;

  runtime.armPairCode("telegram", "1234");

  await ctx.receive({
    channel: "telegram",
    remoteId: "+15551234567",
    text: "HLVM-12345",
  });

  assertEquals(runs, []);
  assertEquals(sent, []);
  assertEquals(runtime.hasPairCodeArmed("telegram"), true);

  await runtime.stop();
});

Deno.test("pair-code: leading whitespace still matches", async () => {
  const { runtime, sent, contextPromise } = buildPairingRuntime(
    { allowedIds: [] },
  );
  await runtime.reconfigure();
  const ctx = await contextPromise;

  runtime.armPairCode("telegram", "1234");

  await ctx.receive({
    channel: "telegram",
    remoteId: "+15551234567",
    text: "  \t HLVM-1234",
  });

  // Canned reply fired → match succeeded.
  assertEquals(sent.length, 1);
  assertEquals(sent[0].text, "✨ You're in. Text me anytime.");

  await runtime.stop();
});

Deno.test("pair-code: no code armed → silent drop (existing deny-all behavior)", async () => {
  const { runtime, sent, runs, patches, contextPromise } = buildPairingRuntime(
    { allowedIds: [] },
  );
  await runtime.reconfigure();
  const ctx = await contextPromise;

  // Deliberately do NOT arm a code.

  await ctx.receive({
    channel: "telegram",
    remoteId: "+15551234567",
    text: "HLVM-1234",
  });

  assertEquals(runs, []);
  assertEquals(sent, []);
  assertEquals(patches, []);

  await runtime.stop();
});

Deno.test("pair-code: branch skipped when allowedIds already populated", async () => {
  // Existing paired sender is "approved". A different sender now sends
  // a pair-code message — they must be rejected as unknown sender,
  // NOT paired. The pair-code branch only runs when allowedIds is empty.
  const { runtime, sent, runs, patches, contextPromise } = buildPairingRuntime(
    { allowedIds: ["approved"] },
  );
  await runtime.reconfigure();
  const ctx = await contextPromise;

  runtime.armPairCode("telegram", "1234");

  await ctx.receive({
    channel: "telegram",
    remoteId: "intruder",
    text: "HLVM-1234",
  });

  assertEquals(runs, []);
  assertEquals(sent, []);
  assertEquals(patches, []);
  // Code remains armed (intruder never triggered pairing).
  assertEquals(runtime.hasPairCodeArmed("telegram"), true);

  await runtime.stop();
});

Deno.test("pair-code: disarmPairCode clears armed state", async () => {
  const { runtime, sent, contextPromise } = buildPairingRuntime(
    { allowedIds: [] },
  );
  await runtime.reconfigure();
  const ctx = await contextPromise;

  runtime.armPairCode("telegram", "1234");
  assertEquals(runtime.hasPairCodeArmed("telegram"), true);

  runtime.disarmPairCode("telegram");
  assertEquals(runtime.hasPairCodeArmed("telegram"), false);

  // Subsequent inbound with the old code silently drops.
  await ctx.receive({
    channel: "telegram",
    remoteId: "+15551234567",
    text: "HLVM-1234",
  });
  assertEquals(sent, []);

  await runtime.stop();
});

Deno.test("pair-code: sender.id takes precedence over remoteId during pairing", async () => {
  const { runtime, sent, patches, contextPromise } = buildPairingRuntime(
    { allowedIds: [] },
  );
  await runtime.reconfigure();
  const ctx = await contextPromise;

  runtime.armPairCode("telegram", "1234");

  await ctx.receive({
    channel: "telegram",
    remoteId: "chat-id-xyz",
    sender: { id: "sender-id-abc", display: "Alice" },
    text: "HLVM-1234",
  });

  // The recorded allowlist entry must be sender.id, not remoteId.
  assertEquals(sent.length, 1);
  assertEquals(patches.length, 1);
  assertEquals(
    patches[0].channels!.telegram?.allowedIds,
    ["sender-id-abc"],
    "sender.id wins over remoteId for allowlist recording",
  );

  await runtime.stop();
});
