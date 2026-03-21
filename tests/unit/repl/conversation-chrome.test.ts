import { assertEquals } from "jsr:@std/assert@1";
import {
  buildDelegateHeaderText,
  getDelegateStatusGlyph,
  getDelegateStatusTone,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/conversation-chrome.ts";

Deno.test("getDelegateStatusTone maps delegate statuses into shared chrome tones", () => {
  assertEquals(getDelegateStatusTone("success"), "success");
  assertEquals(getDelegateStatusTone("error"), "error");
  assertEquals(getDelegateStatusTone("queued"), "neutral");
  assertEquals(getDelegateStatusTone("running"), "warning");
});

Deno.test("getDelegateStatusGlyph maps delegate statuses into stable glyphs", () => {
  assertEquals(getDelegateStatusGlyph("success"), "✓");
  assertEquals(getDelegateStatusGlyph("error"), "✗");
  assertEquals(getDelegateStatusGlyph("queued"), "⏳");
  assertEquals(getDelegateStatusGlyph("running"), "↗");
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
