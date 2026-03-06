import { assertEquals } from "jsr:@std/assert@1";
import { buildShortcutSections } from "../../../src/hlvm/cli/repl-ink/components/ShortcutsOverlay.tsx";

Deno.test("buildShortcutSections includes general and conversation shortcuts", () => {
  const sections = buildShortcutSections();

  assertEquals(
    sections.map((section) => section.title),
    ["General", "Conversation"],
  );

  assertEquals(
    sections[0]?.rows.map((row) => row.label),
    [
      "Show shortcuts",
      "Command palette",
      "Background tasks",
      "Show help",
    ],
  );

  assertEquals(
    sections[1]?.rows.map((row) => row.label),
    [
      "Toggle latest section",
      "Open latest source",
      "Cancel or close",
      "Scroll terminal",
    ],
  );
});
