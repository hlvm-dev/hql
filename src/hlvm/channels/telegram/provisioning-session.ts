import type {
  ChannelConfig,
  ChannelsConfig,
  ChannelTransportConfig,
  HlvmConfig,
} from "../../../common/config/types.ts";
import { buildTelegramProvisioningBridgeUrl } from "./provisioning-bridge.ts";
import type { TelegramSetupSession } from "./protocol.ts";

const DEFAULT_BOT_NAME = "HLVM";
const DEFAULT_TTL_MS = 10 * 60 * 1000;

type ProvisioningState = "completed" | "pending";
type ProvisioningQrKind = "create_bot" | "open_bot";

export interface TelegramProvisioningSessionInternal {
  sessionId: string;
  claimToken?: string;
  deviceId?: string;
  ownerUserId?: number;
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

export interface ExistingTelegramState {
  channels: ChannelsConfig;
  channel: ChannelConfig;
  transport: ChannelTransportConfig;
  allowedIds: string[];
  username: string;
  ownerUserId?: number;
}

export function sanitizeTelegramBotName(value: string | undefined): string {
  return value?.trim() || DEFAULT_BOT_NAME;
}

function defaultBotUsername(seed: string): string {
  return `hlvm_${seed}_bot`;
}

function buildTelegramBotChatUrl(username: string): string {
  return `tg://resolve?domain=${username.replace(/^@+/, "")}`;
}

export function sanitizeTelegramBotUsername(
  value: string | undefined,
  seed: string,
): string {
  const trimmed = value?.trim().replace(/^@+/, "") || "";
  if (/^[A-Za-z][A-Za-z0-9_]{4,31}bot$/i.test(trimmed)) {
    return trimmed;
  }
  return defaultBotUsername(seed);
}

export function trimTelegramTransportDeviceId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function trimKnownOwnerUserId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function readConfiguredTelegramUsername(
  transport: ChannelTransportConfig,
): string {
  return typeof transport.username === "string"
    ? transport.username.trim().replace(/^@+/, "")
    : "";
}

function resolveKnownOwnerUserId(
  transport: ChannelTransportConfig,
  allowedIds: string[],
): number | undefined {
  const knownOwnerUserId = trimKnownOwnerUserId(transport.ownerUserId);
  if (knownOwnerUserId !== undefined) {
    return knownOwnerUserId;
  }
  if (allowedIds.length !== 1) {
    return undefined;
  }
  const parsed = Number(allowedIds[0]);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export function readExistingTelegramState(
  current: HlvmConfig,
): ExistingTelegramState {
  const channels = current.channels ?? {};
  const channel = channels.telegram ?? {};
  const transport = channel.transport ?? {};
  const allowedIds = channel.allowedIds ?? [];
  return {
    channels,
    channel,
    transport,
    allowedIds,
    username: readConfiguredTelegramUsername(transport),
    ownerUserId: resolveKnownOwnerUserId(transport, allowedIds),
  };
}

export function shouldOpenExistingTelegramBot(
  transport: ChannelTransportConfig,
  username: string,
): boolean {
  return transport.mode === "direct" && username.length > 0;
}

export function buildOpenTelegramBotSession(input: {
  sessionId: string;
  deviceId: string;
  ownerUserId?: number;
  managerBotUsername: string;
  botName: string;
  username: string;
  nowMs: number;
}): TelegramProvisioningSessionInternal {
  return {
    sessionId: input.sessionId,
    deviceId: input.deviceId,
    ...(input.ownerUserId !== undefined
      ? { ownerUserId: input.ownerUserId }
      : {}),
    state: "completed",
    pairCode: "",
    managerBotUsername: input.managerBotUsername,
    botName: input.botName,
    botUsername: input.username,
    qrKind: "open_bot",
    qrUrl: buildTelegramBotChatUrl(input.username),
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + DEFAULT_TTL_MS,
    completedAtMs: input.nowMs,
  };
}

export function buildPendingTelegramCreateSession(input: {
  sessionId: string;
  claimToken?: string;
  deviceId: string;
  ownerUserId?: number;
  pairCode: string;
  managerBotUsername: string;
  botName: string;
  botUsername: string;
  qrUrl: string;
  nowMs: number;
}): TelegramProvisioningSessionInternal {
  return {
    sessionId: input.sessionId,
    ...(input.claimToken ? { claimToken: input.claimToken } : {}),
    deviceId: input.deviceId,
    ...(input.ownerUserId !== undefined
      ? { ownerUserId: input.ownerUserId }
      : {}),
    state: "pending",
    pairCode: input.pairCode,
    managerBotUsername: input.managerBotUsername,
    botName: input.botName,
    botUsername: input.botUsername,
    qrKind: "create_bot",
    qrUrl: input.qrUrl,
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + DEFAULT_TTL_MS,
  };
}

export function buildCompletedTelegramConfigPatch(input: {
  state: ExistingTelegramState;
  session: TelegramProvisioningSessionInternal;
  token: string;
  username: string;
  ownerUserId?: number;
}): Partial<HlvmConfig> {
  const nextAllowedIds = Number.isInteger(input.ownerUserId)
    ? [String(input.ownerUserId)]
    : input.session.qrKind === "create_bot"
    ? []
    : input.state.allowedIds;
  return {
    channels: {
      ...input.state.channels,
      telegram: {
        ...input.state.channel,
        enabled: true,
        allowedIds: nextAllowedIds,
        transport: {
          ...input.state.transport,
          mode: "direct",
          ...(input.session.deviceId
            ? { deviceId: input.session.deviceId }
            : {}),
          ownerUserId: Number.isInteger(input.ownerUserId)
            ? input.ownerUserId
            : undefined,
          token: input.token,
          username: input.username,
          cursor: 0,
        },
      },
    },
  };
}

export function toTelegramSetupSession(
  session: TelegramProvisioningSessionInternal,
  provisioningBridgeBaseUrl: string | undefined,
): TelegramSetupSession {
  const provisionUrl = provisioningBridgeBaseUrl
    ? buildTelegramProvisioningBridgeUrl(
      provisioningBridgeBaseUrl,
      session.sessionId,
    )
    : undefined;
  return {
    channel: "telegram",
    sessionId: session.sessionId,
    state: session.state,
    setupUrl: session.qrUrl,
    pairCode: session.pairCode,
    managerBotUsername: session.managerBotUsername,
    botName: session.botName,
    botUsername: session.botUsername,
    qrKind: session.qrKind,
    ...(provisionUrl ? { provisionUrl } : {}),
    createUrl: session.qrUrl,
    createdAt: new Date(session.createdAtMs).toISOString(),
    expiresAt: new Date(session.expiresAtMs).toISOString(),
    ...(session.completedAtMs
      ? { completedAt: new Date(session.completedAtMs).toISOString() }
      : {}),
  };
}
