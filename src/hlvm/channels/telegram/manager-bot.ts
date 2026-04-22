import { http } from "../../../common/http-client.ts";
import { ValidationError } from "../../../common/error.ts";
import { log } from "../../api/log.ts";
import type { TelegramProvisioningBridgeService } from "./provisioning-bridge-service.ts";
import { logTelegramE2ETrace } from "./e2e-trace.ts";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TELEGRAM_REQUEST_TIMEOUT_MS = 30_000;
const TELEGRAM_WEBHOOK_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

interface TelegramUser {
  id: number;
  username?: string;
}

interface TelegramManagedBotUpdate {
  user?: TelegramUser;
  bot?: TelegramUser;
}

interface TelegramUpdate {
  update_id?: number;
  managed_bot?: TelegramManagedBotUpdate;
}

interface TelegramApiResponse<T> {
  ok?: boolean;
  result?: T;
  description?: string;
}

interface TelegramManagerBotApiDeps {
  fetchRaw?: typeof http.fetchRaw;
}

export interface TelegramManagerBotApi {
  getManagedBotToken(token: string, managedBotUserId: number): Promise<string>;
}

export interface TelegramManagerBotHandlerOptions {
  botToken: string;
  webhookSecret: string;
  service: TelegramProvisioningBridgeService;
  api?: TelegramManagerBotApi;
}

function logTelegramManagerWebhook(event: string, data: Record<string, unknown>): void {
  logTelegramE2ETrace("manager-webhook", event, data);
  log.raw.log(`[telegram-manager-webhook] ${event} ${JSON.stringify(data)}`);
}

function parseTelegramApiResponse<T>(
  response: Response,
): Promise<T> {
  return response.text().then((text) => {
    let body: TelegramApiResponse<T> | null = null;
    if (text.trim()) {
      try {
        body = JSON.parse(text) as TelegramApiResponse<T>;
      } catch {
        body = null;
      }
    }
    if (!response.ok || body?.ok !== true || body.result === undefined) {
      const description = typeof body?.description === "string"
        ? body.description.trim()
        : "";
      throw new Error(
        description || `Telegram manager bot API failed with HTTP ${response.status}.`,
      );
    }
    return body.result;
  });
}

export function createTelegramManagerBotApi(
  deps: TelegramManagerBotApiDeps = {},
): TelegramManagerBotApi {
  const fetchRaw = deps.fetchRaw ?? ((url, options) => http.fetchRaw(url, options));

  return {
    async getManagedBotToken(token, managedBotUserId) {
      const response = await fetchRaw(
        `${TELEGRAM_API_BASE_URL}/bot${token}/getManagedBotToken`,
        {
          method: "POST",
          timeout: TELEGRAM_REQUEST_TIMEOUT_MS,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: managedBotUserId }),
        },
      );
      return await parseTelegramApiResponse<string>(response);
    },
  };
}

function isAuthorizedTelegramWebhook(req: Request, secret: string): boolean {
  return (req.headers.get(TELEGRAM_WEBHOOK_SECRET_HEADER) ?? "").trim() === secret;
}

export async function handleTelegramManagerBotWebhook(
  req: Request,
  options: TelegramManagerBotHandlerOptions,
): Promise<Response> {
  const botToken = options.botToken.trim();
  const webhookSecret = options.webhookSecret.trim();
  if (!botToken) {
    throw new ValidationError(
      "Telegram manager bot webhook requires a non-empty bot token.",
      "telegram_manager_bot",
    );
  }
  if (!webhookSecret) {
    throw new ValidationError(
      "Telegram manager bot webhook requires a non-empty webhook secret.",
      "telegram_manager_bot",
    );
  }
  if (!isAuthorizedTelegramWebhook(req, webhookSecret)) {
    return Response.json({ error: "Unauthorized Telegram manager bot webhook request." }, {
      status: 401,
    });
  }

  let body: TelegramUpdate;
  try {
    body = await req.json() as TelegramUpdate;
  } catch {
    return Response.json({ error: "Invalid Telegram manager bot webhook payload." }, {
      status: 400,
    });
  }
  const managedBot = body.managed_bot;
  const ownerUserId = managedBot?.user?.id;
  const bot = managedBot?.bot;
  const rawBotId = bot?.id;
  const botUsername = bot?.username?.trim();
  logTelegramManagerWebhook("received", {
    updateId: body.update_id ?? null,
    ownerUserId: Number.isInteger(ownerUserId) ? ownerUserId : null,
    botId: Number.isInteger(rawBotId) ? rawBotId : null,
    botUsername: botUsername ?? null,
  });
  if (!Number.isInteger(rawBotId) || !botUsername) {
    logTelegramManagerWebhook("ignored", {
      reason: "missing-bot-id-or-username",
    });
    return Response.json({ ok: true, ignored: true }, { status: 200 });
  }
  const botId = rawBotId as number;

  try {
    logTelegramManagerWebhook("get-token-start", {
      ownerUserId: Number.isInteger(ownerUserId) ? ownerUserId : null,
      botId,
      botUsername,
    });
    const token = await (options.api ?? createTelegramManagerBotApi()).getManagedBotToken(
      botToken,
      botId,
    );
    logTelegramManagerWebhook("get-token-success", {
      botUsername,
      tokenLength: token.length,
    });
    const session = await options.service.completeSessionForBotUsername({
      botUsername,
      token,
      username: botUsername,
    });
    if (!session) {
      logTelegramManagerWebhook("complete-unmatched", {
        botUsername,
      });
      return Response.json({ ok: true, matched: false }, { status: 200 });
    }

    logTelegramManagerWebhook("complete-success", {
      sessionId: session.sessionId,
      botUsername,
      state: session.state,
    });
    return Response.json({ ok: true, session }, { status: 200 });
  } catch (error) {
    logTelegramManagerWebhook("error", {
      botUsername: botUsername ?? null,
      ownerUserId: Number.isInteger(ownerUserId) ? ownerUserId : null,
      botId,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
