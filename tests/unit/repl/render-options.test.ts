import { assertEquals } from "jsr:@std/assert@1";
import { REPL_RENDER_OPTIONS } from "../../../src/hlvm/cli/repl-ink/render-options.ts";

Deno.test("REPL render options disable Ink auto-exit on Ctrl+C", () => {
  assertEquals(REPL_RENDER_OPTIONS.exitOnCtrlC, false);
});
