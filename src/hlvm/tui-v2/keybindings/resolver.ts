import type { KeyBinding, KeyContext, Keystroke } from "./types.ts";

/** Ink Key shape — duplicated here to avoid transitive .js import issues. */
interface InkKey {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  pageUp: boolean;
  pageDown: boolean;
  home: boolean;
  end: boolean;
  meta: boolean;
}

/**
 * Convert Ink's useInput callback arguments into a normalized Keystroke.
 */
export function inkKeyToKeystroke(input: string, key: InkKey): Keystroke {
  let keyName: string;

  if (key.upArrow) keyName = "up";
  else if (key.downArrow) keyName = "down";
  else if (key.leftArrow) keyName = "left";
  else if (key.rightArrow) keyName = "right";
  else if (key.return) keyName = "return";
  else if (key.escape) keyName = "escape";
  else if (key.tab) keyName = "tab";
  else if (key.backspace) keyName = "backspace";
  else if (key.delete) keyName = "delete";
  else if (key.pageUp) keyName = "pageUp";
  else if (key.pageDown) keyName = "pageDown";
  else if (key.home) keyName = "home";
  else if (key.end) keyName = "end";
  else keyName = input;

  return {
    key: keyName,
    ctrl: key.ctrl,
    shift: key.shift,
    alt: key.meta,
  };
}

function matchesKeystroke(a: Keystroke, b: Keystroke): boolean {
  return (
    a.key === b.key &&
    a.ctrl === b.ctrl &&
    a.shift === b.shift &&
    a.alt === b.alt
  );
}

/**
 * Resolve a keystroke against a set of bindings given the active contexts.
 * Checks contexts in order (first match wins), so list more-specific contexts first.
 */
export function resolveKeystroke(
  keystroke: Keystroke,
  activeContexts: ReadonlyArray<KeyContext>,
  bindings: ReadonlyArray<KeyBinding>,
): string | null {
  for (const ctx of activeContexts) {
    for (const binding of bindings) {
      if (binding.context === ctx && matchesKeystroke(keystroke, binding.keystroke)) {
        return binding.action;
      }
    }
  }
  return null;
}
