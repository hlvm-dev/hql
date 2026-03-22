import { assertEquals } from "jsr:@std/assert@1";
import {
  buildConversationSectionText,
  buildDelegateHeaderText,
  buildWorkingIndicatorLayout,
  getDelegateStatusGlyph,
  getDelegateStatusTone,
  getThinkingLabel,
  getToolDurationTone,
  getToolResultLabel,
  getToolResultTone,
  splitArgKeyValue,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/conversation-chrome.ts";
import { STATUS_GLYPHS } from "../../../src/hlvm/cli/repl-ink/ui-constants.ts";

Deno.test("getDelegateStatusTone maps delegate statuses into shared chrome tones", () => {
  assertEquals(getDelegateStatusTone("success"), "success");
  assertEquals(getDelegateStatusTone("error"), "error");
  assertEquals(getDelegateStatusTone("queued"), "neutral");
  assertEquals(getDelegateStatusTone("running"), "warning");
});

Deno.test("getDelegateStatusGlyph maps delegate statuses into stable glyphs", () => {
  assertEquals(getDelegateStatusGlyph("success"), STATUS_GLYPHS.success);
  assertEquals(getDelegateStatusGlyph("error"), STATUS_GLYPHS.error);
  assertEquals(getDelegateStatusGlyph("queued"), "⏳");
  assertEquals(getDelegateStatusGlyph("running"), "↗");
});

Deno.test("tool result chrome stays mapped through shared conversation tones", () => {
  assertEquals(getToolResultTone("error"), "error");
  assertEquals(getToolResultTone("success"), "success");
  assertEquals(getToolResultTone("pending"), "neutral");
  assertEquals(getToolResultLabel("error"), "Error output");
  assertEquals(getToolResultLabel("success"), "Result");
});

Deno.test("conversation section labels use the shared default width", () => {
  assertEquals(
    buildConversationSectionText("Choices"),
    "Choices ────────────────",
  );
  assertEquals(
    buildConversationSectionText("Sources", 12),
    "Sources ────",
  );
});

Deno.test("conversation status helpers provide stable waiting and thinking labels", () => {
  assertEquals(getThinkingLabel("reasoning"), "Thinking");
  assertEquals(getThinkingLabel("planning"), "Planning");

  const layout = buildWorkingIndicatorLayout(44, "5s");
  assertEquals(layout.rightText, "5s · Esc interrupt");
  assertEquals(
    layout.leftText.length + layout.gapWidth + layout.rightText.length,
    44,
  );
});

Deno.test("buildDelegateHeaderText keeps status and duration in a fixed right slot", () => {
  const layout = buildDelegateHeaderText(
    {
      nickname: "alpha",
      agent: "sonnet",
      durationMs: 3200,
      status: "success",
    },
    34,
  );

  assertEquals(layout.rightText, "done · 3.2s");
  assertEquals(
    layout.leftText.length + layout.gapWidth + layout.rightText.length,
    34,
  );
});

Deno.test("getToolDurationTone maps duration thresholds to semantic tones", () => {
  assertEquals(getToolDurationTone(undefined), "neutral");
  assertEquals(getToolDurationTone(500), "neutral");
  assertEquals(getToolDurationTone(999), "neutral");
  assertEquals(getToolDurationTone(1001), "warning");
  assertEquals(getToolDurationTone(5000), "warning");
  assertEquals(getToolDurationTone(5001), "error");
});

Deno.test("splitArgKeyValue splits at first colon or equals delimiter", () => {
  const colon = splitArgKeyValue("path: /usr/local/bin");
  assertEquals(colon, { key: "path", separator: ":", value: " /usr/local/bin" });

  const equals = splitArgKeyValue("timeout=5000");
  assertEquals(equals, { key: "timeout", separator: "=", value: "5000" });

  assertEquals(splitArgKeyValue("no delimiter here"), null);
  assertEquals(splitArgKeyValue(":starts with colon"), null);
});
