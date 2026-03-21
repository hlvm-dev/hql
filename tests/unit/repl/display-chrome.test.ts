import { assertEquals } from "jsr:@std/assert@1";
import {
  buildBalancedTextRow,
  buildRightSlotTextLayout,
  buildSectionLabelText,
} from "../../../src/hlvm/cli/repl-ink/utils/display-chrome.ts";

Deno.test("buildSectionLabelText fills the remaining width with a rule", () => {
  assertEquals(
    buildSectionLabelText("Members & Workers", 24),
    "Members & Workers ──────",
  );
});

Deno.test("buildBalancedTextRow preserves the right summary while truncating the left", () => {
  const row = buildBalancedTextRow(
    28,
    "Search every available command",
    "18 matches",
  );

  assertEquals(row.leftText, "Search every av…");
  assertEquals(row.rightText, "18 matches");
  assertEquals(row.leftText.length + row.gapWidth + row.rightText.length, 28);
});

Deno.test("buildRightSlotTextLayout keeps the suffix in a fixed-width slot", () => {
  const row = buildRightSlotTextLayout(
    26,
    "Toggle latest tool output visibility",
    "Ctrl+O",
    8,
  );

  assertEquals(row.rightText, "Ctrl+O");
  assertEquals(row.leftText.length + row.gapWidth + row.rightText.length, 26);
});
