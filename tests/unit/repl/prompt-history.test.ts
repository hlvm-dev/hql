import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import type { HistoryEntry } from "../../../src/hlvm/cli/repl/history-storage.ts";
import type { SessionMessage } from "../../../src/hlvm/cli/repl/session/types.ts";
import {
  buildRecentPromptHistoryContext,
  isPromptRecencyQuery,
  recordPromptHistory,
  shouldRecordPromptHistory,
} from "../../../src/hlvm/cli/repl/prompt-history.ts";

function entry(ts: string, cmd: string): HistoryEntry {
  return { ts: Date.parse(ts), cmd };
}

function sessionMessage(
  ts: string,
  role: SessionMessage["role"],
  content: string,
): SessionMessage {
  return {
    role,
    content,
    ts: Date.parse(ts),
  };
}

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
  assertEquals(isPromptRecencyQuery("what did I do with you yesterday?"), true);
  assertEquals(isPromptRecencyQuery("list desktop files"), false);
});

Deno.test("prompt history context selects the latest meaningful task block", () => {
  const history = [
    entry("2026-03-10T08:00:00Z", "tell me about React useEffect cleanup research"),
    entry("2026-03-11T09:00:00Z", "remove all in Desktop except playground"),
    entry("2026-03-11T09:04:00Z", "in Download it must have xcode zip file. can you remove it?"),
    entry("2026-03-11T09:05:00Z", "yes"),
    entry("2026-03-11T09:06:00Z", "hello what did I do with you last time?"),
  ];

  const context = buildRecentPromptHistoryContext(
    history,
    "hello what did I do with you last time?",
    { nowMs: Date.parse("2026-03-11T10:00:00Z"), timeZone: "UTC" },
  );

  assertStringIncludes(context ?? "", "# Structured REPL Chronology");
  assertStringIncludes(context ?? "", "Question type: last_time");
  assertStringIncludes(context ?? "", "remove all in Desktop except playground");
  assertStringIncludes(
    context ?? "",
    "in Download it must have xcode zip file. can you remove it?",
  );
  assertEquals((context ?? "").includes("\n- yes"), false);
});

Deno.test("prompt history context handles follow-up recall phrasing", () => {
  const history = [
    entry("2026-03-09T07:00:00Z", "tell me about React useEffect cleanup research"),
    entry("2026-03-10T07:00:00Z", "show me Python asyncio.TaskGroup research"),
    entry("2026-03-11T09:00:00Z", "remove XCODE_99_TEST.zip from Downloads"),
    entry("2026-03-11T09:06:00Z", "hello what did I do with you last time?"),
    entry("2026-03-11T09:07:00Z", "then even before that? i wanna recall"),
  ];

  const context = buildRecentPromptHistoryContext(
    history,
    "then even before that? i wanna recall",
    { nowMs: Date.parse("2026-03-11T10:00:00Z"), timeZone: "UTC" },
  );

  assertStringIncludes(context ?? "", "Question type: before_that");
  assertStringIncludes(context ?? "", "show me Python asyncio.TaskGroup research");
  assertEquals(
    context?.includes("remove XCODE_99_TEST.zip from Downloads"),
    false,
  );
});

Deno.test("prompt history context uses timestamps for yesterday queries", () => {
  const history = [
    entry("2026-03-09T05:00:00Z", "tell me about React useEffect cleanup research"),
    entry("2026-03-10T03:00:00Z", "go to apple.com and find any new macbook stuff"),
    entry("2026-03-10T03:10:00Z", "tesla stock prices per year in a table"),
    entry("2026-03-11T08:00:00Z", "remove XCODE_99_TEST.zip from Downloads"),
  ];

  const context = buildRecentPromptHistoryContext(
    history,
    "then what did I do with you yesterday?",
    { nowMs: Date.parse("2026-03-11T12:00:00Z"), timeZone: "UTC" },
  );

  assertStringIncludes(context ?? "", "Question type: yesterday. Use only task blocks from 2026-03-10.");
  assertStringIncludes(context ?? "", "go to apple.com and find any new macbook stuff");
  assertStringIncludes(context ?? "", "tesla stock prices per year in a table");
  assertEquals(
    context?.includes("remove XCODE_99_TEST.zip from Downloads"),
    false,
  );
});

Deno.test("prompt history context prefers current session transcript over older global history", () => {
  const history = [
    entry("2026-03-09T05:00:00Z", "tell me about React useEffect cleanup research"),
    entry("2026-03-10T03:00:00Z", "go to apple.com and find any new macbook stuff"),
  ];
  const sessionMessages = [
    sessionMessage(
      "2026-03-11T09:00:00Z",
      "user",
      "remove all in Desktop except playground",
    ),
    sessionMessage(
      "2026-03-11T09:01:00Z",
      "assistant",
      "Working on that now.",
    ),
    sessionMessage(
      "2026-03-11T09:04:00Z",
      "user",
      "in Download it must have xcode zip file. can you remove it?",
    ),
  ];

  const context = buildRecentPromptHistoryContext(
    history,
    "hello what did I do with you last time?",
    {
      nowMs: Date.parse("2026-03-11T10:00:00Z"),
      timeZone: "UTC",
      sessionMessages,
    },
  );

  assertStringIncludes(context ?? "", "current-session transcript");
  assertStringIncludes(context ?? "", "remove all in Desktop except playground");
  assertStringIncludes(
    context ?? "",
    "in Download it must have xcode zip file. can you remove it?",
  );
  assertEquals(
    context?.includes("go to apple.com and find any new macbook stuff"),
    false,
  );
});

Deno.test("prompt history context falls back to older global history for before_that beyond the current session", () => {
  const history = [
    entry("2026-03-09T05:00:00Z", "tell me about React useEffect cleanup research"),
    entry("2026-03-10T03:00:00Z", "go to apple.com and find any new macbook stuff"),
  ];
  const sessionMessages = [
    sessionMessage(
      "2026-03-11T09:00:00Z",
      "user",
      "remove XCODE_99_TEST.zip from Downloads",
    ),
    sessionMessage(
      "2026-03-11T09:06:00Z",
      "user",
      "hello what did I do with you last time?",
    ),
  ];

  const context = buildRecentPromptHistoryContext(
    history,
    "then even before that? i wanna recall",
    {
      nowMs: Date.parse("2026-03-11T10:00:00Z"),
      timeZone: "UTC",
      sessionMessages,
    },
  );

  assertStringIncludes(context ?? "", "Question type: before_that");
  assertStringIncludes(context ?? "", "go to apple.com and find any new macbook stuff");
  assertStringIncludes(context ?? "", "repl-history fallback");
  assertEquals(
    context?.includes("remove XCODE_99_TEST.zip from Downloads"),
    false,
  );
});
