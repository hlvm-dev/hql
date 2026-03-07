import { assertEquals } from "jsr:@std/assert";
import type { Key } from "ink";
import { normalizeKeyInput } from "../../../src/hlvm/cli/repl-ink/keybindings/keybinding-lookup.ts";

function makeKey(overrides: Partial<Key> = {}): Key {
  return {
    backspace: false,
    delete: false,
    downArrow: false,
    escape: false,
    leftArrow: false,
    meta: false,
    return: false,
    rightArrow: false,
    shift: false,
    tab: false,
    upArrow: false,
    ctrl: false,
    ...overrides,
  } as Key;
}

Deno.test("normalizeKeyInput: plain enter, tab, and escape keep their canonical names", () => {
  assertEquals(normalizeKeyInput("\t", makeKey()), "tab");
  assertEquals(normalizeKeyInput("\n", makeKey({ return: true })), "enter");
  assertEquals(normalizeKeyInput("\x1b", makeKey({ escape: true })), "esc");
});

Deno.test("normalizeKeyInput: ctrl-modified enter and tab keep control-specific identities", () => {
  assertEquals(normalizeKeyInput("\n", makeKey({ ctrl: true })), "ctrl+j");
  assertEquals(normalizeKeyInput("\t", makeKey({ ctrl: true })), "ctrl+i");
});

Deno.test("normalizeKeyInput: alt/meta text sequences normalize consistently", () => {
  assertEquals(normalizeKeyInput("z", makeKey({ escape: true })), "alt+z");
  assertEquals(normalizeKeyInput("\r", makeKey({ escape: true, return: true })), "alt+enter");
  assertEquals(normalizeKeyInput("\x1b\r", makeKey()), "alt+enter");
  assertEquals(normalizeKeyInput("\x1b[13;3u", makeKey()), "alt+enter");
  assertEquals(normalizeKeyInput("\x1b[13;2u", makeKey()), "alt+enter");
  assertEquals(normalizeKeyInput("\x1b[27;3;13~", makeKey()), "alt+enter");
});

Deno.test("normalizeKeyInput: meta return sequences preserve cmd+enter on mac-style bindings", () => {
  assertEquals(normalizeKeyInput("\r", makeKey({ meta: true, return: true })), "cmd+enter");
});
