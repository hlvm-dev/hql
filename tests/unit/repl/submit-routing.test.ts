import { assertEquals } from "jsr:@std/assert@1";
import {
  formatSubmitActionCue,
  isShellCommandText,
  resolveSubmitAction,
} from "../../../src/hlvm/cli/repl-ink/utils/submit-routing.ts";

Deno.test("isShellCommandText detects slash and dot-prefixed commands", () => {
  assertEquals(isShellCommandText("/help"), true);
  assertEquals(isShellCommandText(".help"), true);
  assertEquals(isShellCommandText("(+ 1 2)"), false);
});

Deno.test("resolveSubmitAction routes commands before anything else", () => {
  assertEquals(
    resolveSubmitAction({
      text: ".help",
      isBalanced: true,
      isCommand: true,
    }),
    "run-command",
  );
});

Deno.test("resolveSubmitAction keeps incomplete HQL in multiline mode", () => {
  assertEquals(
    resolveSubmitAction({
      text: "(defn greet [name]",
      isBalanced: false,
    }),
    "continue-multiline",
  );
});

Deno.test("resolveSubmitAction evaluates HQL locally once balanced", () => {
  assertEquals(
    resolveSubmitAction({
      text: "(+ 1 2)",
      isBalanced: true,
    }),
    "evaluate-local",
  );
});

Deno.test("resolveSubmitAction sends natural language to the agent", () => {
  assertEquals(
    resolveSubmitAction({
      text: "summarize the last error",
      isBalanced: true,
      routeHint: "conversation",
      composerLanguage: "chat",
    }),
    "send-agent",
  );
});

Deno.test("resolveSubmitAction preserves attachment-backed local eval", () => {
  assertEquals(
    resolveSubmitAction({
      text: "(inspect image)",
      isBalanced: false,
      hasAttachments: true,
    }),
    "evaluate-local",
  );
});

Deno.test("formatSubmitActionCue uses compact mixed-shell labels", () => {
  assertEquals(formatSubmitActionCue("send-agent"), "Enter agent");
  assertEquals(
    formatSubmitActionCue("send-agent", "conversation"),
    "Enter send",
  );
  assertEquals(formatSubmitActionCue("continue-multiline"), "Enter newline");
});
