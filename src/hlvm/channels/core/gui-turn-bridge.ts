import { traceChannelDiagnostic } from "./trace.ts";

export interface GuiChannelTurnRequest {
  request_id: string;
  channel: string;
  remote_id: string;
  session_id: string;
  text: string;
  sender_id?: string;
  sender_display?: string;
}

export interface GuiChannelTurnInput {
  query: string;
  channel: string;
  remoteId: string;
  sessionId: string;
  senderId?: string;
  senderDisplay?: string;
}

type GuiChannelTurnSubscriber = (request: GuiChannelTurnRequest) => void;

export class GuiChannelTurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuiChannelTurnError";
  }
}

const subscribers = new Set<GuiChannelTurnSubscriber>();
const pending = new Map<
  string,
  {
    resolve: (result: { text: string }) => void;
    reject: (error: Error) => void;
  }
>();

export function subscribeGuiChannelTurns(
  subscriber: GuiChannelTurnSubscriber,
): () => void {
  subscribers.add(subscriber);
  traceChannelDiagnostic("gui-turn", "bridge", "subscriber-added", {
    subscriberCount: subscribers.size,
  });
  return () => {
    subscribers.delete(subscriber);
    traceChannelDiagnostic("gui-turn", "bridge", "subscriber-removed", {
      subscriberCount: subscribers.size,
    });
  };
}

export function hasGuiChannelTurnSubscriber(): boolean {
  return subscribers.size > 0;
}

export function requestGuiChannelTurn(
  input: GuiChannelTurnInput,
): Promise<{ text: string }> {
  if (!hasGuiChannelTurnSubscriber()) {
    traceChannelDiagnostic("gui-turn", "bridge", "request-rejected", {
      channel: input.channel,
      remoteId: input.remoteId,
      reason: "no-subscriber",
    });
    throw new GuiChannelTurnError(
      "HLVM GUI is not connected. Open HLVM to use mobile message channels.",
    );
  }

  const request: GuiChannelTurnRequest = {
    request_id: crypto.randomUUID(),
    channel: input.channel,
    remote_id: input.remoteId,
    session_id: input.sessionId,
    text: input.query,
    ...(input.senderId ? { sender_id: input.senderId } : {}),
    ...(input.senderDisplay ? { sender_display: input.senderDisplay } : {}),
  };

  return new Promise((resolve, reject) => {
    pending.set(request.request_id, { resolve, reject });
    traceChannelDiagnostic("gui-turn", "bridge", "request-created", {
      requestId: request.request_id,
      channel: request.channel,
      remoteId: request.remote_id,
      sessionId: request.session_id,
      textLength: request.text.length,
      subscriberCount: subscribers.size,
      pendingCount: pending.size,
    });
    for (const subscriber of subscribers) {
      subscriber(request);
    }
  });
}

export function completeGuiChannelTurn(
  requestId: string,
  text: string,
): boolean {
  const entry = pending.get(requestId);
  if (!entry) {
    traceChannelDiagnostic("gui-turn", "bridge", "complete-missing", {
      requestId,
      textLength: text.length,
      pendingCount: pending.size,
    });
    return false;
  }
  pending.delete(requestId);
  entry.resolve({ text });
  traceChannelDiagnostic("gui-turn", "bridge", "complete", {
    requestId,
    textLength: text.length,
    pendingCount: pending.size,
  });
  return true;
}

export function failGuiChannelTurn(
  requestId: string,
  message: string,
): boolean {
  const entry = pending.get(requestId);
  if (!entry) {
    traceChannelDiagnostic("gui-turn", "bridge", "fail-missing", {
      requestId,
      message,
      pendingCount: pending.size,
    });
    return false;
  }
  pending.delete(requestId);
  entry.reject(new GuiChannelTurnError(message));
  traceChannelDiagnostic("gui-turn", "bridge", "fail", {
    requestId,
    message,
    pendingCount: pending.size,
  });
  return true;
}
