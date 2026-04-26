import type { HlvmConfig } from "../../../common/config/types.ts";
import { RuntimeError, ValidationError } from "../../../common/error.ts";
import { config } from "../../api/config.ts";
import { log } from "../../api/log.ts";
import { getPlatform } from "../../../platform/platform.ts";
import type { ChannelProvisioner, ChannelStatus } from "../core/types.ts";
import { channelRuntime } from "../registry.ts";
import {
  buildIMessageSetupUrl,
  getLatestIMessageRowId,
  normalizeIMessageRecipientId,
  normalizeIMessageRecipientIds,
  openIMessageChatDb,
  readIMessageTransportConfig,
} from "./chatdb.ts";
import {
  type IMessageAccountIdentity,
  orderPreferredIMessageRecipientIds,
  resolveIMessageAccountIdentity,
} from "./account.ts";
import type {
  IMessageProvisioningCompleteRequest,
  IMessageProvisioningCompletionResult,
  IMessageProvisioningCreateRequest,
  IMessageSetupSession,
} from "./protocol.ts";

const IMESSAGE_SESSION_TTL_MS = 15 * 60 * 1000;

export interface IMessageProvisioningDependencies {
  loadConfig?: () => Promise<HlvmConfig>;
  patchConfig?: typeof config.patch;
  reconfigure?: () => Promise<void>;
  getStatus?: (channel: string) => ChannelStatus | null;
  reportStatus?: (
    channel: string,
    status: Partial<ChannelStatus> & Pick<ChannelStatus, "state">,
  ) => void;
  now?: () => number;
  randomId?: () => string;
  readLatestCursor?: () => number;
  resolveDefaultIdentity?: () =>
    | IMessageAccountIdentity
    | undefined
    | Promise<IMessageAccountIdentity | undefined>;
  resolveDefaultRecipientId?: () =>
    | string
    | undefined
    | Promise<string | undefined>;
  isMacOS?: () => boolean;
}

export type IMessageProvisioningService = ChannelProvisioner<
  IMessageProvisioningCreateRequest,
  IMessageSetupSession,
  IMessageProvisioningCompleteRequest,
  IMessageProvisioningCompletionResult
>;

function traceIMessageProvisioning(
  event: string,
  data: Record<string, unknown>,
): void {
  log.ns("imessage").debug(`[provisioning] ${event} ${JSON.stringify(data)}`);
}

export function createIMessageProvisioningService(
  dependencies: IMessageProvisioningDependencies = {},
): IMessageProvisioningService {
  const loadCurrentConfig = dependencies.loadConfig ??
    (async () => await config.all);
  const patchConfig = dependencies.patchConfig ?? config.patch;
  const reconfigure = dependencies.reconfigure ??
    (() => channelRuntime.reconfigure());
  const getStatus = dependencies.getStatus ??
    ((channel) => channelRuntime.getStatus(channel));
  const reportStatus = dependencies.reportStatus ??
    ((channel, status) => channelRuntime.reportStatus(channel, status));
  const now = dependencies.now ?? Date.now;
  const randomId = dependencies.randomId ?? (() => crypto.randomUUID());
  const resolveDefaultIdentity = dependencies.resolveDefaultIdentity ??
    (async () => {
      const envRecipientId = normalizeIMessageRecipientId(
        getPlatform().env.get("HLVM_IMESSAGE_SELF_ID"),
      );
      if (envRecipientId) {
        return { recipientId: envRecipientId, recipientIds: [envRecipientId] };
      }
      if (dependencies.resolveDefaultRecipientId) {
        const recipientId = normalizeIMessageRecipientId(
          await dependencies.resolveDefaultRecipientId(),
        );
        return recipientId
          ? { recipientId, recipientIds: [recipientId] }
          : undefined;
      }
      return await resolveIMessageAccountIdentity();
    });
  const isMacOS = dependencies.isMacOS ??
    (() => getPlatform().build.os === "darwin");
  const readLatestCursor = dependencies.readLatestCursor ?? (() => {
    const db = openIMessageChatDb();
    try {
      return getLatestIMessageRowId(db);
    } finally {
      db.close();
    }
  });

  let activeSession: IMessageSetupSession | null = null;

  function toSession(
    recipientId: string,
    sessionId: string,
    state: "pending" | "completed",
  ): IMessageSetupSession {
    const createdAtMs = now();
    const completedAt = state === "completed"
      ? new Date(createdAtMs).toISOString()
      : undefined;
    return {
      channel: "imessage",
      sessionId,
      state,
      setupUrl: buildIMessageSetupUrl(recipientId),
      qrKind: "open_bot",
      recipientId,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + IMESSAGE_SESSION_TTL_MS).toISOString(),
      ...(completedAt ? { completedAt } : {}),
    };
  }

  async function resolveRecipientIdentity(
    input: IMessageProvisioningCreateRequest | undefined,
  ): Promise<IMessageAccountIdentity> {
    const inputRecipient = normalizeIMessageRecipientId(input?.recipientId);
    if (inputRecipient) {
      return { recipientId: inputRecipient, recipientIds: [inputRecipient] };
    }

    const defaultIdentity = await resolveDefaultIdentity();
    const normalizedDefaultIds = normalizeIMessageRecipientIds(
      defaultIdentity?.recipientId,
      defaultIdentity?.recipientIds,
    );
    const preferredDefaultIds = orderPreferredIMessageRecipientIds(
      normalizedDefaultIds,
    );
    if (preferredDefaultIds.length > 0) {
      const recipientId = preferredDefaultIds[0]!;
      return {
        recipientId,
        recipientIds: preferredDefaultIds,
      };
    }

    const existing = readIMessageTransportConfig(
      (await loadCurrentConfig()).channels?.imessage?.transport,
    );
    if (existing?.recipientId) {
      return {
        recipientId: existing.recipientId,
        recipientIds: existing.recipientIds?.length
          ? existing.recipientIds
          : [existing.recipientId],
      };
    }

    throw new ValidationError(
      "iMessage onboarding could not find the user's iMessage address. Open Messages and sign in, or set HLVM_IMESSAGE_SELF_ID.",
      "imessage_provisioning",
    );
  }

  return {
    channel: "imessage",

    async createSession(input = {}): Promise<IMessageSetupSession> {
      if (!isMacOS()) {
        throw new RuntimeError("iMessage channel is supported only on macOS.");
      }

      const identity = await resolveRecipientIdentity(input);
      let cursor: number;
      try {
        cursor = readLatestCursor();
      } catch (error) {
        throw new RuntimeError(
          "iMessage onboarding cannot read Messages chat.db. Open Messages once and grant HLVM Full Disk Access.",
          { originalError: error instanceof Error ? error : undefined },
        );
      }
      const session = toSession(
        identity.recipientId,
        randomId().replace(/-/g, ""),
        "completed",
      );
      activeSession = session;

      await patchConfig({
        channels: {
          imessage: {
            enabled: true,
            allowedIds: identity.recipientIds,
            transport: {
              mode: "local",
              recipientId: identity.recipientId,
              recipientIds: identity.recipientIds,
              cursor,
              chatId: null,
              attributionMarker: "🤖",
            },
          },
        },
      });
      reportStatus("imessage", { state: "connecting", lastError: null });
      await reconfigure();

      traceIMessageProvisioning("create-session-configured", {
        sessionId: session.sessionId,
        recipientId: identity.recipientId,
        recipientIds: identity.recipientIds,
        cursor,
      });
      return session;
    },

    getSession(): IMessageSetupSession | null {
      return activeSession;
    },

    cancelSession(): boolean {
      if (!activeSession || activeSession.state === "completed") return false;
      activeSession = null;
      return true;
    },

    async completeSession(
      input: IMessageProvisioningCompleteRequest,
    ): Promise<IMessageProvisioningCompletionResult | null> {
      if (!activeSession || activeSession.sessionId !== input.sessionId) {
        return null;
      }
      return {
        session: activeSession,
        ...(getStatus("imessage") ? { status: getStatus("imessage")! } : {}),
      };
    },
  };
}

export const imessageProvisioning = createIMessageProvisioningService();
