import { RuntimeError, ValidationError } from "../../../common/error.ts";
import { getEnvVar } from "../../../common/paths.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { createRouter } from "../../cli/repl/http-router.ts";
import { jsonError } from "../../cli/repl/http-utils.ts";
import { traceChannelDiagnostic } from "../core/trace.ts";
import {
  getDefaultLineProvisioningBridgeService,
  handleLineBridgeEvents,
  handleLineBridgeSendMessage,
  handleLineBridgeWebhook,
  handleLineProvisioningBridgeRegister,
  type LineProvisioningBridgeService,
} from "./provisioning-bridge-service.ts";

const DEFAULT_PORT = 8789;

export interface LineProvisioningBridgeServerOptions {
  port?: number;
  hostname?: string;
  officialAccountId: string;
  channelAccessToken: string;
  channelSecret: string;
  service?: LineProvisioningBridgeService;
}

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
  throw new ValidationError(
    `Invalid LINE bridge port: ${value}`,
    "line_bridge_server",
  );
}

function requireEnv(name: string): string {
  const value = getEnvVar(name)?.trim() ?? "";
  if (!value) {
    throw new ValidationError(`${name} is required.`, "line_bridge_server");
  }
  return value;
}

function traceLineBridgeServer(
  event: string,
  data: Record<string, unknown>,
): void {
  traceChannelDiagnostic("line", "bridge-server", event, data);
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

async function verifyLineSignature(
  body: Uint8Array,
  signature: string,
  channelSecret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = new ArrayBuffer(body.byteLength);
  new Uint8Array(data).set(body);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  const expected = btoa(String.fromCharCode(...digest));
  return timingSafeEqual(
    new TextEncoder().encode(expected),
    new TextEncoder().encode(signature.trim()),
  );
}

async function parseVerifiedWebhookPayload(
  req: Request,
  channelSecret: string,
): Promise<unknown | Response> {
  const body = new Uint8Array(await req.arrayBuffer());
  const signature = req.headers.get("x-line-signature") ?? "";
  if (
    !signature || !await verifyLineSignature(body, signature, channelSecret)
  ) {
    traceLineBridgeServer("webhook-signature-rejected", {
      hasSignature: !!signature,
      bodyBytes: body.byteLength,
    });
    return jsonError("Invalid LINE webhook signature.", 401);
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    traceLineBridgeServer("webhook-json-rejected", {
      bodyBytes: body.byteLength,
    });
    return jsonError("Invalid LINE webhook JSON.", 400);
  }
}

export function createLineProvisioningBridgeHandler(
  options: LineProvisioningBridgeServerOptions,
): (req: Request) => Promise<Response> {
  const officialAccountId = options.officialAccountId.trim();
  const channelAccessToken = options.channelAccessToken.trim();
  const channelSecret = options.channelSecret.trim();
  if (!officialAccountId || !channelAccessToken || !channelSecret) {
    throw new ValidationError(
      "LINE bridge requires officialAccountId, channelAccessToken, and channelSecret.",
      "line_bridge_server",
    );
  }

  const deps = {
    service: options.service,
    officialAccountId,
    channelAccessToken,
  };
  const router = createRouter();
  router.add("GET", "/health", () => Response.json({ ok: true }));
  router.add(
    "POST",
    "/api/line/provisioning/session",
    (req) => handleLineProvisioningBridgeRegister(req, deps),
  );
  router.add(
    "GET",
    "/api/line/events",
    (req) => handleLineBridgeEvents(req, deps),
  );
  router.add(
    "POST",
    "/api/line/message/push",
    (req) => handleLineBridgeSendMessage(req, deps),
  );
  router.add(
    "POST",
    "/api/line/webhook",
    async (req) => {
      const payload = await parseVerifiedWebhookPayload(req, channelSecret);
      if (payload instanceof Response) return payload;
      return await handleLineBridgeWebhook(payload, deps);
    },
  );

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    traceLineBridgeServer("incoming-request", {
      method: req.method,
      path: url.pathname,
    });
    const match = router.match(req.method, url.pathname);
    if (!match) {
      traceLineBridgeServer("route-not-found", {
        method: req.method,
        path: url.pathname,
      });
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return await match.handler(req, match.params);
  };
}

export function startLineProvisioningBridgeServer(
  options: LineProvisioningBridgeServerOptions,
): { finished: Promise<void>; shutdown(): Promise<void> } {
  const port = options.port ?? DEFAULT_PORT;
  const hostname = options.hostname?.trim() || "0.0.0.0";
  const handler = createLineProvisioningBridgeHandler(options);
  const server = getPlatform().http.serveWithHandle?.(handler, {
    port,
    hostname,
    onListen: ({ hostname, port }) => {
      log.info(
        `LINE provisioning bridge listening on http://${hostname}:${port}`,
      );
    },
  });
  if (server) return server;

  return {
    finished: getPlatform().http.serve(handler, {
      port,
      hostname,
      onListen: ({ hostname, port }) => {
        log.info(
          `LINE provisioning bridge listening on http://${hostname}:${port}`,
        );
      },
    }),
    shutdown: async () => {
      throw new RuntimeError(
        "LINE provisioning bridge shutdown is unavailable.",
      );
    },
  };
}

export function resolveLineProvisioningBridgeServerOptionsFromEnv(): LineProvisioningBridgeServerOptions {
  const officialAccountId = requireEnv("HLVM_LINE_OFFICIAL_ACCOUNT_ID");
  const channelAccessToken = requireEnv("HLVM_LINE_CHANNEL_ACCESS_TOKEN");
  const channelSecret = requireEnv("HLVM_LINE_CHANNEL_SECRET");
  return {
    officialAccountId,
    channelAccessToken,
    channelSecret,
    port: parsePort(getEnvVar("PORT")),
    hostname: getEnvVar("HOST")?.trim() || "0.0.0.0",
  };
}

if (import.meta.main) {
  const server = startLineProvisioningBridgeServer(
    {
      ...resolveLineProvisioningBridgeServerOptionsFromEnv(),
      service: await getDefaultLineProvisioningBridgeService({
        officialAccountId: requireEnv("HLVM_LINE_OFFICIAL_ACCOUNT_ID"),
        channelAccessToken: requireEnv("HLVM_LINE_CHANNEL_ACCESS_TOKEN"),
      }),
    },
  );
  await server.finished;
}
