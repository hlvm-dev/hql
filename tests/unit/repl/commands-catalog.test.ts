import { assertEquals } from "jsr:@std/assert";
import { COMMAND_CATALOG } from "../../../src/hlvm/cli/repl/commands.ts";
import { commandKeybindings } from "../../../src/hlvm/cli/repl-ink/keybindings/definitions/commands.ts";

Deno.test("REPL command surfaces keep /undo in both catalog and keybindings", () => {
  const catalogEntry = COMMAND_CATALOG.find((command) => command.name === "/undo");
  const keybindingEntry = commandKeybindings.find((command) =>
    command.id === "/undo"
  );

  assertEquals(catalogEntry?.description, "Restore the latest checkpoint");
  assertEquals(keybindingEntry?.display, "/undo");
});
