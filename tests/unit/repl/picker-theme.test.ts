import { assertEquals } from "jsr:@std/assert@1";
import { THEMES } from "../../../src/hlvm/cli/theme/index.ts";
import { buildSemanticColors } from "../../../src/hlvm/cli/theme/semantic.ts";
import { getPickerColors } from "../../../src/hlvm/cli/repl-ink/utils/picker-theme.ts";

Deno.test("picker theme keeps default selection neutral and readable", () => {
  const sc = buildSemanticColors(THEMES.sicp);
  const picker = getPickerColors(sc);

  assertEquals(picker.borderColor, THEMES.sicp.muted);
  assertEquals(picker.rowForeground, THEMES.sicp.text);
  assertEquals(picker.rowMeta, THEMES.sicp.muted);
  assertEquals(picker.rowMatch, THEMES.sicp.warning);
  assertEquals(picker.selectedMarkerColor, THEMES.sicp.warning);
  assertEquals(picker.selectedMatch, THEMES.sicp.warning);
  assertEquals(picker.selectedBackground, sc.surface.inline.selectedBackground);
  assertEquals(picker.selectedForeground, sc.surface.inline.selectedForeground);
  assertEquals(picker.hintColor, THEMES.sicp.muted);
  assertEquals(picker.separatorColor, THEMES.sicp.muted);
});

Deno.test("picker theme resolves alert tones without duplicating tone logic in components", () => {
  const sc = buildSemanticColors(THEMES.sicp);

  assertEquals(getPickerColors(sc, "active").borderColor, THEMES.sicp.primary);
  assertEquals(
    getPickerColors(sc, "warning").borderColor,
    THEMES.sicp.warning,
  );
  assertEquals(getPickerColors(sc, "error").titleColor, THEMES.sicp.error);
});
