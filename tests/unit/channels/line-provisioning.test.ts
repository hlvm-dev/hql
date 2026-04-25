import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  DEFAULT_CONFIG,
  type HlvmConfig,
} from "../../../src/common/config/types.ts";
import { flushChannelDiagnostics } from "../../../src/hlvm/channels/core/trace.ts";
import { createLineProvisioningService } from "../../../src/hlvm/channels/line/provisioning.ts";
import type { LineProvisioningBridgeClient } from "../../../src/hlvm/channels/line/provisioning-bridge-client.ts";
import type { LineProvisioningBridgeRegistration } from "../../../src/hlvm/channels/line/provisioning-bridge-protocol.ts";

function configWithLineTransport(
  deviceId = "existing-device",
  clientToken = "existing-client",
): HlvmConfig {
  return {
    ...DEFAULT_CONFIG,
    channels: {
      line: {
        enabled: true,
        allowedIds: [],
        transport: {
          mode: "relay",
          bridgeUrl: "https://line-bridge.hlvm.dev",
          deviceId,
          clientToken,
        },
      },
    },
  };
}

function createBridgeClient(
  registrations: LineProvisioningBridgeRegistration[],
): LineProvisioningBridgeClient {
  return {
    async registerSession(input) {
      registrations.push(input);
      return {
        sessionId: input.sessionId,
        state: "pending",
        pairCode: input.pairCode,
        officialAccountId: input.officialAccountId ?? "@hlvm",
        setupUrl: `https://line.me/R/oaMessage/${
          encodeURIComponent(input.officialAccountId ?? "@hlvm")
        }/?HLVM-${input.pairCode}`,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      };
    },
    async streamEvents() {
      throw new Error("not used");
    },
    async sendMessage() {
      throw new Error("not used");
    },
  };
}

Deno.test("line provisioning: createSession registers bridge session, writes relay config, and arms pair code", async () => {
  const registrations: LineProvisioningBridgeRegistration[] = [];
  const patches: Partial<HlvmConfig>[] = [];
  const armed: Array<{ channel: string; code: string }> = [];
  const statuses: Array<{ channel: string; state: string }> = [];
  let reconfigureCount = 0;

  const randomValues = ["deviceabc", "clientabc", "sessionabc"];
  const service = createLineProvisioningService({
    provisioningBridgeBaseUrl: "https://line-bridge.hlvm.dev",
    officialAccountId: "@hlvm",
    now: () => Date.parse("2026-04-25T00:00:00.000Z"),
    randomId: () => randomValues.shift() ?? "fallback",
    randomCode: () => "1234",
    loadConfig: async () => DEFAULT_CONFIG,
    patchConfig: async (updates) => {
      patches.push(updates);
      return DEFAULT_CONFIG;
    },
    reconfigure: async () => {
      reconfigureCount += 1;
    },
    getStatus: () => null,
    reportStatus: (channel, status) => {
      statuses.push({ channel, state: status.state });
    },
    armPairCode: (channel, code) => {
      armed.push({ channel, code });
    },
    disarmPairCode: () => {},
    bridgeClient: createBridgeClient(registrations),
  });

  const session = await service.createSession();

  assertEquals(session, {
    channel: "line",
    sessionId: "sessionabc",
    state: "pending",
    setupUrl: "https://line.me/R/oaMessage/%40hlvm/?HLVM-1234",
    pairCode: "1234",
    qrKind: "connect_account",
    officialAccountId: "@hlvm",
    createdAt: "2026-04-25T00:00:00.000Z",
    expiresAt: "2026-04-25T00:10:00.000Z",
  });
  assertEquals(registrations[0], {
    sessionId: "sessionabc",
    deviceId: "deviceabc",
    clientToken: "clientabc",
    pairCode: "1234",
    officialAccountId: "@hlvm",
    createdAt: "2026-04-25T00:00:00.000Z",
    expiresAt: "2026-04-25T00:10:00.000Z",
  });
  assertEquals(patches[0].channels?.line, {
    enabled: true,
    allowedIds: [],
    transport: {
      mode: "relay",
      bridgeUrl: "https://line-bridge.hlvm.dev",
      deviceId: "deviceabc",
      clientToken: "clientabc",
    },
  });
  assertEquals(armed, [{ channel: "line", code: "1234" }]);
  assertEquals(statuses, [{ channel: "line", state: "connecting" }]);
  assertEquals(reconfigureCount, 1);
  await flushChannelDiagnostics();
});

Deno.test("line provisioning: createSession reuses existing device credentials and active pending session", async () => {
  const registrations: LineProvisioningBridgeRegistration[] = [];
  const service = createLineProvisioningService({
    provisioningBridgeBaseUrl: "https://line-bridge.hlvm.dev",
    officialAccountId: "@hlvm",
    now: () => Date.parse("2026-04-25T00:00:00.000Z"),
    randomId: () => "sessionabc",
    randomCode: () => "1234",
    loadConfig: async () => configWithLineTransport(),
    patchConfig: async () => DEFAULT_CONFIG,
    reconfigure: async () => {},
    getStatus: () => null,
    armPairCode: () => {},
    disarmPairCode: () => {},
    bridgeClient: createBridgeClient(registrations),
  });

  const first = await service.createSession();
  const second = await service.createSession();

  assertEquals(second, first);
  assertEquals(registrations.length, 1);
  assertEquals(registrations[0].deviceId, "existing-device");
  assertEquals(registrations[0].clientToken, "existing-client");
  await flushChannelDiagnostics();
});

Deno.test("line provisioning: complete exposes channel status and cancel completed session without disarm", async () => {
  const registrations: LineProvisioningBridgeRegistration[] = [];
  const disarmed: string[] = [];
  const service = createLineProvisioningService({
    provisioningBridgeBaseUrl: "https://line-bridge.hlvm.dev",
    officialAccountId: "@hlvm",
    now: () => Date.parse("2026-04-25T00:00:00.000Z"),
    randomId: (() => {
      const values = ["deviceabc", "clientabc", "sessionabc"];
      return () => values.shift() ?? "fallback";
    })(),
    randomCode: () => "1234",
    loadConfig: async () => DEFAULT_CONFIG,
    patchConfig: async () => DEFAULT_CONFIG,
    reconfigure: async () => {},
    getStatus: () => ({
      channel: "line",
      configured: true,
      enabled: true,
      state: "connected",
      mode: "relay",
      allowedIds: ["line-user-1"],
      lastError: null,
    }),
    armPairCode: () => {},
    disarmPairCode: (channel) => {
      disarmed.push(channel);
    },
    bridgeClient: createBridgeClient(registrations),
  });

  const session = await service.createSession();
  const completed = await service.completeSession({
    sessionId: session.sessionId,
  });

  assertEquals(completed?.session.state, "completed");
  assertEquals(completed?.status?.state, "connected");
  assertEquals(service.cancelSession(), true);
  assertEquals(disarmed, []);
  await flushChannelDiagnostics();
});

Deno.test("line provisioning: cancel disarms pending session", async () => {
  const registrations: LineProvisioningBridgeRegistration[] = [];
  const disarmed: string[] = [];
  const service = createLineProvisioningService({
    provisioningBridgeBaseUrl: "https://line-bridge.hlvm.dev",
    officialAccountId: "@hlvm",
    now: () => Date.parse("2026-04-25T00:00:00.000Z"),
    randomId: (() => {
      const values = ["deviceabc", "clientabc", "sessionabc"];
      return () => values.shift() ?? "fallback";
    })(),
    randomCode: () => "1234",
    loadConfig: async () => DEFAULT_CONFIG,
    patchConfig: async () => DEFAULT_CONFIG,
    reconfigure: async () => {},
    getStatus: () => null,
    armPairCode: () => {},
    disarmPairCode: (channel) => {
      disarmed.push(channel);
    },
    bridgeClient: createBridgeClient(registrations),
  });

  await service.createSession();

  assertEquals(service.cancelSession(), true);
  assertEquals(service.getSession(), null);
  assertEquals(disarmed, ["line"]);
  await flushChannelDiagnostics();
});

Deno.test("line provisioning: createSession fails closed when bridge URL is missing", async () => {
  const service = createLineProvisioningService({
    provisioningBridgeBaseUrl: "",
    loadConfig: async () => DEFAULT_CONFIG,
    randomId: () => "sessionabc",
    randomCode: () => "1234",
  });

  await assertRejects(
    () => service.createSession(),
    Error,
    "HLVM_LINE_PROVISIONING_BRIDGE_URL",
  );
  await flushChannelDiagnostics();
});
