import { assertEquals } from "jsr:@std/assert";
import {
  createTranscriptState,
  reduceTranscriptState,
} from "../../../src/hlvm/cli/agent-transcript-state.ts";

Deno.test("transcript lanes: hql eval is committed into transcript items in insertion order", () => {
  let state = createTranscriptState();

  state = reduceTranscriptState(state, {
    type: "user_message",
    text: "hello",
    startTurn: true,
  });
  state = reduceTranscriptState(state, {
    type: "hql_eval",
    input: "(+ 1 1)",
    result: { success: true, value: 2 },
  });

  assertEquals(state.items.some((item) => item.type === "hql_eval"), true);
  assertEquals(state.items.at(-1)?.type, "hql_eval");
});

Deno.test("transcript lanes: finalize clears currentTurnId after promoting the live turn", () => {
  let state = createTranscriptState();

  state = reduceTranscriptState(state, {
    type: "user_message",
    text: "hello",
    startTurn: true,
  });
  state = reduceTranscriptState(state, {
    type: "finalize",
    status: "completed",
  });

  assertEquals(state.currentTurnId, undefined);
});

Deno.test("transcript lanes: targeted finalize preserves a newer active turn", () => {
  const state = {
    ...createTranscriptState(),
    currentTurnId: "turn-2",
    turnCounter: 2,
    items: [
      {
        type: "user" as const,
        id: "u1",
        text: "first",
        ts: 1,
        turnId: "turn-1",
      },
      {
        type: "assistant" as const,
        id: "a1",
        text: "First answer",
        isPending: true,
        ts: 2,
        turnId: "turn-1",
      },
      {
        type: "user" as const,
        id: "u2",
        text: "second",
        ts: 3,
        turnId: "turn-2",
      },
      {
        type: "assistant" as const,
        id: "a2",
        text: "",
        isPending: true,
        ts: 4,
        turnId: "turn-2",
      },
    ],
    nextId: 4,
  };

  const next = reduceTranscriptState(state, {
    type: "finalize",
    status: "completed",
    turnId: "turn-1",
  });

  assertEquals(next.currentTurnId, "turn-2");
  assertEquals(
    next.items.some((item) => item.type === "turn_stats" && item.turnId === "turn-1"),
    true,
  );
  assertEquals(
    next.items.some((item) =>
      item.type === "assistant" && item.turnId === "turn-2" && item.isPending
    ),
    true,
  );
});
