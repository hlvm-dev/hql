import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  createTelegramProvisioningService,
} from "../../../src/hlvm/channels/telegram/provisioning.ts";
import { DEFAULT_CONFIG, type HlvmConfig } from "../../../src/common/config/types.ts";

function withTelegramDeviceId(
  config: HlvmConfig = DEFAULT_CONFIG,
  deviceId = "device-1",
): HlvmConfig {
  return {
    ...config,
    channels: {
      ...(config.channels ?? {}),
      telegram: {
        ...(config.channels?.telegram ?? {}),
        transport: {
          ...(config.channels?.telegram?.transport ?? {}),
          deviceId,
        },
      },
    },
  };
}

Deno.test("telegram provisioning: createSession returns a prefilled create link and arms pair code", async () => {
  const armed: Array<{ channel: string; code: string }> = [];
  const service = createTelegramProvisioningService({
    provisioningBridgeBaseUrl: "",
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
    randomId: () => "abc123def456",
    randomCode: () => "1234",
    armPairCode: (channel, code) => armed.push({ channel, code }),
    disarmPairCode: () => {},
    loadConfig: async () => withTelegramDeviceId(),
    patchConfig: async () => DEFAULT_CONFIG,
    reconfigure: async () => {},
    getStatus: () => null,
  });

  const session = await service.createSession({ managerBotUsername: "@hlvm_manager_bot" });

  assertEquals(session.sessionId, "abc123def456");
  assertEquals(session.state, "pending");
  assertEquals(session.pairCode, "1234");
  assertEquals(session.managerBotUsername, "hlvm_manager_bot");
  assertEquals(session.botName, "HLVM");
  assertEquals(session.botUsername, "hlvm_abc123_bot");
  assertEquals(session.qrKind, "create_bot");
  assertEquals(
    session.qrUrl,
    "https://t.me/newbot/hlvm_manager_bot/hlvm_abc123_bot?name=HLVM",
  );
  assertEquals(
    session.createUrl,
    "https://t.me/newbot/hlvm_manager_bot/hlvm_abc123_bot?name=HLVM",
  );
  assertEquals(armed, [{ channel: "telegram", code: "1234" }]);
});

Deno.test("telegram provisioning: createSession defaults to the production manager bot and bridge URL", async () => {
  const service = createTelegramProvisioningService({
    loadConfig: async () => withTelegramDeviceId(),
    randomId: () => "abc123def456",
    randomCode: () => "1234",
    bridgeClient: {
      async registerSession(input) {
        return {
          sessionId: input.sessionId,
          state: "pending",
          managerBotUsername: input.managerBotUsername,
          botName: input.botName,
          botUsername: input.botUsername,
          createUrl: `https://t.me/newbot/${input.managerBotUsername}/${input.botUsername}?name=${encodeURIComponent(input.botName)}`,
          createdAt: input.createdAt ?? "2026-04-21T00:00:00.000Z",
          expiresAt: input.expiresAt,
        };
      },
      async claimSession() {
        return { ok: false as const, reason: "missing" as const };
      },
    },
  });

  const session = await service.createSession();

  assertEquals(session.managerBotUsername, "hlvm_setup_helper_2_bot");
  assertEquals(
    session.provisionUrl,
    "https://hlvm-telegram-bridge.hlvm.deno.net/telegram/start?session=abc123def456",
  );
  assertEquals(
    session.createUrl,
    "https://t.me/newbot/hlvm_setup_helper_2_bot/hlvm_abc123_bot?name=HLVM",
  );
  assertEquals(
    session.qrUrl,
    "https://t.me/newbot/hlvm_setup_helper_2_bot/hlvm_abc123_bot?name=HLVM",
  );
});

Deno.test("telegram provisioning: createSession includes a bridge provisioning URL when configured", async () => {
  const service = createTelegramProvisioningService({
    provisioningBridgeBaseUrl: "https://provision.hlvm.dev",
    loadConfig: async () => withTelegramDeviceId(),
    randomId: () => "abc123def456",
    randomCode: () => "1234",
    bridgeClient: {
      async registerSession(input) {
        return {
          sessionId: input.sessionId,
          state: "pending",
          managerBotUsername: input.managerBotUsername,
          botName: input.botName,
          botUsername: input.botUsername,
          createUrl: "https://t.me/newbot/hlvm_setup_helper_2_bot/hlvm_abc123_bot?name=HLVM",
          createdAt: input.createdAt ?? "2026-04-21T00:00:00.000Z",
          expiresAt: input.expiresAt,
        };
      },
      async claimSession() {
        return { ok: false as const, reason: "missing" as const };
      },
    },
  });

  const session = await service.createSession();

  assertEquals(
    session.provisionUrl,
    "https://provision.hlvm.dev/telegram/start?session=abc123def456",
  );
  assertEquals(
    session.createUrl,
    "https://t.me/newbot/hlvm_setup_helper_2_bot/hlvm_abc123_bot?name=HLVM",
  );
});

Deno.test("telegram provisioning: createSession reuses the active pending session", async () => {
  const armed: Array<{ channel: string; code: string }> = [];
  const registrations: Array<{ sessionId: string; deviceId?: string }> = [];
  const service = createTelegramProvisioningService({
    provisioningBridgeBaseUrl: "https://provision.hlvm.dev",
    loadConfig: async () => withTelegramDeviceId(),
    randomId: (() => {
      const values = ["abc123def456", "claim789ghi012", "zzz999yyy888", "claim222333"];
      return () => values.shift() ?? "fallback";
    })(),
    randomCode: () => "1234",
    armPairCode: (channel, code) => armed.push({ channel, code }),
    disarmPairCode: () => {},
    bridgeClient: {
      async registerSession(input) {
        registrations.push({
          sessionId: input.sessionId,
          deviceId: input.deviceId,
        });
        return {
          sessionId: input.sessionId,
          state: "pending",
          managerBotUsername: input.managerBotUsername,
          botName: input.botName,
          botUsername: input.botUsername,
          createUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_abc123_bot?name=HLVM",
          createdAt: input.createdAt ?? "2026-04-21T00:00:00.000Z",
          expiresAt: input.expiresAt,
        };
      },
      async claimSession() {
        return { ok: false as const, reason: "pending" as const };
      },
    },
  });

  const first = await service.createSession();
  const second = await service.createSession();

  assertEquals(second, first);
  assertEquals(registrations, [{ sessionId: "abc123def456", deviceId: "device-1" }]);
  assertEquals(armed, [{ channel: "telegram", code: "1234" }]);
  assertEquals(service.cancelSession(), true);
});

Deno.test("telegram provisioning: createSession reuses an existing direct bot chat when already configured", async () => {
  const armed: Array<{ channel: string; code: string }> = [];
  const service = createTelegramProvisioningService({
    provisioningBridgeBaseUrl: "",
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
    randomId: () => "abc123def456",
    randomCode: () => "1234",
    armPairCode: (channel, code) => armed.push({ channel, code }),
    disarmPairCode: () => {},
    loadConfig: async () => ({
      ...withTelegramDeviceId(),
      channels: {
        telegram: {
          enabled: true,
          transport: {
            mode: "direct",
            token: "123:abc",
            username: "@hlvm_direct_test_01_bot",
            deviceId: "device-1",
          },
        },
      },
    }),
    patchConfig: async () => DEFAULT_CONFIG,
    reconfigure: async () => {},
    getStatus: () => null,
  });

  const session = await service.createSession();

  assertEquals(session.state, "completed");
  assertEquals(session.pairCode, "");
  assertEquals(session.botUsername, "hlvm_direct_test_01_bot");
  assertEquals(session.qrKind, "open_bot");
  assertEquals(session.qrUrl, "tg://resolve?domain=hlvm_direct_test_01_bot");
  assertEquals(session.createUrl, "tg://resolve?domain=hlvm_direct_test_01_bot");
  assertEquals(session.provisionUrl, undefined);
  assertEquals(armed, []);
});

Deno.test("telegram provisioning: completeSession writes direct telegram config and marks completed on healthy rebind", async () => {
  const patches: Array<Partial<HlvmConfig>> = [];
  let reconfigureCalls = 0;

  const service = createTelegramProvisioningService({
    provisioningBridgeBaseUrl: "",
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
    randomId: () => "abc123def456",
    randomCode: () => "1234",
    armPairCode: () => {},
    disarmPairCode: () => {},
    loadConfig: async () => ({
      ...withTelegramDeviceId(),
      channels: {
        discord: {
          enabled: false,
          allowedIds: ["self"],
          transport: { mode: "local" },
        },
        telegram: {
          transport: { deviceId: "device-1" },
        },
      },
    }),
    patchConfig: async (updates) => {
      patches.push(updates);
      return { ...withTelegramDeviceId(), ...updates } as HlvmConfig;
    },
    reconfigure: async () => {
      reconfigureCalls++;
    },
    getStatus: () => ({
      channel: "telegram",
      configured: true,
      enabled: true,
      state: "connected",
      mode: "direct",
      allowedIds: [],
      lastError: null,
    }),
  });

  const session = await service.createSession();
  const result = await service.completeSession({
    sessionId: session.sessionId,
    token: "123:abc",
    username: "hlvm_real_bot",
    ownerUserId: 8689778203,
  });

  assertEquals(reconfigureCalls, 1);
  assertEquals(patches.length, 1);
  assertEquals(
    patches[0].channels?.telegram?.transport,
    {
      mode: "direct",
      deviceId: "device-1",
      ownerUserId: 8689778203,
      token: "123:abc",
      username: "hlvm_real_bot",
      cursor: 0,
    },
  );
  assertEquals(
    patches[0].channels?.telegram?.allowedIds,
    ["8689778203"],
  );
  assertEquals(patches[0].channels?.discord?.enabled, false);
  assertEquals(result?.session.state, "completed");
  assertEquals(result?.session.botUsername, "hlvm_real_bot");
  assertEquals(result?.status?.state, "connected");
});

Deno.test("telegram provisioning: completeSession keeps session pending when runtime reports error", async () => {
  const service = createTelegramProvisioningService({
    provisioningBridgeBaseUrl: "",
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
    randomId: () => "abc123def456",
    randomCode: () => "1234",
    armPairCode: () => {},
    disarmPairCode: () => {},
    loadConfig: async () => withTelegramDeviceId(),
    patchConfig: async () => DEFAULT_CONFIG,
    reconfigure: async () => {},
    getStatus: () => ({
      channel: "telegram",
      configured: true,
      enabled: true,
      state: "error",
      mode: "direct",
      allowedIds: [],
      lastError: "invalid token",
    }),
  });

  const session = await service.createSession();
  const result = await service.completeSession({
    sessionId: session.sessionId,
    token: "123:bad",
  });

  assertEquals(result?.session.state, "pending");
  assertEquals(result?.status?.lastError, "invalid token");
});

Deno.test("telegram provisioning: completeSession replaces stale telegram allowedIds with the new owner", async () => {
  const patches: Array<Partial<HlvmConfig>> = [];
  const service = createTelegramProvisioningService({
    provisioningBridgeBaseUrl: "",
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
    randomId: () => "abc123def456",
    randomCode: () => "1234",
    armPairCode: () => {},
    disarmPairCode: () => {},
    loadConfig: async () => ({
      ...withTelegramDeviceId(),
      channels: {
        telegram: {
          enabled: true,
          allowedIds: ["existing-user"],
          transport: { mode: "direct", deviceId: "device-1" },
        },
      },
    }),
    patchConfig: async (updates) => {
      patches.push(updates);
      return { ...withTelegramDeviceId(), ...updates } as HlvmConfig;
    },
    reconfigure: async () => {},
    getStatus: () => ({
      channel: "telegram",
      configured: true,
      enabled: true,
      state: "connected",
      mode: "direct",
      allowedIds: ["existing-user"],
      lastError: null,
    }),
  });

  const session = await service.createSession({
    managerBotUsername: "hlvm_manager_bot",
    botUsername: "hlvm_new_bot",
  });
  await service.completeSession({
    sessionId: session.sessionId,
    token: "123:abc",
    username: "hlvm_new_bot",
    ownerUserId: 999,
  });

  assertEquals(patches[0].channels?.telegram?.allowedIds, ["999"]);
  assertEquals(patches[0].channels?.telegram?.transport?.ownerUserId, 999);
});

Deno.test("telegram provisioning: completeSession is idempotent after the first successful completion", async () => {
  const patches: Array<Partial<HlvmConfig>> = [];
  let reconfigureCalls = 0;

  const service = createTelegramProvisioningService({
    provisioningBridgeBaseUrl: "",
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
    randomId: () => "abc123def456",
    randomCode: () => "1234",
    armPairCode: () => {},
    disarmPairCode: () => {},
    loadConfig: async () => withTelegramDeviceId(),
    patchConfig: async (updates) => {
      patches.push(updates);
      return { ...withTelegramDeviceId(), ...updates } as HlvmConfig;
    },
    reconfigure: async () => {
      reconfigureCalls++;
    },
    getStatus: () => ({
      channel: "telegram",
      configured: true,
      enabled: true,
      state: "connected",
      mode: "direct",
      allowedIds: [],
      lastError: null,
    }),
  });

  const session = await service.createSession();
  const first = await service.completeSession({
    sessionId: session.sessionId,
    token: "123:abc",
    username: "hlvm_real_bot",
  });
  const second = await service.completeSession({
    sessionId: session.sessionId,
    token: "999:overwrite",
    username: "hlvm_other_bot",
  });

  assertEquals(reconfigureCalls, 1);
  assertEquals(patches.length, 1);
  assertEquals(first?.session.botUsername, "hlvm_real_bot");
  assertEquals(second?.session.botUsername, "hlvm_real_bot");
  assertEquals(second?.session.state, "completed");
});

Deno.test("telegram provisioning: createSession registers with bridge and auto-completes when claim resolves", async () => {
  const registrations: Array<{ sessionId: string; claimToken: string }> = [];
  const statusEvents: string[] = [];
  const service = createTelegramProvisioningService({
    provisioningBridgeBaseUrl: "https://provision.hlvm.dev",
    loadConfig: async () => withTelegramDeviceId(),
    randomId: (() => {
      const values = ["abc123def456", "claim789ghi012"];
      return () => values.shift() ?? "fallback";
    })(),
    randomCode: () => "1234",
    armPairCode: () => {},
    disarmPairCode: () => {},
    reportStatus: (_channel, status) => {
      statusEvents.push(status.state);
    },
    bridgeClient: {
      async registerSession(input) {
        registrations.push({
          sessionId: input.sessionId,
          claimToken: input.claimToken,
        });
        return {
          sessionId: input.sessionId,
          state: "pending",
          managerBotUsername: input.managerBotUsername,
          botName: input.botName,
          botUsername: input.botUsername,
          createUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_abc123_bot?name=HLVM",
          createdAt: input.createdAt ?? "2026-04-21T00:00:00.000Z",
          expiresAt: input.expiresAt,
        };
      },
      async claimSession() {
        return {
          ok: true as const,
          session: {
            sessionId: "abc123def456",
            state: "claimed" as const,
            managerBotUsername: "hlvm_manager_bot",
            botName: "HLVM",
            botUsername: "hlvm_abc123_bot",
            createUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_abc123_bot?name=HLVM",
            createdAt: "2026-04-21T00:00:00.000Z",
            expiresAt: "2026-04-21T00:10:00.000Z",
            completedAt: "2026-04-21T00:00:01.000Z",
          },
          token: "123:abc",
          username: "hlvm_real_bot",
        };
      },
    },
    patchConfig: async (updates) => ({ ...withTelegramDeviceId(), ...updates }) as HlvmConfig,
    reconfigure: async () => {},
    getStatus: () => ({
      channel: "telegram",
      configured: true,
      enabled: true,
      state: "connected",
      mode: "direct",
      allowedIds: [],
      lastError: null,
    }),
  });

  const session = await service.createSession();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const completed = service.getSession();

  assertEquals(session.provisionUrl, "https://provision.hlvm.dev/telegram/start?session=abc123def456");
  assertEquals(registrations.length, 1);
  assertEquals(registrations[0]?.claimToken, "claim789ghi012");
  assertEquals(statusEvents[0], "connecting");
  assertEquals(completed?.state, "completed");
  assertEquals(completed?.botUsername, "hlvm_real_bot");
});

Deno.test("telegram provisioning: bridge claim retries pending slices until completion", async () => {
  const waitMsCalls: number[] = [];
  let claimCalls = 0;
  const service = createTelegramProvisioningService({
    provisioningBridgeBaseUrl: "https://provision.hlvm.dev",
    loadConfig: async () => withTelegramDeviceId(),
    randomId: (() => {
      const values = ["abc123def456", "claim789ghi012"];
      return () => values.shift() ?? "fallback";
    })(),
    randomCode: () => "1234",
    armPairCode: () => {},
    disarmPairCode: () => {},
    bridgeClient: {
      async registerSession(input) {
        return {
          sessionId: input.sessionId,
          state: "pending",
          managerBotUsername: input.managerBotUsername,
          botName: input.botName,
          botUsername: input.botUsername,
          createUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_abc123_bot?name=HLVM",
          createdAt: input.createdAt ?? "2026-04-21T00:00:00.000Z",
          expiresAt: input.expiresAt,
        };
      },
      async claimSession(input) {
        waitMsCalls.push(input.waitMs ?? 0);
        claimCalls++;
        if (claimCalls < 3) {
          return { ok: false as const, reason: "pending" as const };
        }
        return {
          ok: true as const,
          session: {
            sessionId: "abc123def456",
            state: "claimed" as const,
            managerBotUsername: "hlvm_manager_bot",
            botName: "HLVM",
            botUsername: "hlvm_abc123_bot",
            createUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_abc123_bot?name=HLVM",
            createdAt: "2026-04-21T00:00:00.000Z",
            expiresAt: "2026-04-21T00:10:00.000Z",
            completedAt: "2026-04-21T00:00:01.000Z",
          },
          token: "123:abc",
          username: "hlvm_real_bot",
        };
      },
    },
    patchConfig: async (updates) => ({ ...withTelegramDeviceId(), ...updates }) as HlvmConfig,
    reconfigure: async () => {},
    getStatus: () => ({
      channel: "telegram",
      configured: true,
      enabled: true,
      state: "connected",
      mode: "direct",
      allowedIds: [],
      lastError: null,
    }),
  });

  await service.createSession();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const completed = service.getSession();
  assertEquals(claimCalls, 3);
  assertEquals(waitMsCalls, [1_000, 1_000, 1_000]);
  assertEquals(completed?.state, "completed");
  assertEquals(completed?.botUsername, "hlvm_real_bot");
});

Deno.test("telegram provisioning: bridge auto-complete seeds telegram allowedIds from owner user id", async () => {
  const patches: Array<Partial<HlvmConfig>> = [];
  const service = createTelegramProvisioningService({
    provisioningBridgeBaseUrl: "https://provision.hlvm.dev",
    loadConfig: async () => withTelegramDeviceId(),
    randomId: (() => {
      const values = ["abc123def456", "claim789ghi012"];
      return () => values.shift() ?? "fallback";
    })(),
    randomCode: () => "1234",
    armPairCode: () => {},
    disarmPairCode: () => {},
    bridgeClient: {
      async registerSession(input) {
        return {
          sessionId: input.sessionId,
          state: "pending",
          managerBotUsername: input.managerBotUsername,
          botName: input.botName,
          botUsername: input.botUsername,
          createUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_abc123_bot?name=HLVM",
          createdAt: input.createdAt ?? "2026-04-21T00:00:00.000Z",
          expiresAt: input.expiresAt,
        };
      },
      async claimSession() {
        return {
          ok: true as const,
          session: {
            sessionId: "abc123def456",
            state: "claimed" as const,
            managerBotUsername: "hlvm_manager_bot",
            botName: "HLVM",
            botUsername: "hlvm_abc123_bot",
            createUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_abc123_bot?name=HLVM",
            createdAt: "2026-04-21T00:00:00.000Z",
            expiresAt: "2026-04-21T00:10:00.000Z",
            completedAt: "2026-04-21T00:00:01.000Z",
          },
          token: "123:abc",
          username: "hlvm_real_bot",
          ownerUserId: 8689778203,
        };
      },
    },
    patchConfig: async (updates) => {
      patches.push(updates);
      return { ...withTelegramDeviceId(), ...updates } as HlvmConfig;
    },
    reconfigure: async () => {},
    getStatus: () => ({
      channel: "telegram",
      configured: true,
      enabled: true,
      state: "connected",
      mode: "direct",
      allowedIds: [],
      lastError: null,
    }),
  });

  await service.createSession();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(patches.length, 1);
  assertEquals(patches[0].channels?.telegram?.allowedIds, ["8689778203"]);
});

Deno.test("telegram provisioning: createSession fails closed when bridge registration fails", async () => {
  const statusEvents: string[] = [];
  let disarmCalls = 0;
  const service = createTelegramProvisioningService({
    provisioningBridgeBaseUrl: "https://provision.hlvm.dev",
    loadConfig: async () => withTelegramDeviceId(),
    randomId: (() => {
      const values = ["abc123def456", "claim789ghi012"];
      return () => values.shift() ?? "fallback";
    })(),
    randomCode: () => "1234",
    armPairCode: () => {},
    disarmPairCode: () => {
      disarmCalls++;
    },
    reportStatus: (_channel, status) => {
      statusEvents.push(status.state);
    },
    bridgeClient: {
      async registerSession() {
        throw new Error("bridge offline");
      },
      async claimSession() {
        return { ok: false as const, reason: "pending" as const };
      },
    },
  });

  await assertRejects(
    () => service.createSession(),
    Error,
    "bridge offline",
  );
  assertEquals(statusEvents, ["connecting", "error"]);
  assertEquals(disarmCalls, 1);
  assertEquals(service.getSession(), null);
});

Deno.test("telegram provisioning: auto-claim fails closed when local telegram rebind reports error", async () => {
  const statusEvents: string[] = [];
  let disarmCalls = 0;
  const service = createTelegramProvisioningService({
    provisioningBridgeBaseUrl: "https://provision.hlvm.dev",
    loadConfig: async () => withTelegramDeviceId(),
    randomId: (() => {
      const values = ["abc123def456", "claim789ghi012"];
      return () => values.shift() ?? "fallback";
    })(),
    randomCode: () => "1234",
    armPairCode: () => {},
    disarmPairCode: () => {
      disarmCalls++;
    },
    reportStatus: (_channel, status) => {
      statusEvents.push(status.state);
    },
    bridgeClient: {
      async registerSession(input) {
        return {
          sessionId: input.sessionId,
          state: "pending",
          managerBotUsername: input.managerBotUsername,
          botName: input.botName,
          botUsername: input.botUsername,
          createUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_abc123_bot?name=HLVM",
          createdAt: input.createdAt ?? "2026-04-21T00:00:00.000Z",
          expiresAt: input.expiresAt,
        };
      },
      async claimSession() {
        return {
          ok: true as const,
          session: {
            sessionId: "abc123def456",
            state: "claimed" as const,
            managerBotUsername: "hlvm_manager_bot",
            botName: "HLVM",
            botUsername: "hlvm_abc123_bot",
            createUrl: "https://t.me/newbot/hlvm_manager_bot/hlvm_abc123_bot?name=HLVM",
            createdAt: "2026-04-21T00:00:00.000Z",
            expiresAt: "2026-04-21T00:10:00.000Z",
            completedAt: "2026-04-21T00:00:01.000Z",
          },
          token: "123:bad",
          username: "hlvm_bad_bot",
        };
      },
    },
    patchConfig: async (updates) => ({ ...withTelegramDeviceId(), ...updates }) as HlvmConfig,
    reconfigure: async () => {},
    getStatus: () => ({
      channel: "telegram",
      configured: true,
      enabled: true,
      state: "error",
      mode: "direct",
      allowedIds: [],
      lastError: "invalid token",
    }),
  });

  await service.createSession();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(statusEvents, ["connecting", "error"]);
  assertEquals(disarmCalls, 1);
  assertEquals(service.getSession(), null);
});
