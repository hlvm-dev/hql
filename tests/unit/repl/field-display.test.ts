import { assertEquals } from "jsr:@std/assert@1";
import { buildFieldDisplayState } from "../../../src/hlvm/cli/repl-ink/utils/field-display.ts";

Deno.test("buildFieldDisplayState returns placeholder state with a visible cursor slot", () => {
  const state = buildFieldDisplayState("", 0, 12, "Filter by model");

  assertEquals(state.isPlaceholder, true);
  assertEquals(state.beforeCursor, "");
  assertEquals(state.cursorChar, " ");
  assertEquals(state.afterCursor, "");
  assertEquals(state.renderWidth, 1);
  assertEquals(state.placeholderText, "Filter by …");
});

Deno.test("buildFieldDisplayState reuses cursor-window logic for non-empty values", () => {
  const state = buildFieldDisplayState(
    "anthropic/claude-sonnet",
    10,
    12,
    "unused",
  );

  assertEquals(state.isPlaceholder, false);
  assertEquals(state.placeholderText, "");
  assertEquals(
    state.beforeCursor.length + state.cursorChar.length +
      state.afterCursor.length,
    state.renderWidth,
  );
});
