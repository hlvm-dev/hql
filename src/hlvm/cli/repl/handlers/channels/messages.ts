import {
  createSSEResponse,
  formatSSE,
  jsonError,
  parseJsonBody,
} from "../../http-utils.ts";
import * as bridge from "../../../../channels/messages/bridge.ts";
import type {
  ChannelMessage,
  ChannelReply,
} from "../../../../channels/core/types.ts";

interface InboundBody {
  remoteId: string;
  text: string;
  sender?: { id: string; display?: string };
  raw?: unknown;
}

export async function handleMessagesInbound(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<InboundBody>(req);
  if (!parsed.ok) return parsed.response;

  const body = parsed.value;
  if (
    !body ||
    typeof body.remoteId !== "string" ||
    typeof body.text !== "string"
  ) {
    return jsonError(
      "Body must include remoteId: string and text: string",
      400,
    );
  }

  if (!bridge.hasActiveContext()) {
    return jsonError("Messages channel not enabled", 409);
  }

  const message: ChannelMessage = {
    channel: "messages",
    remoteId: body.remoteId,
    text: body.text,
    sender: body.sender,
    raw: body.raw,
  };

  try {
    await bridge.pushInbound(message);
    return Response.json({ accepted: true }, { status: 202 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return jsonError(detail, 500);
  }
}

export function handleMessagesOutbox(req: Request): Response {
  let seq = 0;
  return createSSEResponse(req, (emit) => {
    const send = (reply: ChannelReply): void => {
      emit(formatSSE({
        id: ++seq,
        event_type: "messages_outbox",
        data: reply,
      }));
    };
    return bridge.subscribeOutbox(send);
  });
}
