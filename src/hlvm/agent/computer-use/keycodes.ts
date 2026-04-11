/**
 * Computer Use — macOS Key Code Map
 *
 * Maps key names to macOS virtual key codes for `osascript key code N`.
 * Reference: https://eastmanreference.com/complete-list-of-applescript-key-codes
 */

/** macOS virtual key codes indexed by lowercase key name */
export const KEY_CODES: Readonly<Record<string, number>> = {
  // Letters (QWERTY layout)
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9,
  b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, o: 31,
  u: 32, i: 34, p: 35, l: 37, j: 38, k: 40, n: 45, m: 46,

  // Numbers
  "0": 29, "1": 18, "2": 19, "3": 20, "4": 21,
  "5": 23, "6": 22, "7": 26, "8": 28, "9": 25,

  // Special keys
  return: 36, enter: 36, tab: 48, space: 49, delete: 51, backspace: 51,
  escape: 53, esc: 53,

  // Arrows
  left: 123, right: 124, down: 125, up: 126,

  // Function keys
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97,
  f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,

  // Punctuation & symbols
  "-": 27, "=": 24, "[": 33, "]": 30, "\\": 42,
  ";": 41, "'": 39, ",": 43, ".": 47, "/": 44, "`": 50,

  // Navigation
  home: 115, end: 119, pageup: 116, pagedown: 121,
  forwarddelete: 117,
};

/** Modifier name → AppleScript modifier keyword */
export const MODIFIER_MAP: Readonly<Record<string, string>> = {
  cmd: "command down",
  command: "command down",
  ctrl: "control down",
  control: "control down",
  alt: "option down",
  option: "option down",
  shift: "shift down",
  fn: "function down",
};

const KEY_SPEC_ALIASES: Readonly<
  Record<string, { keyName: string; modifiers?: string[] }>
> = {
  equal: { keyName: "=" },
  equals: { keyName: "=" },
  minus: { keyName: "-" },
  plus: { keyName: "=", modifiers: ["shift down"] },
};

/**
 * Parse a key spec like "cmd+shift+a" into { keyCode, modifiers }.
 * Returns null if the key name is unknown.
 */
export function parseKeySpec(
  spec: string,
): { keyCode: number; modifiers: string[] } | null {
  const parts = spec.toLowerCase().split("+").map((s) => s.trim());
  const rawKeyName = parts.pop();
  if (!rawKeyName) return null;
  const alias = KEY_SPEC_ALIASES[rawKeyName];
  const keyName = alias?.keyName ?? rawKeyName;

  const keyCode = KEY_CODES[keyName];
  if (keyCode === undefined) return null;

  const modifiers: string[] = alias?.modifiers ? [...alias.modifiers] : [];
  for (const part of parts) {
    const mod = MODIFIER_MAP[part];
    if (!mod) return null;
    modifiers.push(mod);
  }

  return { keyCode, modifiers };
}
