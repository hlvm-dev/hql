import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  CONVERSATION_SPINNER_INTERVAL_MS,
  SPINNER_FRAMES,
} from "../ui-constants.ts";

type Listener = () => void;

const listeners = new Set<Listener>();
const activeConsumers = new Set<symbol>();

let frameIndex = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let intervalStartCount = 0;

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function syncTicker(): void {
  if (activeConsumers.size > 0) {
    if (intervalId === null) {
      intervalStartCount += 1;
      intervalId = setInterval(() => {
        frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
        notifyListeners();
      }, CONVERSATION_SPINNER_INTERVAL_MS);
    }
    return;
  }

  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }

  if (frameIndex !== 0) {
    frameIndex = 0;
    notifyListeners();
  }
}

function setConsumerActive(id: symbol, active: boolean): void {
  if (active) {
    activeConsumers.add(id);
  } else {
    activeConsumers.delete(id);
  }
  syncTicker();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function subscribeInactive(): () => void {
  return () => {};
}

function getSpinnerSnapshot(): number {
  return frameIndex;
}

function getInactiveSnapshot(): number {
  return 0;
}

export const conversationMotionStore = {
  subscribe,
  getSnapshot: getSpinnerSnapshot,
  setConsumerActive,
  getDebugState: () => ({
    activeConsumerCount: activeConsumers.size,
    listenerCount: listeners.size,
    frameIndex,
    intervalRunning: intervalId !== null,
    intervalStartCount,
  }),
  resetForTest: () => {
    activeConsumers.clear();
    listeners.clear();
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    frameIndex = 0;
    intervalStartCount = 0;
  },
} as const;

export function useConversationSpinnerFrame(
  active: boolean,
): string | undefined {
  const consumerIdRef = useRef<symbol>(Symbol("conversation-spinner"));
  const snapshot = useSyncExternalStore(
    active ? subscribe : subscribeInactive,
    active ? getSpinnerSnapshot : getInactiveSnapshot,
    getInactiveSnapshot,
  );

  useEffect(() => {
    const consumerId = consumerIdRef.current;
    conversationMotionStore.setConsumerActive(consumerId, active);
    return () => conversationMotionStore.setConsumerActive(consumerId, false);
  }, [active]);

  return active ? SPINNER_FRAMES[snapshot] : undefined;
}
