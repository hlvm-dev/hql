import { assertEquals } from "jsr:@std/assert@1";
import {
  buildPaletteCategoryLabel,
  buildPaletteHeaderLayout,
  buildPaletteItemLayout,
} from "../../../src/hlvm/cli/repl-ink/utils/palette-layout.ts";

Deno.test("buildPaletteHeaderLayout shows search summary and match count", () => {
  const layout = buildPaletteHeaderLayout({
    query: "tool",
    resultCount: 7,
    selectedCount: 1,
    rebindMode: false,
  }, 28);

  assertEquals(layout.leftText, "Filter commands");
  assertEquals(layout.rightText, "7 matches");
  assertEquals(
    layout.leftText.length + layout.gapWidth + layout.rightText.length,
    28,
  );
});

Deno.test("buildPaletteCategoryLabel uses the shared overlay section styling", () => {
  assertEquals(
    buildPaletteCategoryLabel("Conversation", 18),
    "Conversation ─────",
  );
});

Deno.test("buildPaletteItemLayout keeps the shortcut column stable", () => {
  const layout = buildPaletteItemLayout(
    "Toggle latest tool output visibility",
    "Ctrl+O",
    30,
  );

  assertEquals(layout.rightText, "Ctrl+O");
  assertEquals(
    layout.leftText.length + layout.gapWidth + layout.rightText.length,
    30,
  );
});
