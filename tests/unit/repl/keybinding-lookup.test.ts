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

Deno.test("normalizeKeyInput: plain tab maps to tab", () => {
  assertEquals(normalizeKeyInput("\t", makeKey()), "tab");
});

Deno.test("normalizeKeyInput: plain enter maps to enter", () => {
  assertEquals(normalizeKeyInput("\n", makeKey({ return: true })), "enter");
});

Deno.test("normalizeKeyInput: ctrl+j maps to ctrl+j", () => {
  assertEquals(normalizeKeyInput("\n", makeKey({ ctrl: true })), "ctrl+j");
});

Deno.test("normalizeKeyInput: ctrl+i maps to ctrl+i", () => {
  assertEquals(normalizeKeyInput("\t", makeKey({ ctrl: true })), "ctrl+i");
});

Deno.test("normalizeKeyInput: pure escape maps to esc", () => {
  assertEquals(normalizeKeyInput("\x1b", makeKey({ escape: true })), "esc");
});

Deno.test("normalizeKeyInput: option/meta key sequence maps to alt+char", () => {
  assertEquals(normalizeKeyInput("z", makeKey({ escape: true })), "alt+z");
});

Deno.test("normalizeKeyInput: alt+enter maps correctly", () => {
  assertEquals(normalizeKeyInput("\r", makeKey({ escape: true, return: true })), "alt+enter");
});

Deno.test("normalizeKeyInput: ESC-prefixed enter payload maps to alt+enter", () => {
  assertEquals(normalizeKeyInput("\x1b\r", makeKey()), "alt+enter");
});

Deno.test("normalizeKeyInput: CSI-u modified enter maps to alt+enter", () => {
  assertEquals(normalizeKeyInput("\x1b[13;3u", makeKey()), "alt+enter");
  assertEquals(normalizeKeyInput("\x1b[13;2u", makeKey()), "alt+enter");
});

Deno.test("normalizeKeyInput: legacy modifyOtherKeys enter maps to alt+enter", () => {
  assertEquals(normalizeKeyInput("\x1b[27;3;13~", makeKey()), "alt+enter");
});

Deno.test("normalizeKeyInput: cmd+enter maps correctly", () => {
  assertEquals(normalizeKeyInput("\r", makeKey({ meta: true, return: true })), "cmd+enter");
});
