import { assertEquals } from "jsr:@std/assert@1";
import { THEMES } from "../../../src/hlvm/cli/theme/index.ts";
import { buildSemanticColors } from "../../../src/hlvm/cli/theme/semantic.ts";
import {
  fitShellFooterSegments,
  getHistorySearchHintText,
  getHistorySearchMatchLabel,
  getShellPromptPrefixWidth,
  getShellPromptSlotWidth,
  padShellPromptLabel,
} from "../../../src/hlvm/cli/repl-ink/utils/shell-chrome.ts";

Deno.test("shell prompt slot width stays stable across composer prompt variants", () => {
  assertEquals(getShellPromptSlotWidth("hlvm>"), 5);
  assertEquals(getShellPromptSlotWidth("answer>"), 7);
  assertEquals(getShellPromptPrefixWidth("hlvm>"), 6);
  assertEquals(getShellPromptPrefixWidth("answer>"), 8);
  assertEquals(padShellPromptLabel("hlvm>"), "hlvm>");
  assertEquals(padShellPromptLabel("answer>"), "answer>");
});

Deno.test("buildSemanticColors derives shell chrome from palette tokens only", () => {
  const semanticColors = buildSemanticColors(THEMES.sicp);
  const shell = semanticColors.shell;

  assertEquals(shell.prompt, THEMES.sicp.primary);
  assertEquals(shell.separator, THEMES.sicp.muted);
  assertEquals(shell.queueHint, THEMES.sicp.muted);
  assertEquals(shell.chipNeutral.background, THEMES.sicp.muted);
  assertEquals(shell.chipActive.background, THEMES.sicp.accent);
  assertEquals(shell.chipWarning.background, THEMES.sicp.warning);
  assertEquals(semanticColors.chrome.sectionLabel, THEMES.sicp.accent);
  assertEquals(
    semanticColors.chrome.chipSuccess.background,
    THEMES.sicp.success,
  );
  assertEquals(semanticColors.chrome.chipError.background, THEMES.sicp.error);
});

Deno.test("fitShellFooterSegments truncates trailing hint text before dropping chips", () => {
  const fitted = fitShellFooterSegments([
    { text: "Plan mode", tone: "neutral", chip: true },
    { text: "+2 queued", tone: "active", chip: true },
    { text: "Tab queues · Ctrl+Enter forces", tone: "active" },
  ], 34);

  assertEquals(
    fitted.map((segment) => segment.text),
    ["Plan mode", "+2 queued", "Tab q…"],
  );
});

Deno.test("history search shell helpers summarize match state without punctuation noise", () => {
  assertEquals(getHistorySearchMatchLabel("", 0, 0), "type to search");
  assertEquals(getHistorySearchMatchLabel("plan", 0, 0), "no match");
  assertEquals(getHistorySearchMatchLabel("plan", 1, 0), "1 match");
  assertEquals(getHistorySearchMatchLabel("plan", 4, 1), "2/4 matches");
});

Deno.test("history search shell helpers keep hint text compact", () => {
  assertEquals(getHistorySearchHintText("", 0), "Type to search · Esc cancel");
  assertEquals(
    getHistorySearchHintText("plan", 1),
    "Enter select · Esc cancel",
  );
  assertEquals(
    getHistorySearchHintText("plan", 3),
    "Ctrl+R next · Ctrl+S prev · Enter select · Esc cancel",
  );
});
