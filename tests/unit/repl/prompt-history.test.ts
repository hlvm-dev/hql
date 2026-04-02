import { assertEquals } from "jsr:@std/assert";
import {
  recordPromptHistory,
  shouldRecordPromptHistory,
} from "../../../src/hlvm/cli/repl/prompt-history.ts";
import type { HistoryEntryMetadata } from "../../../src/hlvm/cli/repl/history-storage.ts";

Deno.test("prompt history records all submission sources", () => {
  assertEquals(shouldRecordPromptHistory("evaluate"), true);
  assertEquals(shouldRecordPromptHistory("command"), true);
  assertEquals(shouldRecordPromptHistory("conversation"), true);
  assertEquals(shouldRecordPromptHistory("interaction"), true);
});

Deno.test("recordPromptHistory forwards all submissions to repl state", () => {
  const recorded: Array<{ input: string; attachments?: readonly unknown[] }> = [];
  const attachments = [{
    id: 1,
    attachmentId: "att_text",
    type: "text" as const,
    displayName: "[Pasted text #1]",
    content: "hello",
    lineCount: 0,
    size: 5,
    fileName: "pasted-text-1.txt",
    mimeType: "text/plain",
  }];
  const replState = {
    addHistory(
      input: string,
      metadata?: HistoryEntryMetadata,
    ) {
      recorded.push({ input, attachments: metadata?.attachments });
    },
  };

  recordPromptHistory(
    replState,
    "[Pasted text #1]",
    "conversation",
    undefined,
    attachments,
  );
  recordPromptHistory(replState, "/help", "command");
  recordPromptHistory(replState, "(+ 1 2)", "evaluate");

  assertEquals(recorded, [
    { input: "[Pasted text #1]", attachments },
    { input: "/help", attachments: undefined },
    { input: "(+ 1 2)", attachments: undefined },
  ]);
});
