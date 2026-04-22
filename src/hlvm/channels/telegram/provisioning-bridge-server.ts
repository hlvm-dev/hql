import { buildBearerHeader } from "../../../common/http/auth-headers.ts";
import { RuntimeError, ValidationError } from "../../../common/error.ts";
import { getEnvVar } from "../../../common/paths.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { createRouter } from "../../cli/repl/http-router.ts";
import { logTelegramE2ETrace } from "./e2e-trace.ts";
import {
  createTelegramManagerBotApi,
  handleTelegramManagerBotWebhook,
  type TelegramManagerBotApi,
} from "./manager-bot.ts";
import {
  getDefaultTelegramProvisioningBridgeService,
  handleTelegramProvisioningBridgeClaim,
  handleTelegramProvisioningBridgeComplete,
  handleTelegramProvisioningBridgeRegister,
  handleTelegramProvisioningBridgeStart,
  type TelegramProvisioningBridgeService,
} from "./provisioning-bridge-service.ts";

const DEFAULT_PORT = 8788;

export interface TelegramProvisioningBridgeServerOptions {
  authToken: string;
  port?: number;
  hostname?: string;
  service?: TelegramProvisioningBridgeService;
  managerBotToken?: string;
  managerBotWebhookSecret?: string;
  managerBotApi?: TelegramManagerBotApi;
}

function unauthorizedResponse(): Response {
  logTelegramE2ETrace("bridge-server", "unauthorized-complete-request", {});
  return Response.json(
    { error: "Unauthorized bridge completion request." },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Bearer realm="hlvm-telegram-provisioning-bridge"',
      },
    },
  );
}

function isAuthorized(req: Request, authToken: string): boolean {
  return (req.headers.get("Authorization") ?? "").trim() ===
    buildBearerHeader(authToken).Authorization;
}

export function createTelegramProvisioningBridgeHandler(
  options: TelegramProvisioningBridgeServerOptions,
): (req: Request) => Promise<Response> {
  const authToken = options.authToken.trim();
  if (!authToken) {
    throw new ValidationError(
      "Telegram provisioning bridge requires a non-empty auth token.",
      "telegram_provisioning_bridge_server",
    );
  }

  const managerBotToken = options.managerBotToken?.trim() ?? "";
  const managerBotWebhookSecret = options.managerBotWebhookSecret?.trim() ?? "";
  if (!!managerBotToken !== !!managerBotWebhookSecret) {
    throw new ValidationError(
      "Telegram manager bot webhook requires both managerBotToken and managerBotWebhookSecret.",
      "telegram_provisioning_bridge_server",
    );
  }
  const deps = options.service ? { service: options.service } : {};
  const router = createRouter();
  router.add("GET", "/health", () => Response.json({ ok: true }));
  router.add(
    "POST",
    "/api/telegram/provisioning/session",
    (req) => handleTelegramProvisioningBridgeRegister(req, deps),
  );
  router.add(
    "GET",
    "/telegram/start",
    (req) => handleTelegramProvisioningBridgeStart(req, deps),
  );
  router.add(
    "POST",
    "/api/telegram/provisioning/session/complete",
    (req) =>
      isAuthorized(req, authToken)
        ? handleTelegramProvisioningBridgeComplete(req, deps)
        : unauthorizedResponse(),
  );
  router.add(
    "POST",
    "/api/telegram/provisioning/session/claim",
    (req) => handleTelegramProvisioningBridgeClaim(req, deps),
  );
  if (managerBotToken) {
    router.add(
      "POST",
      "/api/telegram/manager/webhook",
      async (req) =>
        await handleTelegramManagerBotWebhook(req, {
          botToken: managerBotToken,
          webhookSecret: managerBotWebhookSecret,
          service: options.service ?? await getDefaultTelegramProvisioningBridgeService(),
          api: options.managerBotApi ?? createTelegramManagerBotApi(),
        }),
    );
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    logTelegramE2ETrace("bridge-server", "incoming-request", {
      method: req.method,
      path: url.pathname,
    });
    const match = router.match(req.method, url.pathname);
    if (!match) {
      logTelegramE2ETrace("bridge-server", "route-miss", {
        method: req.method,
        path: url.pathname,
      });
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return await match.handler(req, match.params);
  };
}

export function startTelegramProvisioningBridgeServer(
  options: TelegramProvisioningBridgeServerOptions,
): { finished: Promise<void>; shutdown(): Promise<void> } {
  const port = options.port ?? DEFAULT_PORT;
  const hostname = options.hostname?.trim() || "0.0.0.0";
  const handler = createTelegramProvisioningBridgeHandler(options);
  const server = getPlatform().http.serveWithHandle?.(handler, {
    port,
    hostname,
    onListen: ({ hostname, port }) => {
      log.info(`Telegram provisioning bridge listening on http://${hostname}:${port}`);
    },
  });
  if (server) return server;

  return {
    finished: getPlatform().http.serve(handler, {
      port,
      hostname,
      onListen: ({ hostname, port }) => {
        log.info(`Telegram provisioning bridge listening on http://${hostname}:${port}`);
      },
    }),
    shutdown: async () => {
      throw new RuntimeError("Telegram provisioning bridge shutdown is unavailable.");
    },
  };
}

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  throw new ValidationError(
    `Invalid bridge port: ${value}`,
    "telegram_provisioning_bridge_server",
  );
}

export function resolveTelegramProvisioningBridgeServerOptionsFromEnv():
  TelegramProvisioningBridgeServerOptions {
  const authToken = getEnvVar("HLVM_TELEGRAM_PROVISIONING_BRIDGE_AUTH_TOKEN")?.trim() ?? "";
  if (!authToken) {
    throw new ValidationError(
      "HLVM_TELEGRAM_PROVISIONING_BRIDGE_AUTH_TOKEN is required.",
      "telegram_provisioning_bridge_server",
    );
  }
  const hostname = getEnvVar("HOST")?.trim() || "0.0.0.0";
  return {
    authToken,
    port: parsePort(getEnvVar("PORT")),
    hostname,
    managerBotToken: getEnvVar("HLVM_TELEGRAM_MANAGER_BOT_TOKEN")?.trim() ?? undefined,
    managerBotWebhookSecret: getEnvVar("HLVM_TELEGRAM_MANAGER_BOT_WEBHOOK_SECRET")?.trim() ??
      undefined,
  };
}

if (import.meta.main) {
  const server = startTelegramProvisioningBridgeServer(
    resolveTelegramProvisioningBridgeServerOptionsFromEnv(),
  );
  await server.finished;
}
