import {
  cancelBackgroundAgent,
  getBackgroundAgentSnapshots,
} from "../../../agent/tools/agent-tool.ts";
import { jsonError, parseJsonBody } from "../http-utils.ts";

export function handleListBackgroundAgents(): Response {
  return Response.json({ agents: getBackgroundAgentSnapshots() });
}

export async function handleCancelBackgroundAgent(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<{ agent_id?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const agentId = parsed.value.agent_id?.trim();
  if (!agentId) return jsonError("Missing agent_id", 400);
  return Response.json({
    agent_id: agentId,
    cancelled: cancelBackgroundAgent(agentId),
  });
}
