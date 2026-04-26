import { Database } from "@db/sqlite";
import type { ChannelConfig } from "../../../common/config/types.ts";
import { RuntimeError, ValidationError } from "../../../common/error.ts";
import type {
  ChannelMessage,
  ChannelReply,
  ChannelStatus,
  ChannelTransport,
  ChannelTransportContext,
} from "../core/types.ts";
import { traceChannelDiagnostic } from "../core/trace.ts";
import {
  getDefaultIMessageWalPath,
  normalizeIMessageRecipientIds,
  openIMessageChatDb,
  readIMessageTransportConfig,
  readNewIMessageRows,
} from "./chatdb.ts";
import { resolveIMessageAccountIdentity } from "./account.ts";
import {
  createAppleScriptIMessageSender,
  formatIMessageReply,
  type IMessageSender,
} from "./sender.ts";
import {
  type IMessageWalWatcher,
  startIMessageWalWatcher,
} from "./wal-watcher.ts";
import { getPlatform } from "../../../platform/platform.ts";
import {
  createFoundationAttributedBodyDecoder,
  type IMessageAttributedBodyDecoder,
} from "./attributed-body.ts";

interface IMessageTransportState {
  recipientId: string;
  recipientIds: string[];
  cursor: number;
  chatId?: number;
  attributionMarker: string;
}

export interface IMessageTransportDependencies {
  openDb?: () => Database;
  sender?: IMessageSender;
  startWalWatcher?: (
    walPath: string,
    options: {
      onChange: () => void | Promise<void>;
      onError?: (error: Error) => void;
    },
  ) => IMessageWalWatcher;
  attributedBodyDecoder?: IMessageAttributedBodyDecoder;
  walPath?: string;
  isMacOS?: () => boolean;
}

export function createIMessageTransport(
  channelConfig: ChannelConfig,
  dependencies: IMessageTransportDependencies = {},
): ChannelTransport {
  const platform = getPlatform();
  const transportConfig = readIMessageTransportConfig(channelConfig.transport);
  const sender = dependencies.sender ?? createAppleScriptIMessageSender();
  const attributedBodyDecoder = dependencies.attributedBodyDecoder ??
    createFoundationAttributedBodyDecoder();
  const openDb = dependencies.openDb ?? (() => openIMessageChatDb());
  const startWalWatcher = dependencies.startWalWatcher ??
    startIMessageWalWatcher;
  const walPath = dependencies.walPath ?? getDefaultIMessageWalPath();
  const isMacOS = dependencies.isMacOS ??
    (() => platform.build.os === "darwin");
  let context: ChannelTransportContext | null = null;
  let watcher: IMessageWalWatcher | null = null;
  let stopped = false;
  let drainChain: Promise<void> = Promise.resolve();
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let watcherRestartAttempts = 0;
  let state: IMessageTransportState | null = transportConfig
    ? {
      recipientId: transportConfig.recipientId,
      recipientIds: transportConfig.recipientIds?.length
        ? transportConfig.recipientIds
        : [transportConfig.recipientId],
      cursor: transportConfig.cursor ?? 0,
      chatId: transportConfig.chatId,
      attributionMarker:
        typeof channelConfig.transport?.attributionMarker === "string"
          ? channelConfig.transport.attributionMarker
          : "🤖",
    }
    : null;
  const suppressor = createOutboundSuppressor();

  function setStatus(
    status: Partial<ChannelStatus> & Pick<ChannelStatus, "state">,
  ): void {
    context?.setStatus(status);
  }

  async function persistCursor(
    nextCursor: number,
    nextChatId?: number,
  ): Promise<void> {
    const current = state;
    if (!current) return;
    if (nextCursor === current.cursor && nextChatId === current.chatId) return;

    state = {
      ...current,
      cursor: nextCursor,
      ...(nextChatId ? { chatId: nextChatId } : {}),
    };
    await context?.updateConfig({
      transport: {
        cursor: nextCursor,
        ...(nextChatId ? { chatId: nextChatId } : {}),
      },
    });
  }

  async function refreshSelectedAliases(): Promise<void> {
    const current = state;
    if (!current || !context) return;
    const identity = await resolveIMessageAccountIdentity().catch(() =>
      undefined
    );
    if (!identity?.recipientIds.includes(current.recipientId)) return;

    const recipientIds = normalizeIMessageRecipientIds(
      current.recipientId,
      identity.recipientIds,
    );
    if (
      recipientIds.length === current.recipientIds.length &&
      recipientIds.every((id, index) => id === current.recipientIds[index])
    ) {
      return;
    }

    state = { ...current, recipientIds };
    await context.updateConfig({
      allowedIds: recipientIds,
      transport: { recipientIds },
    });
    traceChannelDiagnostic("imessage", "transport", "aliases-refreshed", {
      recipientId: current.recipientId,
      recipientIds,
    });
  }

  async function drainNewRows(reason: string): Promise<void> {
    if (stopped || !context || !state) return;
    let db: Database | null = null;
    try {
      db = openDb();
      const result = readNewIMessageRows(db, state);
      traceChannelDiagnostic("imessage", "transport", "drain", {
        reason,
        fromCursor: state.cursor,
        toCursor: result.cursor,
        configuredChatId: state.chatId ?? null,
        resultChatId: result.chatId ?? null,
        rowCount: result.rows.length,
      });
      await persistCursor(result.cursor, result.chatId);
      const allowedIds = new Set(state.recipientIds);
      for (const row of result.rows) {
        const text = await resolveRowText(row, attributedBodyDecoder);
        if (!text.trim()) {
          traceChannelDiagnostic("imessage", "transport", "row-skipped", {
            reason: "empty_text",
            rowId: row.rowId,
            chatId: row.chatId,
          });
          continue;
        }
        if (
          row.handleId && allowedIds.size > 0 && !allowedIds.has(row.handleId)
        ) {
          traceChannelDiagnostic("imessage", "transport", "row-skipped", {
            reason: "sender_not_allowed",
            rowId: row.rowId,
            chatId: row.chatId,
            handleId: row.handleId,
          });
          continue;
        }
        if (suppressor.matches(text)) {
          traceChannelDiagnostic("imessage", "transport", "row-skipped", {
            reason: "outbound_suppressor",
            rowId: row.rowId,
            chatId: row.chatId,
          });
          continue;
        }
        if (isMarkedIMessageReply(text, state.attributionMarker)) {
          traceChannelDiagnostic("imessage", "transport", "row-skipped", {
            reason: "attribution_marker",
            rowId: row.rowId,
            chatId: row.chatId,
          });
          continue;
        }
        traceChannelDiagnostic("imessage", "transport", "row-received", {
          rowId: row.rowId,
          chatId: row.chatId,
          chatIdentifier: row.chatIdentifier,
          handleId: row.handleId,
          isFromMe: row.isFromMe,
          textLength: text.length,
        });
        const message: ChannelMessage = {
          channel: "imessage",
          remoteId: state.recipientId,
          sender: { id: state.recipientId, display: "iMessage" },
          text,
          raw: {
            rowId: row.rowId,
            chatId: row.chatId,
            chatIdentifier: row.chatIdentifier,
            handleId: row.handleId,
            reason,
          },
        };
        await context.receive(message);
      }
      setStatus({ state: "connected", lastError: null });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      traceChannelDiagnostic("imessage", "transport", "error", {
        reason,
        detail,
      });
      setStatus({ state: "error", lastError: detail });
      throw error;
    } finally {
      db?.close();
    }
  }

  function scheduleDrain(reason: string): void {
    if (drainTimer) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
    const delayMs = reason === "wal-change" ? 250 : 0;
    drainTimer = setTimeout(() => {
      drainTimer = null;
      drainChain = drainChain
        .then(() => drainNewRows(reason))
        .catch(() => {});
    }, delayMs);
  }

  function startWatcher(): void {
    if (stopped) return;
    watcher = startWalWatcher(walPath, {
      onChange: () => {
        watcherRestartAttempts = 0;
        scheduleDrain("wal-change");
      },
      onError: (error) => {
        if (stopped) return;
        setStatus({ state: "error", lastError: error.message });
      },
    });
    const currentWatcher = watcher;
    currentWatcher.done.then(() => {
      if (stopped || watcher !== currentWatcher) return;
      watcher = null;
      scheduleDrain("wal-watcher-exit");
      restartWatcherAfterWalRotation();
    }).catch((error) => {
      if (stopped) return;
      const detail = error instanceof Error ? error.message : String(error);
      setStatus({ state: "error", lastError: detail });
    });
  }

  function restartWatcherAfterWalRotation(): void {
    if (watcherRestartAttempts >= 3) {
      setStatus({
        state: "error",
        lastError: "iMessage WAL watcher stopped after repeated restarts.",
      });
      return;
    }
    watcherRestartAttempts += 1;
    setTimeout(() => {
      if (stopped || watcher) return;
      try {
        startWatcher();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatus({ state: "error", lastError: detail });
      }
    }, 500);
  }

  return {
    channel: "imessage",

    async start(nextContext: ChannelTransportContext): Promise<void> {
      context = nextContext;
      stopped = false;
      if (!isMacOS()) {
        setStatus({
          state: "unsupported",
          lastError: "iMessage is supported only on macOS.",
        });
        return;
      }
      if (
        channelConfig.transport?.mode &&
        channelConfig.transport.mode !== "local"
      ) {
        throw new ValidationError(
          "iMessage transport supports only local mode.",
          "imessage_transport",
        );
      }
      if (!state) {
        throw new ValidationError(
          "iMessage transport requires channels.imessage.transport.recipientId.",
          "imessage_transport",
        );
      }
      await refreshSelectedAliases();
      try {
        await platform.fs.stat(walPath);
      } catch (error) {
        throw new RuntimeError(
          "iMessage transport cannot access Messages chat.db-wal. Open Messages once and grant HLVM Full Disk Access.",
          { originalError: error instanceof Error ? error : undefined },
        );
      }
      await drainNewRows("startup");
      startWatcher();
      setStatus({ state: "connected", lastError: null });
    },

    async send(reply: ChannelReply): Promise<void> {
      if (!state) {
        throw new RuntimeError("iMessage transport is not configured.");
      }
      const text = formatIMessageReply(reply.text, state.attributionMarker);
      const target = resolveReplyTarget(
        reply.replyTo,
        state.recipientId,
        state.recipientIds,
      );
      traceChannelDiagnostic("imessage", "transport", "send", {
        targetKind: target.kind,
        targetId: target.id,
        textLength: text.length,
      });
      suppressor.record(text);
      try {
        if (target.kind === "chat" && sender.sendToChat) {
          await sender.sendToChat(target.id, text);
        } else {
          await sender.send(target.id, text);
        }
        traceChannelDiagnostic("imessage", "transport", "send-ok", {
          targetKind: target.kind,
          targetId: target.id,
          textLength: text.length,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        traceChannelDiagnostic("imessage", "transport", "send-error", {
          targetKind: target.kind,
          targetId: target.id,
          textLength: text.length,
          detail,
        });
        throw error;
      }
    },

    async stop(): Promise<void> {
      stopped = true;
      if (drainTimer) {
        clearTimeout(drainTimer);
        drainTimer = null;
      }
      watcher?.close();
      watcher = null;
      await drainChain.catch(() => {});
      context = null;
    },
  };
}

function createOutboundSuppressor() {
  const ttlMs = 120_000;
  const sent: Array<{ text: string; at: number }> = [];

  function prune(now: number): void {
    while (sent.length > 0 && now - sent[0]!.at > ttlMs) {
      sent.shift();
    }
  }

  return {
    record(text: string): void {
      const now = Date.now();
      prune(now);
      sent.push({ text: normalizeSuppressionText(text), at: now });
    },
    matches(text: string): boolean {
      const now = Date.now();
      prune(now);
      const normalized = normalizeSuppressionText(text);
      return sent.some((entry) => entry.text === normalized);
    },
  };
}

function normalizeSuppressionText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function isMarkedIMessageReply(text: string, marker: string): boolean {
  const normalizedMarker = marker.trim();
  return normalizedMarker.length > 0 &&
    normalizeSuppressionText(text).startsWith(`${normalizedMarker} `);
}

async function resolveRowText(
  row: { text: string; attributedBody?: Uint8Array },
  decoder: IMessageAttributedBodyDecoder,
): Promise<string> {
  if (row.text.trim().length > 0) return row.text;
  if (!row.attributedBody || row.attributedBody.length === 0) return "";
  return await decoder.decode(row.attributedBody);
}

function resolveReplyTarget(
  replyTo: unknown,
  fallbackRecipientId: string,
  allowedRecipientIds: string[],
): { kind: "chat" | "buddy"; id: string } {
  if (replyTo && typeof replyTo === "object" && "chatIdentifier" in replyTo) {
    const chatIdentifier = (replyTo as { chatIdentifier?: unknown })
      .chatIdentifier;
    if (typeof chatIdentifier === "string" && chatIdentifier.trim()) {
      return { kind: "chat", id: chatIdentifier };
    }
  }
  if (replyTo && typeof replyTo === "object" && "handleId" in replyTo) {
    const handleId = (replyTo as { handleId?: unknown }).handleId;
    if (
      typeof handleId === "string" &&
      allowedRecipientIds.includes(handleId)
    ) {
      return { kind: "buddy", id: handleId };
    }
  }
  return { kind: "buddy", id: fallbackRecipientId };
}
