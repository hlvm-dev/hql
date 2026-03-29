import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { THEMES } from "../../../src/hlvm/cli/theme/index.ts";
import { buildSemanticColors } from "../../../src/hlvm/cli/theme/semantic.ts";
import { themeToOverlayColors } from "../../../src/hlvm/cli/repl-ink/overlay/index.ts";

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

Deno.test("semantic theme surfaces derive modal, field, inline, and footer tokens from the palette SSOT", () => {
  for (const palette of Object.values(THEMES)) {
    const semantic = buildSemanticColors(palette);

    assertEquals(semantic.surface.modal.background, palette.bg);
    assertEquals(semantic.surface.modal.border, palette.primary);
    assertEquals(semantic.surface.modal.section, palette.accent);
    assertEquals(semantic.surface.field.border, palette.muted);
    assertEquals(semantic.surface.field.borderActive, palette.accent);
    assertEquals(semantic.surface.inline.border, palette.muted);
    assertEquals(semantic.footer.status.ready, palette.success);
    assertEquals(semantic.footer.status.active, palette.accent);
    assertEquals(semantic.footer.status.error, palette.error);
  }
});

Deno.test("sicp keeps the book-cover accent colors but uses a dark base surface", () => {
  assertNotEquals(THEMES.sicp.bg, THEMES.sicp.primary);
  assertEquals(THEMES.sicp.primary, "#5a3a97");
  assertEquals(THEMES.sicp.secondary, "#d85a43");
  assertEquals(THEMES.sicp.accent, "#efe3c2");
  assertEquals(THEMES.sicp.bg, "#171320");
});

Deno.test("overlay colors are derived from semantic surface tokens rather than fixed RGB constants", () => {
  for (const palette of Object.values(THEMES)) {
    const semantic = buildSemanticColors(palette);
    const overlay = themeToOverlayColors(palette);

    assertEquals(
      overlay.background,
      hexToRgbTuple(semantic.surface.modal.background),
    );
    assertEquals(
      overlay.selectedBackground,
      hexToRgbTuple(semantic.surface.modal.selectedBackground),
    );
    assertEquals(overlay.title, hexToRgbTuple(semantic.surface.modal.title));
    assertEquals(overlay.meta, hexToRgbTuple(semantic.surface.modal.meta));
    assertEquals(
      overlay.section,
      hexToRgbTuple(semantic.surface.modal.section),
    );
    assertEquals(overlay.footer, hexToRgbTuple(semantic.surface.modal.footer));
    assertEquals(
      overlay.fieldBorder,
      hexToRgbTuple(semantic.surface.field.border),
    );
    assertEquals(
      overlay.fieldBorderActive,
      hexToRgbTuple(semantic.surface.field.borderActive),
    );
    assertEquals(
      overlay.fieldPlaceholder,
      hexToRgbTuple(semantic.surface.field.placeholder),
    );
  }
});
