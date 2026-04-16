import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import { resolveKeystroke } from "../../../src/hlvm/tui-v2/keybindings/resolver.ts";
import { DEFAULT_BINDINGS } from "../../../src/hlvm/tui-v2/keybindings/defaults.ts";
import type { KeyContext, Keystroke } from "../../../src/hlvm/tui-v2/keybindings/types.ts";

function ks(key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): Keystroke {
  return { key, ctrl: mods.ctrl ?? false, shift: mods.shift ?? false, alt: mods.alt ?? false };
}

function resolve(keystroke: Keystroke, contexts: KeyContext[]): string | null {
  return resolveKeystroke(keystroke, contexts, DEFAULT_BINDINGS);
}

Deno.test("keybindings: Ctrl+C in [chat, global] → interrupt", () => {
  assertEquals(resolve(ks("c", { ctrl: true }), ["chat", "global"]), "interrupt");
});

Deno.test("keybindings: Enter in [chat, global] → submit", () => {
  assertEquals(resolve(ks("return"), ["chat", "global"]), "submit");
});

Deno.test("keybindings: Shift+Tab in [chat, global] → toggle-mode", () => {
  assertEquals(resolve(ks("tab", { shift: true }), ["chat", "global"]), "toggle-mode");
});

Deno.test("keybindings: y in [confirmation, global] → confirm-yes", () => {
  assertEquals(resolve(ks("y"), ["confirmation", "global"]), "confirm-yes");
});

Deno.test("keybindings: unbound key z → null", () => {
  assertEquals(resolve(ks("z"), ["chat", "global"]), null);
});

Deno.test("keybindings: specific context wins over global", () => {
  // Enter is bound in both chat (submit) and could hypothetically be in global.
  // With [chat, global] order, chat's "submit" should win over any global binding.
  // Also verify that when only global is active, global bindings work.
  assertEquals(resolve(ks("c", { ctrl: true }), ["chat", "global"]), "interrupt");
  // Ctrl+C is only in global, so even with chat first, it resolves from global.
  // But chat-specific Enter should resolve from chat, not fall through.
  assertEquals(resolve(ks("return"), ["chat", "global"]), "submit");
  assertEquals(resolve(ks("return"), ["global"]), null); // Enter not bound in global
});
