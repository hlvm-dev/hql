import { assertEquals } from "jsr:@std/assert@1";
import { resolveCtrlCAction } from "../../../src/hlvm/cli/repl-ink/ctrl-c-behavior.ts";

Deno.test("resolveCtrlCAction exits when the composer is empty", () => {
  assertEquals(
    resolveCtrlCAction({ draftText: "", attachmentCount: 0 }),
    "exit",
  );
});

Deno.test("resolveCtrlCAction clears draft text before exiting", () => {
  assertEquals(
    resolveCtrlCAction({ draftText: "pending plan", attachmentCount: 0 }),
    "clear-draft",
  );
});

Deno.test("resolveCtrlCAction treats whitespace as a clearable draft", () => {
  assertEquals(
    resolveCtrlCAction({ draftText: "   ", attachmentCount: 0 }),
    "clear-draft",
  );
});

Deno.test("resolveCtrlCAction clears attachments even without text", () => {
  assertEquals(
    resolveCtrlCAction({ draftText: "", attachmentCount: 1 }),
    "clear-draft",
  );
});
