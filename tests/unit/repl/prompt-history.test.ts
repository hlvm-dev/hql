import { assertEquals } from "jsr:@std/assert";
import {
  recordPromptHistory,
  shouldRecordPromptHistory,
} from "../../../src/hlvm/cli/repl/prompt-history.ts";

Deno.test("prompt history policy skips only local evaluate submissions", () => {
  assertEquals(shouldRecordPromptHistory("evaluate"), false);
  assertEquals(shouldRecordPromptHistory("command"), true);
  assertEquals(shouldRecordPromptHistory("conversation"), true);
  assertEquals(shouldRecordPromptHistory("interaction"), true);
});

Deno.test("recordPromptHistory forwards non-evaluate submissions to repl state", () => {
  const recorded: string[] = [];
  const replState = {
    addHistory(input: string) {
      recorded.push(input);
    },
  };

  recordPromptHistory(replState, "open ~/Desktop", "conversation");
  recordPromptHistory(replState, "/help", "command");
  recordPromptHistory(replState, "(+ 1 2)", "evaluate");

  assertEquals(recorded, ["open ~/Desktop", "/help"]);
});
