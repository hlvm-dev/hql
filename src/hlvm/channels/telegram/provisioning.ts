import type { HlvmConfig } from "../../../common/config/types.ts";
import { ValidationError } from "../../../common/error.ts";
import { getDebugLogPath, getEnvVar } from "../../../common/paths.ts";
import { config } from "../../api/config.ts";
import { channelRuntime } from "../registry.ts";
import { getPlatform } from "../../../platform/platform.ts";
import type {
  RuntimeTelegramProvisioningCompleteRequest,
  RuntimeTelegramProvisioningCompletionResult,
  RuntimeTelegramProvisioningCreateRequest,
  RuntimeTelegramProvisioningSessionSnapshot,
} from "../../runtime/reachability-protocol.ts";
import {
  buildTelegramManagedBotCreateUrl,
  buildTelegramProvisioningBridgeUrl,
} from "./provisioning-bridge.ts";
import {
  createTelegramProvisioningBridgeClient,
  type TelegramProvisioningBridgeClient,
} from "./provisioning-bridge-client.ts";
import type { ChannelStatus } from "../core/types.ts";
import { logTelegramE2ETrace } from "./e2e-trace.ts";

export type {
  RuntimeTelegramProvisioningCompleteRequest,
  RuntimeTelegramProvisioningCompletionResult,
  RuntimeTelegramProvisioningCreateRequest,
  RuntimeTelegramProvisioningSessionSnapshot,
} from "../../runtime/reachability-protocol.ts";

const DEFAULT_MANAGER_BOT_USERNAME = "hlvm_manager_bot";
const DEFAULT_BOT_NAME = "HLVM";
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const BRIDGE_CLAIM_POLL_INTERVAL_MS = 1_000;

type ProvisioningState = "completed" | "pending";
type ProvisioningQrKind = "create_bot" | "open_bot";

interface TelegramProvisioningSessionInternal {
  sessionId: string;
  claimToken?: string;
  state: ProvisioningState;
  pairCode: string;
  managerBotUsername: string;
  botName: string;
  botUsername: string;
  qrKind: ProvisioningQrKind;
  qrUrl: string;
  createdAtMs: number;
  expiresAtMs: number;
  completedAtMs?: number;
}

type CreateSessionInput = RuntimeTelegramProvisioningCreateRequest;
type CompleteSessionInput = RuntimeTelegramProvisioningCompleteRequest;

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
  sleep?: (ms: number) => Promise<void>;
}

export interface TelegramProvisioningService {
  createSession(input?: CreateSessionInput): Promise<RuntimeTelegramProvisioningSessionSnapshot>;
  getSession(): RuntimeTelegramProvisioningSessionSnapshot | null;
  cancelSession(): boolean;
  completeSession(
    input: CompleteSessionInput,
  ): Promise<RuntimeTelegramProvisioningCompletionResult | null>;
}

function logTelegramProvisioningTrace(event: string, data: Record<string, unknown>): void {
  logTelegramE2ETrace("runtime", event, data);
  try {
    const line = `[${new Date().toISOString()}] [telegram-provisioning] ${event} ${
      JSON.stringify(data)
    }\n`;
    getPlatform().fs.writeTextFileSync(getDebugLogPath(), line, { append: true });
  } catch {
    // Ignore debug logging failures.
  }
}

function sanitizeManagerBotUsername(value: string | undefined): string {
  const configured = getEnvVar("HLVM_TELEGRAM_MANAGER_BOT_USERNAME")?.trim().replace(/^@+/, "");
  const trimmed = value?.trim().replace(/^@+/, "") || configured || DEFAULT_MANAGER_BOT_USERNAME;
  logTelegramProvisioningTrace("sanitize-manager-bot-username", {
    input: value ?? null,
    env: configured ?? null,
    resolved: trimmed || DEFAULT_MANAGER_BOT_USERNAME,
  });
  return trimmed || DEFAULT_MANAGER_BOT_USERNAME;
}

function sanitizeBotName(value: string | undefined): string {
  return value?.trim() || DEFAULT_BOT_NAME;
}

function defaultBotUsername(seed: string): string {
  return `hlvm_${seed}_bot`;
}

function buildTelegramBotChatUrl(username: string): string {
  return `tg://resolve?domain=${username.replace(/^@+/, "")}`;
}

function sanitizeBotUsername(value: string | undefined, seed: string): string {
  const trimmed = value?.trim().replace(/^@+/, "") || "";
  if (/^[A-Za-z][A-Za-z0-9_]{4,31}bot$/i.test(trimmed)) {
    return trimmed;
  }
  return defaultBotUsername(seed);
}

function toSnapshot(
  session: TelegramProvisioningSessionInternal,
  provisioningBridgeBaseUrl: string | undefined,
): RuntimeTelegramProvisioningSessionSnapshot {
  const provisionUrl = provisioningBridgeBaseUrl
    ? buildTelegramProvisioningBridgeUrl(provisioningBridgeBaseUrl, session.sessionId)
    : undefined;
  return {
    sessionId: session.sessionId,
    state: session.state,
    pairCode: session.pairCode,
    managerBotUsername: session.managerBotUsername,
    botName: session.botName,
    botUsername: session.botUsername,
    qrKind: session.qrKind,
    qrUrl: session.qrUrl,
    ...(provisionUrl ? { provisionUrl } : {}),
    createUrl: session.qrUrl,
    createdAt: new Date(session.createdAtMs).toISOString(),
    expiresAt: new Date(session.expiresAtMs).toISOString(),
    ...(session.completedAtMs
      ? { completedAt: new Date(session.completedAtMs).toISOString() }
      : {}),
  };
}

export function createTelegramProvisioningService(
  dependencies: TelegramProvisioningDependencies = {},
): TelegramProvisioningService {
  const loadCurrentConfig = dependencies.loadConfig ?? (async () => await config.all);
  const patchConfig = dependencies.patchConfig ?? config.patch;
  const reconfigure = dependencies.reconfigure ?? (() => channelRuntime.reconfigure());
  const getStatus = dependencies.getStatus ?? ((channel) => channelRuntime.getStatus(channel));
  const reportStatus = dependencies.reportStatus ??
    ((channel, status) => channelRuntime.reportStatus(channel, status));
  const armPairCode = dependencies.armPairCode ??
    ((channel, code) => channelRuntime.armPairCode(channel, code));
  const disarmPairCode = dependencies.disarmPairCode ??
    ((channel) => channelRuntime.disarmPairCode(channel));
  const provisioningBridgeBaseUrl = dependencies.provisioningBridgeBaseUrl?.trim() ||
    getEnvVar("HLVM_TELEGRAM_PROVISIONING_BRIDGE_URL")?.trim() ||
    undefined;
  const now = dependencies.now ?? Date.now;
  const randomId = dependencies.randomId ?? (() => crypto.randomUUID());
  const randomCode = dependencies.randomCode ??
    (() => String(Math.floor(1000 + Math.random() * 9000)));
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));
  const bridgeClient = dependencies.bridgeClient ??
    (provisioningBridgeBaseUrl
      ? createTelegramProvisioningBridgeClient(provisioningBridgeBaseUrl)
      : undefined);
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
    return activeSession?.sessionId === sessionId && activeSession.state === "pending";
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

  async function startBridgeClaimWait(session: TelegramProvisioningSessionInternal): Promise<void> {
    if (!bridgeClient || !session.claimToken) return;
    stopBridgeWait();
    const controller = new AbortController();
    activeBridgeAbort = controller;
    try {
      logTelegramProvisioningTrace("bridge-claim-start", {
        sessionId: session.sessionId,
        totalWaitMs: Math.max(0, session.expiresAtMs - now()),
        pollIntervalMs: BRIDGE_CLAIM_POLL_INTERVAL_MS,
      });
      let attempt = 0;
      while (true) {
        if (!isActivePendingSession(session.sessionId)) return;
        const remainingWaitMs = Math.max(0, session.expiresAtMs - now());
        const result = await bridgeClient.claimSession(
          {
            sessionId: session.sessionId,
            claimToken: session.claimToken,
          },
          controller.signal,
        );
        logTelegramProvisioningTrace("bridge-claim-result", {
          sessionId: session.sessionId,
          attempt,
          remainingWaitMs,
          ok: result.ok,
          ...(result.ok
            ? {
              username: result.username,
              tokenLength: result.token.length,
            }
            : { reason: result.reason }),
        });
        if (!isActivePendingSession(session.sessionId)) return;
        if (!result.ok) {
          if (result.reason === "pending" && remainingWaitMs > 0) {
            attempt++;
            await sleep(Math.min(remainingWaitMs, BRIDGE_CLAIM_POLL_INTERVAL_MS));
            continue;
          }
          if (result.reason === "pending" || result.reason === "missing") {
            failActiveSession(session.sessionId, "Telegram provisioning session expired.");
            return;
          }
          failActiveSession(
            session.sessionId,
            "Telegram provisioning bridge rejected the session.",
          );
          return;
        }
        logTelegramProvisioningTrace("bridge-claim-complete-start", {
          sessionId: session.sessionId,
          username: result.username,
        });
        const completion = await service.completeSession({
          sessionId: session.sessionId,
          token: result.token,
          username: result.username,
        });
        logTelegramProvisioningTrace("bridge-claim-complete-result", {
          sessionId: session.sessionId,
          completed: !!completion,
          sessionState: completion?.session.state ?? null,
          statusState: completion?.status?.state ?? null,
          statusError: completion?.status?.lastError ?? null,
        });
        if (!completion || completion.session.state !== "completed") {
          failActiveSession(
            session.sessionId,
            completion?.status?.lastError ?? "Telegram provisioning failed.",
          );
        }
        return;
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const detail = error instanceof Error ? error.message : String(error);
      logTelegramProvisioningTrace("bridge-claim-error", {
        sessionId: session.sessionId,
        detail,
      });
      failActiveSession(session.sessionId, detail);
    } finally {
      if (activeBridgeAbort === controller) {
        activeBridgeAbort = null;
      }
    }
  }

  const service: TelegramProvisioningService = {
    async createSession(input = {}): Promise<RuntimeTelegramProvisioningSessionSnapshot> {
      clearExpiredSession();
      stopBridgeWait();
      if (activeSession?.state === "pending") {
        disarmPairCode("telegram");
      }

      const current = await loadCurrentConfig();
      const existingTelegram = current.channels?.telegram;
      const existingTransport = existingTelegram?.transport;
      const existingUsername = typeof existingTransport?.username === "string"
        ? existingTransport.username.trim().replace(/^@+/, "")
        : "";
      const shouldOpenExistingBot = existingTransport?.mode === "direct" && existingUsername.length > 0;

      const rawId = randomId().replace(/-/g, "");
      const seed = rawId.slice(0, 6).toLowerCase();
      const sessionId = rawId;
      const pairCode = randomCode();
      const managerBotUsername = sanitizeManagerBotUsername(input.managerBotUsername);
      const botName = sanitizeBotName(input.botName);
      const botUsername = sanitizeBotUsername(input.botUsername, seed);
      const createUrl = buildTelegramManagedBotCreateUrl(
        managerBotUsername,
        botUsername,
        botName,
      );

      if (shouldOpenExistingBot) {
        activeSession = {
          sessionId,
          state: "completed",
          pairCode: "",
          managerBotUsername,
          botName,
          botUsername: existingUsername,
          qrKind: "open_bot",
          qrUrl: buildTelegramBotChatUrl(existingUsername),
          createdAtMs: now(),
          expiresAtMs: now() + DEFAULT_TTL_MS,
          completedAtMs: now(),
        };
        const snapshot = toSnapshot(activeSession, undefined);
        logTelegramProvisioningTrace(
          "create-session-existing-bot",
          snapshot as unknown as Record<string, unknown>,
        );
        return snapshot;
      }

      activeSession = {
        sessionId,
        claimToken: bridgeEnabled ? randomId().replace(/-/g, "") : undefined,
        state: "pending",
        pairCode,
        managerBotUsername,
        botName,
        botUsername,
        qrKind: "create_bot",
        qrUrl: createUrl,
        createdAtMs: now(),
        expiresAtMs: now() + DEFAULT_TTL_MS,
      };
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
        void startBridgeClaimWait(activeSession);
      }

      const snapshot = toSnapshot(activeSession, provisioningBridgeBaseUrl);
      logTelegramProvisioningTrace(
        "create-session-snapshot",
        snapshot as unknown as Record<string, unknown>,
      );
      return snapshot;
    },

    getSession(): RuntimeTelegramProvisioningSessionSnapshot | null {
      clearExpiredSession();
      return activeSession ? toSnapshot(activeSession, provisioningBridgeBaseUrl) : null;
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
    ): Promise<RuntimeTelegramProvisioningCompletionResult | null> {
      clearExpiredSession();
      logTelegramProvisioningTrace("complete-session-start", {
        sessionId: input.sessionId,
        username: input.username,
        tokenLength: input.token.trim().length,
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
          session: toSnapshot(activeSession, provisioningBridgeBaseUrl),
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

      const username = sanitizeBotUsername(input.username, activeSession.sessionId.slice(0, 6));
      const current = await loadCurrentConfig();
      const existingChannels = current.channels ?? {};
      const existingChannel = existingChannels.telegram ?? {};
      const existingTransport = existingChannel.transport ?? {};

      await patchConfig({
        channels: {
          ...existingChannels,
          telegram: {
            ...existingChannel,
            enabled: true,
            transport: {
              ...existingTransport,
              mode: "direct",
              token,
              username,
              cursor: 0,
            },
          },
        },
      });
      logTelegramProvisioningTrace("complete-session-config-written", {
        sessionId: input.sessionId,
        username,
      });
      await reconfigure();
      logTelegramProvisioningTrace("complete-session-reconfigured", {
        sessionId: input.sessionId,
      });

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
        session: toSnapshot(activeSession, provisioningBridgeBaseUrl),
        ...(status ? { status } : {}),
      };
    },
  };

  return service;
}

export const telegramProvisioning = createTelegramProvisioningService();
