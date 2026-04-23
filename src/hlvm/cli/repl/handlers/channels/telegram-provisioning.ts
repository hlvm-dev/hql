import {
  telegramProvisioning,
  type TelegramProvisioningService,
} from "../../../../channels/telegram/provisioning.ts";
import type {
  TelegramProvisioningCompleteRequest,
  TelegramProvisioningCreateRequest,
} from "../../../../channels/telegram/protocol.ts";
import { jsonError, parseJsonBody } from "../../http-utils.ts";

export interface TelegramProvisioningDeps {
  service?: TelegramProvisioningService;
}

function getService(deps: TelegramProvisioningDeps): TelegramProvisioningService {
  return deps.service ?? telegramProvisioning;
}

export async function handleTelegramProvisioningCreate(
  req: Request,
  deps: TelegramProvisioningDeps = {},
): Promise<Response> {
  const parsed = await parseJsonBody<TelegramProvisioningCreateRequest>(
    req,
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.value ?? {};

  if (
    (body.managerBotUsername !== undefined &&
      typeof body.managerBotUsername !== "string") ||
    (body.botName !== undefined && typeof body.botName !== "string") ||
    (body.botUsername !== undefined && typeof body.botUsername !== "string")
  ) {
    return jsonError("Body fields must be strings when provided", 400);
  }

  const session = await getService(deps).createSession(body);
  return Response.json(session, { status: 201 });
}

export function handleTelegramProvisioningGet(
  _req: Request,
  deps: TelegramProvisioningDeps = {},
): Response {
  const session = getService(deps).getSession();
  if (!session) {
    return jsonError("No active Telegram provisioning session", 404);
  }
  return Response.json(session, { status: 200 });
}

export async function handleTelegramProvisioningComplete(
  req: Request,
  deps: TelegramProvisioningDeps = {},
): Promise<Response> {
  const parsed = await parseJsonBody<TelegramProvisioningCompleteRequest>(
    req,
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  if (
    !body ||
    typeof body.sessionId !== "string" ||
    typeof body.token !== "string" ||
    body.sessionId.trim().length === 0 ||
    body.token.trim().length === 0 ||
    (body.username !== undefined && typeof body.username !== "string")
  ) {
    return jsonError(
      "Body must include sessionId: string and token: non-empty string",
      400,
    );
  }

  try {
    const result = await getService(deps).completeSession(body);
    if (!result) {
      return jsonError("Telegram provisioning session not found", 404);
    }
    return Response.json(result, { status: 200 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return jsonError(detail, 400);
  }
}

export function handleTelegramProvisioningCancel(
  _req: Request,
  deps: TelegramProvisioningDeps = {},
): Response {
  return Response.json(
    { cancelled: getService(deps).cancelSession() },
    { status: 200 },
  );
}
