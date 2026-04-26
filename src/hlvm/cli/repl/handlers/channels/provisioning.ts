import type { RouteParams } from "../../http-router.ts";
import { jsonError } from "../../http-utils.ts";
import { traceChannelDiagnostic } from "../../../../channels/core/trace.ts";
import {
  handleTelegramProvisioningCancel,
  handleTelegramProvisioningComplete,
  handleTelegramProvisioningCreate,
  handleTelegramProvisioningGet,
} from "./telegram-provisioning.ts";

interface ChannelProvisioningRouteHandlers {
  create(req: Request): Promise<Response>;
  get(req: Request): Response | Promise<Response>;
  complete(req: Request): Promise<Response>;
  cancel(req: Request): Response | Promise<Response>;
}

export interface ChannelProvisioningRouteDeps {
  handlers?: Record<string, ChannelProvisioningRouteHandlers>;
}

const defaultHandlers: Record<string, ChannelProvisioningRouteHandlers> = {
  telegram: {
    create: handleTelegramProvisioningCreate,
    get: handleTelegramProvisioningGet,
    complete: handleTelegramProvisioningComplete,
    cancel: handleTelegramProvisioningCancel,
  },
};

function traceProvisioningRoute(
  params: RouteParams,
  event: string,
  data: Record<string, unknown> = {},
): void {
  if (!params.channel) return;
  traceChannelDiagnostic(params.channel, "http-provisioning", event, data);
}

function resolveHandlers(
  params: RouteParams,
  deps: ChannelProvisioningRouteDeps,
): ChannelProvisioningRouteHandlers | Response {
  const channel = params.channel;
  if (!channel) return jsonError("Missing :channel path parameter", 400);
  const handlers = (deps.handlers ?? defaultHandlers)[channel];
  if (!handlers) {
    traceProvisioningRoute(params, "unsupported-channel", { channel });
    return jsonError(`Unsupported channel provisioning route: ${channel}`, 404);
  }
  return handlers;
}

export async function handleChannelProvisioningCreate(
  req: Request,
  params: RouteParams,
  deps: ChannelProvisioningRouteDeps = {},
): Promise<Response> {
  traceProvisioningRoute(params, "create");
  const handlers = resolveHandlers(params, deps);
  if (handlers instanceof Response) return handlers;
  return await handlers.create(req);
}

export async function handleChannelProvisioningGet(
  req: Request,
  params: RouteParams,
  deps: ChannelProvisioningRouteDeps = {},
): Promise<Response> {
  traceProvisioningRoute(params, "get");
  const handlers = resolveHandlers(params, deps);
  if (handlers instanceof Response) return handlers;
  return await handlers.get(req);
}

export async function handleChannelProvisioningComplete(
  req: Request,
  params: RouteParams,
  deps: ChannelProvisioningRouteDeps = {},
): Promise<Response> {
  traceProvisioningRoute(params, "complete");
  const handlers = resolveHandlers(params, deps);
  if (handlers instanceof Response) return handlers;
  return await handlers.complete(req);
}

export async function handleChannelProvisioningCancel(
  req: Request,
  params: RouteParams,
  deps: ChannelProvisioningRouteDeps = {},
): Promise<Response> {
  traceProvisioningRoute(params, "cancel");
  const handlers = resolveHandlers(params, deps);
  if (handlers instanceof Response) return handlers;
  return await handlers.cancel(req);
}
