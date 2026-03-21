import { assertEquals } from "jsr:@std/assert@1";
import { FakeTime } from "jsr:@std/testing@1/time";
import {
  conversationMotionStore,
} from "../../../src/hlvm/cli/repl-ink/hooks/useConversationMotion.ts";
import {
  CONVERSATION_SPINNER_INTERVAL_MS,
} from "../../../src/hlvm/cli/repl-ink/ui-constants.ts";

Deno.test("conversationMotionStore runs a single timer for all active consumers and cleans up when idle", () => {
  const time = new FakeTime();
  conversationMotionStore.resetForTest();

  try {
    const consumerA = Symbol("a");
    const consumerB = Symbol("b");
    const snapshots: number[] = [];
    const unsubscribe = conversationMotionStore.subscribe(() => {
      snapshots.push(conversationMotionStore.getSnapshot());
    });

    conversationMotionStore.setConsumerActive(consumerA, true);
    assertEquals(
      conversationMotionStore.getDebugState().intervalStartCount,
      1,
    );

    conversationMotionStore.setConsumerActive(consumerB, true);
    assertEquals(
      conversationMotionStore.getDebugState().intervalStartCount,
      1,
    );

    time.tick(CONVERSATION_SPINNER_INTERVAL_MS);
    assertEquals(conversationMotionStore.getSnapshot(), 1);
    assertEquals(snapshots.at(-1), 1);

    conversationMotionStore.setConsumerActive(consumerA, false);
    assertEquals(
      conversationMotionStore.getDebugState().intervalRunning,
      true,
    );

    conversationMotionStore.setConsumerActive(consumerB, false);
    assertEquals(
      conversationMotionStore.getDebugState().intervalRunning,
      false,
    );
    assertEquals(conversationMotionStore.getSnapshot(), 0);

    unsubscribe();
  } finally {
    conversationMotionStore.resetForTest();
    time.restore();
  }
});

Deno.test("conversationMotionStore starts a new timer only after the previous one fully stops", () => {
  const time = new FakeTime();
  conversationMotionStore.resetForTest();

  try {
    const consumer = Symbol("consumer");
    conversationMotionStore.setConsumerActive(consumer, true);
    conversationMotionStore.setConsumerActive(consumer, false);
    conversationMotionStore.setConsumerActive(consumer, true);

    assertEquals(
      conversationMotionStore.getDebugState().intervalStartCount,
      2,
    );

    time.tick(CONVERSATION_SPINNER_INTERVAL_MS);
    assertEquals(conversationMotionStore.getSnapshot(), 1);
  } finally {
    conversationMotionStore.resetForTest();
    time.restore();
  }
});
