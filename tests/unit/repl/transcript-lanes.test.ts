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
