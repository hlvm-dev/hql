import {
  lineProvisioning,
  type LineProvisioningService,
} from "../../../../channels/line/provisioning.ts";
import type {
  LineProvisioningCompleteRequest,
  LineProvisioningCreateRequest,
} from "../../../../channels/line/protocol.ts";
import { jsonError, parseJsonBody } from "../../http-utils.ts";

export interface LineProvisioningDeps {
  service?: LineProvisioningService;
}

function getService(deps: LineProvisioningDeps): LineProvisioningService {
  return deps.service ?? lineProvisioning;
}

export async function handleLineProvisioningCreate(
  req: Request,
  deps: LineProvisioningDeps = {},
): Promise<Response> {
  const parsed = await parseJsonBody<LineProvisioningCreateRequest>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value ?? {};

  if (
    body.officialAccountId !== undefined &&
    typeof body.officialAccountId !== "string"
  ) {
    return jsonError("officialAccountId must be a string when provided", 400);
  }

  const session = await getService(deps).createSession(body);
  return Response.json(session, { status: 201 });
}

export function handleLineProvisioningGet(
  _req: Request,
  deps: LineProvisioningDeps = {},
): Response {
  const session = getService(deps).getSession();
  if (!session) return jsonError("No active LINE provisioning session", 404);
  return Response.json(session, { status: 200 });
}

export async function handleLineProvisioningComplete(
  req: Request,
  deps: LineProvisioningDeps = {},
): Promise<Response> {
  const parsed = await parseJsonBody<LineProvisioningCompleteRequest>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  if (!body || typeof body.sessionId !== "string" || !body.sessionId.trim()) {
    return jsonError("Body must include sessionId: string", 400);
  }
  const result = await getService(deps).completeSession(body);
  if (!result) return jsonError("LINE provisioning session not found", 404);
  return Response.json(result, { status: 200 });
}

export function handleLineProvisioningCancel(
  _req: Request,
  deps: LineProvisioningDeps = {},
): Response {
  return Response.json(
    { cancelled: getService(deps).cancelSession() },
    { status: 200 },
  );
}

