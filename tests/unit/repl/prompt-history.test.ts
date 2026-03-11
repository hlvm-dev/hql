import { assertEquals } from "jsr:@std/assert";
import {
  buildRecentPromptHistoryContext,
  getRecentPromptEntries,
  isPromptRecencyQuery,
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

Deno.test("prompt history recency helpers detect recency queries and exclude the current input", () => {
  assertEquals(isPromptRecencyQuery("what did I do with you last time?"), true);
  assertEquals(isPromptRecencyQuery("then even before that? i wanna recall"), true);
  assertEquals(isPromptRecencyQuery("list desktop files"), false);

  const history = [
    "older prompt",
    "in Download it must have xcode zip file. can you remove it?",
    "what did I do with you last time?",
  ];

  assertEquals(
    getRecentPromptEntries(history, "what did I do with you last time?"),
    [
      "in Download it must have xcode zip file. can you remove it?",
      "older prompt",
    ],
  );

  assertEquals(
    buildRecentPromptHistoryContext(
      history,
      "what did I do with you last time?",
    ),
    [
      "# Recent REPL Prompt History",
      "Use this as the authoritative source for chronology questions about what the user asked in this REPL.",
      'Answer questions like "last time", "before that", "previous", and "what did I ask" from this history only.',
      "Do not use durable memory to infer missing chronology. If this history is insufficient, say so plainly.",
      "This list is ordered most recent first.",
      "1. in Download it must have xcode zip file. can you remove it?",
      "2. older prompt",
    ].join("\n"),
  );
});

Deno.test("prompt history context handles follow-up recall phrasing", () => {
  const history = [
    "tell me about React useEffect cleanup research",
    "remove XCODE_99_TEST.zip from Downloads",
    "hello what did I do with you last time?",
    "then even before that? i wanna recall",
  ];

  assertEquals(
    buildRecentPromptHistoryContext(history, "then even before that? i wanna recall"),
    [
      "# Recent REPL Prompt History",
      "Use this as the authoritative source for chronology questions about what the user asked in this REPL.",
      'Answer questions like "last time", "before that", "previous", and "what did I ask" from this history only.',
      "Do not use durable memory to infer missing chronology. If this history is insufficient, say so plainly.",
      "This list is ordered most recent first.",
      "1. hello what did I do with you last time?",
      "2. remove XCODE_99_TEST.zip from Downloads",
      "3. tell me about React useEffect cleanup research",
    ].join("\n"),
  );
});
