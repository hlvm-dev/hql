import { http, HttpError } from "../../../common/http-client.ts";
import { getEnvVar } from "../../../common/paths.ts";
import type { ChannelConfig } from "../../../common/config/types.ts";
import { ValidationError } from "../../../common/error.ts";
import type {
  ChannelMessage,
  ChannelReply,
  ChannelTransport,
  ChannelTransportContext,
} from "../core/types.ts";
import { createTelegramProvisioningBridgeClient } from "./provisioning-bridge-client.ts";
import { resolveTelegramManagerBotUsername } from "./config.ts";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TELEGRAM_POLL_TIMEOUT_SECONDS = 30;
const TELEGRAM_REQUEST_TIMEOUT_MS = 35_000;

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number | string;
}

interface TelegramMessagePayload {
  message_id?: number;
  chat?: TelegramChat;
  from?: TelegramUser;
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessagePayload;
}

interface TelegramGetMeResult {
  id: number;
  username?: string;
}

interface TelegramApi {
  getMe(token: string): Promise<TelegramGetMeResult>;
  getUpdates(
    token: string,
    offset: number,
    signal: AbortSignal,
  ): Promise<TelegramUpdate[]>;
  sendMessage(
    token: string,
    chatId: string,
    text: string,
  ): Promise<void>;
}

interface TelegramTransportDependencies {
  api?: TelegramApi;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly fatal: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

function trimToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function trimUsername(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function formatTelegramDisplayName(user: TelegramUser | undefined): string | undefined {
  if (!user) return undefined;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  return user.username?.trim() || undefined;
}

function matchesDefaultPairCode(text: string, code: string): boolean {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*HLVM-${escaped}\\b`).test(text);
}

function matchesStartPairCode(text: string, code: string): boolean {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*/start(?:@\\w+)?\\s+HLVM-${escaped}\\b`).test(text);
}

function matchesPlainStart(text: string): boolean {
  return /^\s*\/start(?:@\w+)?\s*$/i.test(text);
}

function matchesTelegramPairCodeText(text: string, code: string): boolean {
  return matchesDefaultPairCode(text, code) ||
    matchesStartPairCode(text, code) ||
    matchesPlainStart(text);
}

function toChannelMessage(update: TelegramUpdate): ChannelMessage | null {
  const message = update.message;
  const chatId = message?.chat?.id;
  if (chatId === undefined || chatId === null) return null;
  return {
    channel: "telegram",
    remoteId: String(chatId),
    text: message?.text ?? "",
    sender: message?.from
      ? {
        id: String(message.from.id),
        display: formatTelegramDisplayName(message.from),
      }
      : undefined,
    raw: update,
  };
}

async function parseTelegramResult<T>(
  response: Response,
  url: string,
): Promise<T> {
  const text = await response.text();
  let body: { ok?: boolean; result?: T; description?: string } | null = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text) as { ok?: boolean; result?: T; description?: string };
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const description = typeof body?.description === "string"
      ? body.description.trim()
      : "";
    const message = description ||
      `Telegram API HTTP ${response.status}: ${response.statusText}`;
    throw new TelegramApiError(
      message,
      response.status >= 400 && response.status < 500,
      response.status,
    );
  }
  if (!body || body.ok !== true) {
    throw new TelegramApiError(
      (typeof body?.description === "string" && body.description.trim()) ||
        "Telegram API request failed",
      true,
    );
  }
  return body.result as T;
}

function isStaleBotError(error: unknown): boolean {
  if (error instanceof TelegramApiError) {
    return error.status === 401;
  }
  return error instanceof HttpError && error.status === 401;
}

function createTelegramApi(): TelegramApi {
  async function post<T>(
    token: string,
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `${TELEGRAM_API_BASE_URL}/bot${token}/${method}`;
    const response = await http.fetchRaw(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeout: TELEGRAM_REQUEST_TIMEOUT_MS,
      signal,
    });
    return await parseTelegramResult<T>(response, url);
  }

  return {
    getMe(token) {
      return post<TelegramGetMeResult>(token, "getMe", {});
    },
    getUpdates(token, offset, signal) {
      return post<TelegramUpdate[]>(token, "getUpdates", {
        offset,
        timeout: TELEGRAM_POLL_TIMEOUT_SECONDS,
        allowed_updates: ["message"],
      }, signal);
    },
    async sendMessage(token, chatId, text) {
      await post(token, "sendMessage", {
        chat_id: chatId,
        text,
      });
    },
  };
}

function transportConfigSnapshot(
  mode: "direct",
  token: string,
  username: string | undefined,
  cursor: number,
): Record<string, unknown> {
  return {
    mode,
    token,
    cursor,
    ...(username ? { username } : {}),
  };
}

export function createTelegramTransport(
  config: ChannelConfig,
  dependencies: TelegramTransportDependencies = {},
): ChannelTransport {
  const api = dependencies.api ?? createTelegramApi();
  const sleep = dependencies.sleep ?? sleepWithAbort;

  let token = trimToken(config.transport?.token);
  let username = trimUsername(config.transport?.username);
  let cursor = typeof config.transport?.cursor === "number" &&
      Number.isInteger(config.transport.cursor) && config.transport.cursor >= 0
    ? config.transport.cursor
    : 0;
  let pollAbort: AbortController | null = null;
  let pollLoop: Promise<void> | null = null;
  let activeContext: ChannelTransportContext | null = null;
  const deviceId = typeof config.transport?.deviceId === "string" && config.transport.deviceId.trim()
    ? config.transport.deviceId.trim()
    : undefined;
  const ownerUserId = typeof config.transport?.ownerUserId === "number" &&
      Number.isInteger(config.transport.ownerUserId)
    ? config.transport.ownerUserId
    : undefined;

  async function clearStaleBotState(context: ChannelTransportContext): Promise<void> {
    token = "";
    username = undefined;
    cursor = 0;
    await context.updateConfig({
      onboardingDismissed: false,
      enabled: false,
      allowedIds: [],
      transport: {
        mode: "direct",
        ...(deviceId ? { deviceId } : {}),
        token: "",
        username: "",
        cursor: 0,
      },
    });

    const provisioningBridgeBaseUrl = getEnvVar("HLVM_TELEGRAM_PROVISIONING_BRIDGE_URL")?.trim();
    const bridgeAuthToken = getEnvVar("HLVM_TELEGRAM_PROVISIONING_BRIDGE_AUTH_TOKEN")?.trim();
    if (!provisioningBridgeBaseUrl || !bridgeAuthToken) return;

    const managerBotUsername = resolveTelegramManagerBotUsername();
    try {
      await createTelegramProvisioningBridgeClient(provisioningBridgeBaseUrl).resetState?.({
        ...(deviceId ? { deviceId } : {}),
        ...(ownerUserId !== undefined && managerBotUsername
          ? { ownerUserId, managerBotUsername }
          : {}),
      }, bridgeAuthToken);
    } catch {
      // Ignore bridge reset failure — local stale-token cleanup is the critical path.
    }
  }

  async function persistTransport(context: ChannelTransportContext): Promise<void> {
    await context.updateConfig({
      transport: transportConfigSnapshot("direct", token, username, cursor),
    });
  }

  async function runPollingLoop(
    context: ChannelTransportContext,
    signal: AbortSignal,
  ): Promise<void> {
    let failureCount = 0;

    while (!signal.aborted) {
      try {
        const updates = await api.getUpdates(token, cursor + 1, signal);
        let latestCursor = cursor;

        for (const update of updates) {
          latestCursor = Math.max(latestCursor, update.update_id);
          const inbound = toChannelMessage(update);
          if (!inbound) continue;
          await context.receive(inbound);
        }

        if (latestCursor !== cursor) {
          cursor = latestCursor;
          await persistTransport(context);
        }

        failureCount = 0;
        context.setStatus({ state: "connected", lastError: null });
      } catch (error) {
        if (isAbortError(error) || signal.aborted) {
          return;
        }

        const fatal = error instanceof TelegramApiError
          ? error.fatal
          : error instanceof HttpError && error.status >= 400 && error.status < 500;
        const detail = error instanceof Error ? error.message : String(error);
        if (fatal) {
          if (isStaleBotError(error)) {
            await clearStaleBotState(context);
            context.setStatus({ state: "disconnected", lastError: detail });
            return;
          }
          context.setStatus({ state: "error", lastError: detail });
          return;
        }

        context.setStatus({ state: "error", lastError: detail });
        failureCount += 1;
        const backoffMs = Math.min(5_000, 250 * (2 ** (failureCount - 1)));
        await sleep(backoffMs, signal);
      }
    }
  }

  return {
    channel: "telegram",

    matchesPairCode(message, code) {
      return matchesTelegramPairCodeText(message.text, code);
    },

    async start(context: ChannelTransportContext): Promise<void> {
      activeContext = context;
      if (config.transport?.mode !== "direct") {
        throw new ValidationError(
          "Telegram transport currently supports only channels.telegram.transport.mode = \"direct\".",
          "telegram_transport",
        );
      }
      if (!token) {
        throw new ValidationError(
          "Telegram direct transport requires channels.telegram.transport.token.",
          "telegram_transport",
        );
      }

      let me: TelegramGetMeResult;
      try {
        me = await api.getMe(token);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (isStaleBotError(error)) {
          await clearStaleBotState(context);
          context.setStatus({ state: "disconnected", lastError: detail });
          return;
        }
        throw error;
      }
      const canonicalUsername = trimUsername(me.username);
      if (canonicalUsername && canonicalUsername !== username) {
        username = canonicalUsername;
        await persistTransport(context);
      }

      pollAbort = new AbortController();
      pollLoop = runPollingLoop(context, pollAbort.signal);
    },

    async send(message: ChannelReply): Promise<void> {
      if (!token) {
        throw new ValidationError(
          "Telegram direct transport is missing a bot token.",
          "telegram_transport",
        );
      }
      try {
        await api.sendMessage(token, message.remoteId, message.text);
      } catch (error) {
        if (isStaleBotError(error) && activeContext) {
          const detail = error instanceof Error ? error.message : String(error);
          await clearStaleBotState(activeContext);
          activeContext.setStatus({ state: "disconnected", lastError: detail });
          return;
        }
        throw error;
      }
    },

    async stop(): Promise<void> {
      pollAbort?.abort();
      try {
        await pollLoop;
      } catch (error) {
        if (!isAbortError(error)) {
          throw error;
        }
      } finally {
        pollAbort = null;
        pollLoop = null;
        activeContext = null;
      }
    },
  };
}
