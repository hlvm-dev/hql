import { assertStringIncludes } from "jsr:@std/assert@1";
import { THEMES } from "../../../src/hlvm/cli/theme/index.ts";
import {
  createModalOverlayScaffold,
  themeToOverlayColors,
} from "../../../src/hlvm/cli/repl-ink/overlay/index.ts";

Deno.test("modal overlay scaffold owns frame chrome, background fill, and selected row styling", () => {
  const colors = themeToOverlayColors(THEMES.sicp);
  const surface = createModalOverlayScaffold({
    frame: { x: 2, y: 3, width: 24, height: 8, clipped: false },
    colors,
    title: "Models",
    rightText: "esc close",
  });

  surface.blankRows(3, 8);
  surface.textRow(4, "Catalog", {
    paddingLeft: 2,
    color: colors.fieldText,
    bold: true,
  });
  surface.row(5, (ctx) => {
    ctx.pad(2);
    ctx.write("selected row", { color: colors.fieldText });
  }, { selected: true });

  const output = surface.finish();

  assertStringIncludes(output, "Models");
  assertStringIncludes(output, "esc close");
  assertStringIncludes(output, "Catalog");
  assertStringIncludes(output, "selected row");
  assertStringIncludes(output, colors.bgStyle);
  assertStringIncludes(output, colors.selectedBgStyle);
});
