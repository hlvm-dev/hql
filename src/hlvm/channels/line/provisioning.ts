import type { HlvmConfig } from "../../../common/config/types.ts";
import { ValidationError } from "../../../common/error.ts";
import { config } from "../../api/config.ts";
import { channelRuntime } from "../registry.ts";
import { traceChannelDiagnostic } from "../core/trace.ts";
import type { ChannelProvisioner, ChannelStatus } from "../core/types.ts";
import {
  resolveLineOfficialAccountId,
  resolveLineProvisioningBridgeBaseUrl,
  resolveLineProvisioningSessionTtlMs,
} from "./config.ts";
import {
  createLineProvisioningBridgeClient,
  type LineProvisioningBridgeClient,
} from "./provisioning-bridge-client.ts";
import type {
  LineProvisioningCompleteRequest,
  LineProvisioningCompletionResult,
  LineProvisioningCreateRequest,
  LineSetupSession,
} from "./protocol.ts";

interface LineProvisioningSessionInternal {
  sessionId: string;
  deviceId: string;
  clientToken: string;
  pairCode: string;
  officialAccountId: string;
  setupUrl: string;
  state: "pending" | "completed";
  createdAtMs: number;
  expiresAtMs: number;
  completedAtMs?: number;
}

interface LineProvisioningDependencies {
  loadConfig?: () => Promise<HlvmConfig>;
  patchConfig?: (updates: Partial<HlvmConfig>) => Promise<HlvmConfig>;
  reconfigure?: () => Promise<void>;
  getStatus?: (channel: string) => ReturnType<typeof channelRuntime.getStatus>;
  reportStatus?: (
    channel: string,
    status: Partial<ChannelStatus> & Pick<ChannelStatus, "state">,
  ) => void;
  armPairCode?: (channel: string, code: string) => void;
  disarmPairCode?: (channel: string) => void;
  bridgeClient?: LineProvisioningBridgeClient;
  provisioningBridgeBaseUrl?: string;
  officialAccountId?: string;
  sessionTtlMs?: number;
  now?: () => number;
  randomId?: () => string;
  randomCode?: () => string;
}

export type LineProvisioningService = ChannelProvisioner<
  LineProvisioningCreateRequest,
  LineSetupSession,
  LineProvisioningCompleteRequest,
  LineProvisioningCompletionResult
>;

function traceLineProvisioning(
  event: string,
  data: Record<string, unknown>,
): void {
  traceChannelDiagnostic("line", "provisioning", event, data);
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toSetupSession(
  session: LineProvisioningSessionInternal,
): LineSetupSession {
  return {
    channel: "line",
    sessionId: session.sessionId,
    state: session.state,
    setupUrl: session.setupUrl,
    pairCode: session.pairCode,
    qrKind: "connect_account",
    officialAccountId: session.officialAccountId,
    createdAt: new Date(session.createdAtMs).toISOString(),
    expiresAt: new Date(session.expiresAtMs).toISOString(),
    ...(session.completedAtMs !== undefined
      ? { completedAt: new Date(session.completedAtMs).toISOString() }
      : {}),
  };
}

function readExistingLineTransport(config: HlvmConfig): {
  deviceId?: string;
  clientToken?: string;
} {
  const transport = config.channels?.line?.transport;
  const deviceId = trimString(transport?.deviceId);
  const clientToken = trimString(transport?.clientToken);
  return {
    ...(deviceId ? { deviceId } : {}),
    ...(clientToken ? { clientToken } : {}),
  };
}

export function createLineProvisioningService(
  dependencies: LineProvisioningDependencies = {},
): LineProvisioningService {
  const loadCurrentConfig = dependencies.loadConfig ??
    (async () => await config.all);
  const patchConfig = dependencies.patchConfig ?? config.patch;
  const reconfigure = dependencies.reconfigure ??
    (() => channelRuntime.reconfigure());
  const getStatus = dependencies.getStatus ??
    ((channel) => channelRuntime.getStatus(channel));
  const reportStatus = dependencies.reportStatus ??
    ((channel, status) => channelRuntime.reportStatus(channel, status));
  const armPairCode = dependencies.armPairCode ??
    ((channel, code) => channelRuntime.armPairCode(channel, code));
  const disarmPairCode = dependencies.disarmPairCode ??
    ((channel) => channelRuntime.disarmPairCode(channel));
  const bridgeBaseUrl = resolveLineProvisioningBridgeBaseUrl(
    dependencies.provisioningBridgeBaseUrl,
  );
  const bridgeClient = dependencies.bridgeClient ??
    (bridgeBaseUrl
      ? createLineProvisioningBridgeClient(bridgeBaseUrl)
      : undefined);
  const configuredOfficialAccountId = resolveLineOfficialAccountId(
    dependencies.officialAccountId,
  );
  const sessionTtlMs = resolveLineProvisioningSessionTtlMs(
    dependencies.sessionTtlMs,
  );
  const now = dependencies.now ?? Date.now;
  const randomId = dependencies.randomId ?? (() => crypto.randomUUID());
  const randomCode = dependencies.randomCode ??
    (() => String(Math.floor(1000 + Math.random() * 9000)));

  let activeSession: LineProvisioningSessionInternal | null = null;

  function clearExpiredSession(): void {
    if (!activeSession) return;
    if (activeSession.expiresAtMs > now()) return;
    if (activeSession.state === "pending") {
      disarmPairCode("line");
      traceLineProvisioning("session-expired", {
        sessionId: activeSession.sessionId,
        deviceId: activeSession.deviceId,
      });
    }
    activeSession = null;
  }

  const service: LineProvisioningService = {
    channel: "line",

    async createSession(input = {}): Promise<LineSetupSession> {
      clearExpiredSession();
      if (activeSession?.state === "pending") {
        traceLineProvisioning("create-session-reuse", {
          sessionId: activeSession.sessionId,
          deviceId: activeSession.deviceId,
        });
        return toSetupSession(activeSession);
      }
      if (!bridgeBaseUrl || !bridgeClient) {
        traceLineProvisioning("create-session-missing-bridge", {});
        throw new ValidationError(
          "LINE onboarding requires HLVM_LINE_PROVISIONING_BRIDGE_URL.",
          "line_provisioning",
        );
      }

      const existing = readExistingLineTransport(await loadCurrentConfig());
      const deviceId = existing.deviceId ?? randomId().replace(/-/g, "");
      const clientToken = existing.clientToken ?? randomId().replace(/-/g, "");
      const sessionId = randomId().replace(/-/g, "");
      const pairCode = randomCode();
      const officialAccountId = trimString(input.officialAccountId) ||
        configuredOfficialAccountId ||
        "";
      const createdAtMs = now();
      const expiresAtMs = createdAtMs + sessionTtlMs;

      traceLineProvisioning("create-session-start", {
        sessionId,
        deviceId,
        hasExistingDevice: !!existing.deviceId,
        officialAccountIdConfigured: !!officialAccountId,
      });
      const registered = await bridgeClient.registerSession({
        sessionId,
        deviceId,
        clientToken,
        pairCode,
        ...(officialAccountId ? { officialAccountId } : {}),
        createdAt: new Date(createdAtMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
      });
      traceLineProvisioning("bridge-session-registered", {
        sessionId,
        deviceId,
        officialAccountId: registered.officialAccountId,
      });

      await patchConfig({
        channels: {
          line: {
            enabled: true,
            allowedIds: [],
            transport: {
              mode: "relay",
              bridgeUrl: bridgeBaseUrl,
              deviceId,
              clientToken,
            },
          },
        },
      });
      traceLineProvisioning("config-written", { sessionId, deviceId });

      activeSession = {
        sessionId,
        deviceId,
        clientToken,
        pairCode,
        officialAccountId: registered.officialAccountId,
        setupUrl: registered.setupUrl,
        state: "pending",
        createdAtMs,
        expiresAtMs,
      };
      armPairCode("line", pairCode);
      reportStatus("line", { state: "connecting", lastError: null });
      traceLineProvisioning("reconfigure-start", { sessionId, deviceId });
      await reconfigure();
      traceLineProvisioning("reconfigure-done", { sessionId, deviceId });

      traceLineProvisioning("create-session", {
        sessionId,
        deviceId,
        officialAccountId: registered.officialAccountId,
      });
      return toSetupSession(activeSession);
    },

    getSession(): LineSetupSession | null {
      clearExpiredSession();
      return activeSession ? toSetupSession(activeSession) : null;
    },

    cancelSession(): boolean {
      clearExpiredSession();
      if (!activeSession) return false;
      if (activeSession.state === "pending") {
        disarmPairCode("line");
      }
      traceLineProvisioning("cancel-session", {
        sessionId: activeSession.sessionId,
        deviceId: activeSession.deviceId,
        state: activeSession.state,
      });
      activeSession = null;
      return true;
    },

    async completeSession(
      input: LineProvisioningCompleteRequest,
    ): Promise<LineProvisioningCompletionResult | null> {
      clearExpiredSession();
      if (!activeSession || activeSession.sessionId !== input.sessionId) {
        return null;
      }
      activeSession = {
        ...activeSession,
        state: "completed",
        completedAtMs: now(),
      };
      const status = getStatus("line");
      traceLineProvisioning("complete-session", {
        sessionId: activeSession.sessionId,
        deviceId: activeSession.deviceId,
        statusState: status?.state,
      });
      return {
        session: toSetupSession(activeSession),
        ...(status ? { status } : {}),
      };
    },
  };

  return service;
}

export const lineProvisioning = createLineProvisioningService();
