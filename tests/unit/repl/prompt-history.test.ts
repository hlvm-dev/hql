import { assertEquals } from "jsr:@std/assert";
import {
  recordPromptHistory,
  shouldRecordPromptHistory,
} from "../../../src/hlvm/cli/repl/prompt-history.ts";

Deno.test("prompt history records all submission sources", () => {
  assertEquals(shouldRecordPromptHistory("evaluate"), true);
  assertEquals(shouldRecordPromptHistory("command"), true);
  assertEquals(shouldRecordPromptHistory("conversation"), true);
  assertEquals(shouldRecordPromptHistory("interaction"), true);
});

Deno.test("recordPromptHistory forwards all submissions to repl state", () => {
  const recorded: string[] = [];
  const replState = {
    addHistory(input: string) {
      recorded.push(input);
    },
  };

  recordPromptHistory(replState, "open ~/Desktop", "conversation");
  recordPromptHistory(replState, "/help", "command");
  recordPromptHistory(replState, "(+ 1 2)", "evaluate");

  assertEquals(recorded, ["open ~/Desktop", "/help", "(+ 1 2)"]);
});
