import {
  completeGuiChannelTurn,
  failGuiChannelTurn,
  subscribeGuiChannelTurns,
} from "../../../../channels/core/gui-turn-bridge.ts";
import { traceChannelDiagnostic } from "../../../../channels/core/trace.ts";
import {
  createSSEResponse,
  formatSSE,
  jsonError,
  parseJsonBody,
} from "../../http-utils.ts";

interface CompleteBody {
  request_id: string;
  text: string;
}

interface FailBody {
  request_id: string;
  message: string;
}

let sequence = 0;

export function handleChannelTurnsStream(req: Request): Response {
  return createSSEResponse(
    req,
    (emit) =>
      subscribeGuiChannelTurns((request) => {
        traceChannelDiagnostic("gui-turn", "http", "stream-emit", {
          requestId: request.request_id,
          channel: request.channel,
          remoteId: request.remote_id,
          textLength: request.text.length,
        });
        emit(formatSSE({
          id: ++sequence,
          event_type: "channel_turn_requested",
          data: request,
        }));
      }),
  );
}

export async function handleChannelTurnComplete(
  req: Request,
): Promise<Response> {
  const parsed = await parseJsonBody<CompleteBody>(req);
  if (!parsed.ok) return parsed.response;

  const body = parsed.value;
  if (!body || typeof body.request_id !== "string") {
    return jsonError("Body must include request_id: string", 400);
  }
  if (typeof body.text !== "string") {
    return jsonError("Body must include text: string", 400);
  }

  const completed = completeGuiChannelTurn(body.request_id, body.text);
  traceChannelDiagnostic("gui-turn", "http", "complete-request", {
    requestId: body.request_id,
    textLength: body.text.length,
    completed,
  });
  if (!completed) return jsonError("Unknown channel turn request", 404);
  return Response.json({ completed: true });
}

export async function handleChannelTurnFail(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<FailBody>(req);
  if (!parsed.ok) return parsed.response;

  const body = parsed.value;
  if (!body || typeof body.request_id !== "string") {
    return jsonError("Body must include request_id: string", 400);
  }
  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    return jsonError("Body must include message: non-empty string", 400);
  }

  const failed = failGuiChannelTurn(body.request_id, body.message);
  traceChannelDiagnostic("gui-turn", "http", "fail-request", {
    requestId: body.request_id,
    message: body.message,
    failed,
  });
  if (!failed) return jsonError("Unknown channel turn request", 404);
  return Response.json({ failed: true });
}
