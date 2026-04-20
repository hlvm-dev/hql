import { log } from "../../api/log.ts";
import type {
  ChannelMessage,
  ChannelReply,
  ChannelTransportContext,
} from "../core/types.ts";

type OutboxListener = (reply: ChannelReply) => void;

let activeContext: ChannelTransportContext | null = null;
const outboxListeners = new Set<OutboxListener>();

export function setActiveContext(ctx: ChannelTransportContext): void {
  activeContext = ctx;
}

export function clearActiveContext(): void {
  activeContext = null;
}

export function hasActiveContext(): boolean {
  return activeContext !== null;
}

export async function pushInbound(message: ChannelMessage): Promise<void> {
  if (!activeContext) {
    throw new Error("Messages channel not connected");
  }
  await activeContext.receive(message);
}

export function emitOutbox(reply: ChannelReply): void {
  if (outboxListeners.size === 0) {
    // Reply would vanish into a black hole. Throwing here propagates to
    // the runtime's handleInboundMessage catch-block, which flips status
    // to "error" with this message as lastError — this is load-bearing,
    // because the runtime overwrites status to "connected" right after a
    // successful send. We deliberately do not buffer replies for later:
    // stale iMessages sent minutes later would be worse UX than a
    // visible error.
    log.warn?.(
      `messages outbox has no subscriber; dropping reply to ${reply.remoteId}`,
    );
    throw new Error("no outbox subscriber");
  }
  for (const listener of outboxListeners) {
    try {
      listener(reply);
    } catch {
      // Listener errors must not block the transport.
    }
  }
}

export function subscribeOutbox(listener: OutboxListener): () => void {
  const wasEmpty = outboxListeners.size === 0;
  outboxListeners.add(listener);
  if (wasEmpty && activeContext) {
    activeContext.setStatus({ state: "connected", lastError: null });
  }
  return () => outboxListeners.delete(listener);
}

// Test-only: module-level state persists across tests in the same
// Deno process. Call from each test to prevent cross-test bleeding.
export function resetForTesting(): void {
  activeContext = null;
  outboxListeners.clear();
}
