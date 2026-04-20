import { assertEquals, assertThrows } from "jsr:@std/assert";
import { DEFAULT_CONFIG } from "../../../src/common/config/types.ts";
import { createChannelRuntime } from "../../../src/hlvm/channels/core/runtime.ts";
import {
  formatChannelSessionId,
  isChannelSessionId,
} from "../../../src/hlvm/channels/core/session-key.ts";
import type { ChannelTransportContext } from "../../../src/hlvm/channels/core/types.ts";

Deno.test("channels: session ids are namespaced and reserved", async () => {
  assertEquals(formatChannelSessionId("telegram", "123456789"), "channel:telegram:123456789");
  assertEquals(isChannelSessionId("channel:telegram:123456789"), true);
  assertEquals(isChannelSessionId("visible-session"), false);
  assertThrows(
    () => formatChannelSessionId("tele:gram", "123"),
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

  await runtime.start();
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

  await runtime.start();

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
