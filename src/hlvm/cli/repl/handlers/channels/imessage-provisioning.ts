import {
  imessageProvisioning,
  type IMessageProvisioningService,
} from "../../../../channels/imessage/provisioning.ts";
import type {
  IMessageProvisioningCompleteRequest,
  IMessageProvisioningCreateRequest,
} from "../../../../channels/imessage/protocol.ts";
import { jsonError, parseJsonBody } from "../../http-utils.ts";

export interface IMessageProvisioningDeps {
  service?: IMessageProvisioningService;
}

function getService(
  deps: IMessageProvisioningDeps,
): IMessageProvisioningService {
  return deps.service ?? imessageProvisioning;
}

export async function handleIMessageProvisioningCreate(
  req: Request,
  deps: IMessageProvisioningDeps = {},
): Promise<Response> {
  const parsed = await parseJsonBody<IMessageProvisioningCreateRequest>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value ?? {};

  if (body.recipientId !== undefined && typeof body.recipientId !== "string") {
    return jsonError("recipientId must be a string when provided", 400);
  }

  try {
    const session = await getService(deps).createSession(body);
    return Response.json(session, { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return jsonError(detail, 500);
  }
}

export function handleIMessageProvisioningGet(
  _req: Request,
  deps: IMessageProvisioningDeps = {},
): Response {
  const session = getService(deps).getSession();
  if (!session) {
    return jsonError("No active iMessage provisioning session", 404);
  }
  return Response.json(session, { status: 200 });
}

export async function handleIMessageProvisioningComplete(
  req: Request,
  deps: IMessageProvisioningDeps = {},
): Promise<Response> {
  const parsed = await parseJsonBody<IMessageProvisioningCompleteRequest>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  if (!body || typeof body.sessionId !== "string" || !body.sessionId.trim()) {
    return jsonError("Body must include sessionId: string", 400);
  }

  const result = await getService(deps).completeSession(body);
  if (!result) {
    return jsonError("iMessage provisioning session not found", 404);
  }
  return Response.json(result, { status: 200 });
}

export function handleIMessageProvisioningCancel(
  _req: Request,
  deps: IMessageProvisioningDeps = {},
): Response {
  return Response.json(
    { cancelled: getService(deps).cancelSession() },
    { status: 200 },
  );
}
