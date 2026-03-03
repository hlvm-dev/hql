/**
 * Keybinding Lookup - Runtime keybinding resolution
 *
 * Handles custom keybindings from config and tracks disabled defaults.
 * This is the interception layer that makes rebinding work.
 */

import { registry } from "./registry.ts";
import type { Key } from "ink";
import { config } from "../../../api/config.ts";

// ============================================================
// State
// ============================================================

/** Custom keybindings: normalized key -> handler ID */
const customMap = new Map<string, string>();

/** Disabled defaults: normalized key -> true (old defaults that were rebound) */
const disabledDefaults = new Map<string, boolean>();

/** Default keybindings: normalized key -> handler ID (built from definitions) */
const defaultMap = new Map<string, string>();

// ============================================================
// Key Normalization
// ============================================================

/**
 * Normalize terminal key input to a standard format.
 * Handles Ctrl codes (1-26), ESC sequences, and modifier keys.
 *
 * @example
 * normalizeKeyInput("\x07", { ctrl: false, ... }) -> "ctrl+g" (Ctrl+G sends char code 7)
 * normalizeKeyInput("j", { ctrl: true, ... }) -> "ctrl+j"
 */
export function normalizeKeyInput(input: string, key: Key): string | null {
  // macOS terminals can emit Option+Enter as a single ESC-prefixed payload.
  // Normalize this explicitly so higher layers can treat it as Alt+Enter.
  if (input && input.startsWith("\x1b") && (input.endsWith("\r") || input.endsWith("\n"))) {
    return "alt+enter";
  }

  // Modified Enter from CSI-u / modifyOtherKeys protocols.
  // Examples:
  // - \x1b[13;3u    (Alt+Enter)
  // - \x1b[13;2u    (Shift+Enter)
  // - \x1b[27;3;13~ (legacy Alt+Enter form)
  // We normalize all modified-enter protocol payloads to alt+enter because
  // higher-level behavior is the same: insert newline (not submit).
  if (
    input &&
    (/^\x1b\[13;\d+u$/.test(input) || /^\x1b\[27;\d+;13~$/.test(input))
  ) {
    return "alt+enter";
  }

  // Special keys first (Tab, Enter, Esc, arrows, delete keys).
  // This avoids misclassifying raw control bytes (e.g., Tab as Ctrl+I).
  let specialKey: string | null = null;
  if (key.tab || (!key.ctrl && input === "\t")) specialKey = "tab";
  else if (key.return || (!key.ctrl && (input === "\r" || input === "\n"))) specialKey = "enter";
  else if (key.backspace) specialKey = "backspace";
  else if (key.delete) specialKey = "delete";
  else if (key.upArrow) specialKey = "up";
  else if (key.downArrow) specialKey = "down";
  else if (key.leftArrow) specialKey = "left";
  else if (key.rightArrow) specialKey = "right";
  else if (key.escape && (!input || input === "\x1b")) specialKey = "esc";

  const parts: string[] = [];
  let char = input;
  let isCtrl = key.ctrl;
  const isPureEsc = specialKey === "esc";

  // Handle Ctrl codes: Ctrl+A=1, Ctrl+B=2, ... Ctrl+Z=26
  if (input && input.length === 1) {
    const code = input.charCodeAt(0);
    // Keep plain tab/newline/return as special keys, but allow explicit Ctrl+I/J/M.
    const isPlainSpecialControl = !key.ctrl && (code === 9 || code === 10 || code === 13);
    if (code >= 1 && code <= 26 && !isPlainSpecialControl) {
      char = String.fromCharCode(code + 96); // Convert to a-z
      isCtrl = true;
    }
  }

  // Build modifier prefix in consistent order
  if (isCtrl) parts.push("ctrl");
  if (key.meta) parts.push("cmd");
  if (key.escape && !isCtrl && !isPureEsc) parts.push("alt");
  if (key.shift) parts.push("shift");

  if (specialKey) {
    parts.push(specialKey);
    return parts.join("+");
  }

  // Add the key character
  if (char && char.length === 1) {
    parts.push(char.toLowerCase());
  } else {
    return null; // Not a simple key combo we can match
  }

  return parts.join("+");
}

// ============================================================
// Lookup Refresh
// ============================================================

/**
 * Rebuild lookup maps from keybinding definitions and config.
 * Call this:
 * - Once on startup (done in index.ts)
 * - After user rebinds a key (in handleRebind)
 */
export function refreshKeybindingLookup(): void {
  customMap.clear();
  disabledDefaults.clear();
  defaultMap.clear();

  // Build custom map and disabled defaults from config (via global cache)
  const customBindings = config.keybindings.snapshot ?? {};

  // Single pass over all keybindings (builds both defaultMap and customMap)
  for (const kb of registry.getAll()) {
    if (kb.action.type !== "HANDLER") continue;

    const defaultCombo = displayToCombo(kb.display);
    if (defaultCombo) {
      defaultMap.set(defaultCombo, kb.action.id);
    }

    const customCombo = customBindings[kb.id];
    if (customCombo) {
      // Add to custom map
      const normalized = normalizeStoredCombo(customCombo);
      customMap.set(normalized, kb.action.id);

      // Mark old default as disabled (user rebound it)
      if (defaultCombo && defaultCombo !== normalized) {
        disabledDefaults.set(defaultCombo, true);
      }
    }
  }
}

// ============================================================
// Public Query API
// ============================================================

/**
 * Match a key input to a custom binding.
 * @returns handler ID if custom binding exists, null otherwise
 */
export function matchCustomKeybinding(input: string, key: Key): string | null {
  const combo = normalizeKeyInput(input, key);
  if (!combo) return null;
  return customMap.get(combo) ?? null;
}

/**
 * Check if a default keybinding has been disabled (rebound to something else).
 * When user rebinds Ctrl+G to Ctrl+J, Ctrl+G becomes disabled.
 */
export function isDefaultDisabled(input: string, key: Key): boolean {
  const combo = normalizeKeyInput(input, key);
  if (!combo) return false;
  return disabledDefaults.has(combo);
}

/**
 * Get effective display for a keybinding (custom override or null).
 * Used by getDisplay() to show custom bindings in palette.
 */
export function getEffectiveDisplay(keybindingId: string): string | null {
  const customBindings = config.keybindings.snapshot ?? {};
  return customBindings[keybindingId] ?? null;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Convert display format to normalized combo.
 * "^G" -> "ctrl+g"
 * "Ctrl+G" -> "ctrl+g"
 * "⌥G" -> "alt+g"
 */
function displayToCombo(display: string): string | null {
  const normalizedDisplay = display.toLowerCase().trim();
  const SPECIAL_DISPLAY_MAP: Readonly<Record<string, string>> = {
    tab: "tab",
    enter: "enter",
    esc: "esc",
    escape: "esc",
    up: "up",
    down: "down",
    left: "left",
    right: "right",
    backspace: "backspace",
    delete: "delete",
  };
  if (SPECIAL_DISPLAY_MAP[normalizedDisplay]) {
    return SPECIAL_DISPLAY_MAP[normalizedDisplay];
  }

  // Handle "^X" format (caret notation)
  if (display.startsWith("^") && display.length === 2) {
    return `ctrl+${display[1].toLowerCase()}`;
  }

  // Handle "Ctrl+X", "Ctrl+Shift+X" format
  const parts = display.split("+");
  if (parts.length >= 2) {
    const normalized: string[] = [];
    for (let i = 0; i < parts.length - 1; i++) {
      const mod = parts[i].toLowerCase();
      if (mod === "ctrl" || mod === "control") normalized.push("ctrl");
      else if (mod === "cmd" || mod === "meta" || mod === "⌘") normalized.push("cmd");
      else if (mod === "alt" || mod === "option" || mod === "opt" || mod === "⌥") normalized.push("alt");
      else if (mod === "shift" || mod === "⇧") normalized.push("shift");
    }
    const key = parts[parts.length - 1].toLowerCase();
    normalized.push(key);
    return normalized.join("+");
  }

  return null;
}

/**
 * Normalize stored combo string from config.
 * "Ctrl+J" -> "ctrl+j"
 */
function normalizeStoredCombo(combo: string): string {
  const parts = combo.toLowerCase().split("+").map((p) => p.trim());

  // Normalize modifier names
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === "control") normalized.push("ctrl");
    else if (part === "meta" || part === "command") normalized.push("cmd");
    else if (part === "option" || part === "opt") normalized.push("alt");
    else normalized.push(part);
  }

  return normalized.join("+");
}
