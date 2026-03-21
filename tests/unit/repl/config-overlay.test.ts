import { assertEquals } from "jsr:@std/assert@1";
import { buildConfigSummaryRow } from "../../../src/hlvm/cli/repl-ink/components/ConfigOverlay.tsx";

Deno.test("buildConfigSummaryRow shows selected field context in navigate mode", () => {
  const summary = buildConfigSummaryRow(
    {
      description: "AI model",
      mode: "navigate",
      selectedIndex: 0,
      total: 7,
      isDefaultValue: true,
    },
    44,
  );

  assertEquals(summary, "AI model                       1/7 · default");
});

Deno.test("buildConfigSummaryRow switches to editing state when typing", () => {
  const summary = buildConfigSummaryRow(
    {
      description: "API URL",
      mode: "edit",
      selectedIndex: 1,
      total: 7,
      isDefaultValue: false,
    },
    40,
  );

  assertEquals(summary, "API URL                    2/7 · editing");
});
