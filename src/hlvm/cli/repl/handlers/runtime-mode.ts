import {
  loadPersistedAgentSessionMetadata,
  persistAgentRuntimeMode,
} from "../../../agent/persisted-transcript.ts";
import {
  normalizeRuntimeMode,
  resolveRuntimeMode,
  type RuntimeMode,
} from "../../../agent/runtime-mode.ts";
import { getActiveConversationSessionId } from "../../../store/active-conversation.ts";
import { jsonError, parseJsonBody } from "../http-utils.ts";

interface RuntimeModeResponse {
  session_id: string;
  runtime_mode: RuntimeMode;
}

export function handleGetActiveConversationRuntimeMode(): Response {
  const sessionId = getActiveConversationSessionId();
  const metadata = loadPersistedAgentSessionMetadata(sessionId);
  return Response.json(
    {
      session_id: sessionId,
      runtime_mode: resolveRuntimeMode(metadata.runtimeMode),
    } satisfies RuntimeModeResponse,
  );
}

export async function handleSetActiveConversationRuntimeMode(
  req: Request,
): Promise<Response> {
  const parsed = await parseJsonBody<{ runtime_mode?: unknown }>(req);
  if (!parsed.ok) return parsed.response;

  const runtimeMode = normalizeRuntimeMode(parsed.value.runtime_mode);
  if (!runtimeMode) {
    return jsonError("runtime_mode must be 'manual' or 'auto'", 400);
  }

  const sessionId = getActiveConversationSessionId();
  persistAgentRuntimeMode(sessionId, runtimeMode);

  return Response.json(
    {
      session_id: sessionId,
      runtime_mode: runtimeMode,
    } satisfies RuntimeModeResponse,
  );
}
