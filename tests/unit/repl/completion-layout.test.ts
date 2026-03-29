import { assertEquals } from "jsr:@std/assert@1";
import {
  COMPLETION_PANEL_MAX_WIDTH,
  COMPLETION_PANEL_MIN_WIDTH,
  measureCompletionPanelWidth,
  resolveCompletionPanelLayout,
} from "../../../src/hlvm/cli/repl-ink/utils/completion-layout.ts";

Deno.test("resolveCompletionPanelLayout aligns the panel with the composer text column", () => {
  const layout = resolveCompletionPanelLayout({
    terminalWidth: 80,
    promptPrefixWidth: 2,
    anchorColumn: 0,
  });

  assertEquals(layout.marginLeft, 2);
  assertEquals(layout.maxWidth, 78);
});

Deno.test("resolveCompletionPanelLayout clamps the panel when the anchor is near the right edge", () => {
  const layout = resolveCompletionPanelLayout({
    terminalWidth: 40,
    promptPrefixWidth: 6,
    anchorColumn: 50,
  });

  assertEquals(layout.marginLeft, 16);
  assertEquals(layout.maxWidth, 24);
});

Deno.test("measureCompletionPanelWidth fits to content instead of always stretching to max width", () => {
  const width = measureCompletionPanelWidth({
    rowWidths: [8, 12, 9],
    helpText: "Enter select • Tab next • Esc close • docs off",
    previewLines: ["Show help message"],
    maxWidth: COMPLETION_PANEL_MAX_WIDTH,
  });

  assertEquals(width, 51);
});

Deno.test("measureCompletionPanelWidth respects narrow callers instead of forcing the minimum width", () => {
  const width = measureCompletionPanelWidth({
    rowWidths: [18],
    helpText: "help",
    maxWidth: 16,
  });

  assertEquals(width, 16);
});

Deno.test("measureCompletionPanelWidth still honors the minimum width when space allows", () => {
  const width = measureCompletionPanelWidth({
    rowWidths: [6],
    helpText: "run",
    maxWidth: 48,
  });

  assertEquals(width, COMPLETION_PANEL_MIN_WIDTH);
});
