import type { HlvmConfig } from "../../../common/config/types.ts";
import { ValidationError } from "../../../common/error.ts";
import { config } from "../../api/config.ts";
import { channelRuntime } from "../registry.ts";
import { log } from "../../api/log.ts";
import { buildTelegramManagedBotCreateUrl } from "./provisioning-bridge.ts";
import {
  createTelegramProvisioningBridgeClient,
  type TelegramProvisioningBridgeClient,
} from "./provisioning-bridge-client.ts";
import type { ChannelProvisioner, ChannelStatus } from "../core/types.ts";
import {
  resolveTelegramManagerBotUsername,
  resolveTelegramProvisioningBridgeBaseUrl,
} from "./config.ts";
import { createTelegramBridgeClaimWaiter } from "./provisioning-claim.ts";
import { applyTelegramBotBranding } from "./branding.ts";
import type {
  TelegramProvisioningCompleteRequest,
  TelegramProvisioningCompletionResult,
  TelegramProvisioningCreateRequest,
  TelegramSetupSession,
} from "./protocol.ts";
import {
  buildCompletedTelegramConfigPatch,
  buildOpenTelegramBotSession,
  buildPendingTelegramCreateSession,
  readExistingTelegramState,
  sanitizeTelegramBotName,
  sanitizeTelegramBotUsername,
  shouldOpenExistingTelegramBot,
  type TelegramProvisioningSessionInternal,
  toTelegramSetupSession,
  trimTelegramTransportDeviceId,
} from "./provisioning-session.ts";

const BRIDGE_CLAIM_POLL_INTERVAL_MS = 1_000;

type CreateSessionInput = TelegramProvisioningCreateRequest;
type CompleteSessionInput = TelegramProvisioningCompleteRequest;

interface TelegramProvisioningDependencies {
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
  bridgeClient?: TelegramProvisioningBridgeClient;
  provisioningBridgeBaseUrl?: string;
  now?: () => number;
  randomId?: () => string;
  randomCode?: () => string;
  applyBranding?: (token: string) => Promise<void>;
}

export type TelegramProvisioningService = ChannelProvisioner<
  CreateSessionInput,
  TelegramSetupSession,
  CompleteSessionInput,
  TelegramProvisioningCompletionResult
>;

function logTelegramProvisioningTrace(event: string, data: unknown): void {
  log.ns("telegram").debug(`[provisioning] ${event} ${JSON.stringify(data)}`);
}

export function createTelegramProvisioningService(
  dependencies: TelegramProvisioningDependencies = {},
): TelegramProvisioningService {
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
  const provisioningBridgeBaseUrl = resolveTelegramProvisioningBridgeBaseUrl(
    dependencies.provisioningBridgeBaseUrl,
  );
  const now = dependencies.now ?? Date.now;
  const randomId = dependencies.randomId ?? (() => crypto.randomUUID());
  const randomCode = dependencies.randomCode ??
    (() => String(Math.floor(1000 + Math.random() * 9000)));
  const bridgeClient = dependencies.bridgeClient ??
    (provisioningBridgeBaseUrl
      ? createTelegramProvisioningBridgeClient(provisioningBridgeBaseUrl)
      : undefined);
  const applyBranding = dependencies.applyBranding ?? applyTelegramBotBranding;
  const bridgeEnabled = !!(provisioningBridgeBaseUrl && bridgeClient);

  let activeSession: TelegramProvisioningSessionInternal | null = null;
  let activeBridgeAbort: AbortController | null = null;

  function stopBridgeWait(): void {
    activeBridgeAbort?.abort();
    activeBridgeAbort = null;
  }

  function clearExpiredSession(): void {
    if (!activeSession) return;
    if (activeSession.expiresAtMs > now()) return;
    if (activeSession.state === "pending") {
      stopBridgeWait();
      disarmPairCode("telegram");
    }
    activeSession = null;
  }

  function isActivePendingSession(sessionId: string): boolean {
    return activeSession?.sessionId === sessionId &&
      activeSession.state === "pending";
  }

  function failActiveSession(sessionId: string, detail: string): void {
    if (!isActivePendingSession(sessionId)) return;
    logTelegramProvisioningTrace("fail-active-session", {
      sessionId,
      detail,
    });
    disarmPairCode("telegram");
    activeSession = null;
    reportStatus("telegram", { state: "error", lastError: detail });
  }
  const waitForBridgeClaim = bridgeClient
    ? createTelegramBridgeClaimWaiter({
      bridgeClient,
      now,
      pollIntervalMs: BRIDGE_CLAIM_POLL_INTERVAL_MS,
      trace: logTelegramProvisioningTrace,
      isActivePendingSession,
      failActiveSession,
      completeClaimedSession: async (input) =>
        await service.completeSession(input),
    })
    : null;

  const service: TelegramProvisioningService = {
    channel: "telegram",

    async createSession(input = {}): Promise<TelegramSetupSession> {
      clearExpiredSession();
      if (activeSession?.state === "pending") {
        const snapshot = toTelegramSetupSession(
          activeSession,
          provisioningBridgeBaseUrl,
        );
        logTelegramProvisioningTrace(
          "create-session-reuse-pending",
          snapshot,
        );
        return snapshot;
      }
      stopBridgeWait();

      const existing = readExistingTelegramState(await loadCurrentConfig());
      let deviceId = trimTelegramTransportDeviceId(existing.transport.deviceId);
      const knownOwnerUserId = existing.ownerUserId;
      if (!deviceId) {
        deviceId = randomId().replace(/-/g, "");
        await patchConfig({
          channels: {
            telegram: {
              transport: { deviceId },
            },
          },
        });
      }
      const openExistingBot = shouldOpenExistingTelegramBot(
        existing.transport,
        existing.username,
      );

      const rawId = randomId().replace(/-/g, "");
      const seed = rawId.slice(0, 6).toLowerCase();
      const sessionId = rawId;
      const pairCode = randomCode();
      const managerBotUsername = resolveTelegramManagerBotUsername(
        input.managerBotUsername,
      );
      const botName = sanitizeTelegramBotName(input.botName);
      const botUsername = sanitizeTelegramBotUsername(input.botUsername, seed);
      const createUrl = buildTelegramManagedBotCreateUrl(
        managerBotUsername,
        botUsername,
        botName,
      );

      const nowMs = now();

      if (openExistingBot) {
        activeSession = buildOpenTelegramBotSession({
          sessionId,
          deviceId,
          ownerUserId: knownOwnerUserId,
          managerBotUsername,
          botName,
          username: existing.username,
          nowMs,
        });
        const snapshot = toTelegramSetupSession(activeSession, undefined);
        logTelegramProvisioningTrace(
          "create-session-existing-bot",
          snapshot,
        );
        return snapshot;
      }

      activeSession = buildPendingTelegramCreateSession({
        sessionId,
        claimToken: bridgeEnabled ? randomId().replace(/-/g, "") : undefined,
        deviceId,
        pairCode,
        managerBotUsername,
        botName,
        botUsername,
        qrUrl: createUrl,
        nowMs,
      });
      armPairCode("telegram", pairCode);
      reportStatus("telegram", { state: "connecting", lastError: null });

      logTelegramProvisioningTrace("create-session-internal", {
        bridgeEnabled,
        provisioningBridgeBaseUrl: provisioningBridgeBaseUrl ?? null,
        sessionId: activeSession.sessionId,
        managerBotUsername: activeSession.managerBotUsername,
        botName: activeSession.botName,
        botUsername: activeSession.botUsername,
      });

      if (bridgeEnabled && bridgeClient && activeSession.claimToken) {
        try {
          logTelegramProvisioningTrace("bridge-register-start", {
            sessionId: activeSession.sessionId,
            managerBotUsername: activeSession.managerBotUsername,
            botUsername: activeSession.botUsername,
          });
          await bridgeClient.registerSession({
            sessionId: activeSession.sessionId,
            claimToken: activeSession.claimToken,
            ...(activeSession.deviceId
              ? { deviceId: activeSession.deviceId }
              : {}),
            ...(activeSession.ownerUserId !== undefined
              ? { ownerUserId: activeSession.ownerUserId }
              : {}),
            managerBotUsername: activeSession.managerBotUsername,
            botName: activeSession.botName,
            botUsername: activeSession.botUsername,
            createdAt: new Date(activeSession.createdAtMs).toISOString(),
            expiresAt: new Date(activeSession.expiresAtMs).toISOString(),
          });
          logTelegramProvisioningTrace("bridge-register-success", {
            sessionId: activeSession.sessionId,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          logTelegramProvisioningTrace("bridge-register-error", {
            sessionId: activeSession.sessionId,
            detail,
          });
          failActiveSession(activeSession.sessionId, detail);
          throw error;
        }
        if (waitForBridgeClaim) {
          stopBridgeWait();
          const controller = new AbortController();
          activeBridgeAbort = controller;
          const sessionForClaim = activeSession;
          void waitForBridgeClaim(sessionForClaim, controller.signal).finally(
            () => {
              if (activeBridgeAbort === controller) {
                activeBridgeAbort = null;
              }
            },
          );
        }
      }

      const snapshot = toTelegramSetupSession(
        activeSession,
        provisioningBridgeBaseUrl,
      );
      logTelegramProvisioningTrace(
        "create-session-snapshot",
        snapshot,
      );
      return snapshot;
    },

    getSession(): TelegramSetupSession | null {
      clearExpiredSession();
      return activeSession
        ? toTelegramSetupSession(activeSession, provisioningBridgeBaseUrl)
        : null;
    },

    cancelSession(): boolean {
      clearExpiredSession();
      if (!activeSession) return false;
      if (activeSession.state === "pending") {
        stopBridgeWait();
        disarmPairCode("telegram");
      }
      activeSession = null;
      return true;
    },

    async completeSession(
      input: CompleteSessionInput,
    ): Promise<TelegramProvisioningCompletionResult | null> {
      clearExpiredSession();
      logTelegramProvisioningTrace("complete-session-start", {
        sessionId: input.sessionId,
        username: input.username,
        tokenLength: input.token.trim().length,
        ownerUserId: Number.isInteger(input.ownerUserId)
          ? input.ownerUserId
          : null,
      });
      if (!activeSession || activeSession.sessionId !== input.sessionId) {
        logTelegramProvisioningTrace("complete-session-miss", {
          sessionId: input.sessionId,
          activeSessionId: activeSession?.sessionId ?? null,
        });
        return null;
      }
      if (activeSession.state !== "pending") {
        const status = getStatus("telegram");
        logTelegramProvisioningTrace("complete-session-noop", {
          sessionId: input.sessionId,
          activeState: activeSession.state,
          statusState: status?.state ?? null,
          statusError: status?.lastError ?? null,
        });
        return {
          session: toTelegramSetupSession(
            activeSession,
            provisioningBridgeBaseUrl,
          ),
          ...(status ? { status } : {}),
        };
      }
      stopBridgeWait();

      const token = input.token.trim();
      if (!token) {
        throw new ValidationError(
          "Telegram provisioning requires a non-empty token.",
          "telegram_provisioning",
        );
      }

      const username = sanitizeTelegramBotUsername(
        input.username,
        activeSession.sessionId.slice(0, 6),
      );
      const existing = readExistingTelegramState(await loadCurrentConfig());
      const nextConfigPatch = buildCompletedTelegramConfigPatch({
        state: existing,
        session: activeSession,
        token,
        username,
        ...(Number.isInteger(input.ownerUserId)
          ? { ownerUserId: input.ownerUserId }
          : {}),
      });

      await patchConfig(nextConfigPatch);
      logTelegramProvisioningTrace("complete-session-config-written", {
        sessionId: input.sessionId,
        username,
        allowedIds: nextConfigPatch.channels?.telegram?.allowedIds ?? [],
      });
      await reconfigure();
      logTelegramProvisioningTrace("complete-session-reconfigured", {
        sessionId: input.sessionId,
      });
      void applyBranding(token).then(
        () => {
          logTelegramProvisioningTrace("complete-session-branding-applied", {
            sessionId: input.sessionId,
            username,
          });
        },
        (error) => {
          const detail = error instanceof Error ? error.message : String(error);
          logTelegramProvisioningTrace("complete-session-branding-error", {
            sessionId: input.sessionId,
            username,
            detail,
          });
        },
      );

      activeSession = {
        ...activeSession,
        botUsername: username,
      };
      const status = getStatus("telegram");
      if (status && status.state !== "error") {
        activeSession = {
          ...activeSession,
          state: "completed",
          completedAtMs: now(),
        };
      }

      logTelegramProvisioningTrace("complete-session-result", {
        sessionId: input.sessionId,
        sessionState: activeSession.state,
        statusState: status?.state ?? null,
        statusError: status?.lastError ?? null,
      });

      return {
        session: toTelegramSetupSession(
          activeSession,
          provisioningBridgeBaseUrl,
        ),
        ...(status ? { status } : {}),
      };
    },
  };

  return service;
}

export const telegramProvisioning = createTelegramProvisioningService();
