import { assertEquals } from "jsr:@std/assert";
import {
  createTranscriptState,
  reduceTranscriptState,
} from "../../../src/hlvm/cli/agent-transcript-state.ts";

Deno.test("transcript lanes: hql eval during an active turn stays out of agent transcript items", () => {
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

  assertEquals(state.items.some((item) => item.type === "hql_eval"), false);
  assertEquals(state.evalHistory.length, 1);
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
  });

  assertEquals(state.currentTurnId, undefined);
});
