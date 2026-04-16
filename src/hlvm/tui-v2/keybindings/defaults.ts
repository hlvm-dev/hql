import type { KeyBinding } from "./types.ts";

const k = (
  context: KeyBinding["context"],
  key: string,
  action: string,
  mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
): KeyBinding => ({
  context,
  keystroke: {
    key,
    ctrl: mods.ctrl ?? false,
    shift: mods.shift ?? false,
    alt: mods.alt ?? false,
  },
  action,
});

export const DEFAULT_BINDINGS: ReadonlyArray<KeyBinding> = [
  // global
  k("global", "c", "interrupt", { ctrl: true }),
  k("global", "d", "exit", { ctrl: true }),
  k("global", "l", "clear", { ctrl: true }),

  // chat
  k("chat", "return", "submit"),
  k("chat", "tab", "toggle-mode", { shift: true }),
  k("chat", "up", "history-prev"),
  k("chat", "down", "history-next"),

  // code
  k("code", "return", "submit"),
  k("code", "tab", "toggle-mode", { shift: true }),

  // confirmation
  k("confirmation", "y", "confirm-yes"),
  k("confirmation", "n", "confirm-no"),
];
