/**
 * Shared list search helpers for Ink picker/panel UIs.
 *
 * Centralizes the "type to search" trigger logic so searchable lists
 * stay consistent without duplicating key classification rules.
 */

import type { KeyInfo } from "./text-editing.ts";

interface ListSearchSeedOptions {
  reservedSingleKeys?: Iterable<string>;
}

/**
 * Returns sanitized typed text that should start or continue search
 * from list-navigation mode, or null when input should be treated as
 * a non-search shortcut/navigation key.
 */
export function getListSearchSeed(
  input: string,
  key: KeyInfo,
  options: ListSearchSeedOptions = {},
): string | null {
  if (!input) return null;

  if (
    key.ctrl || key.meta || key.escape || key.return || key.tab ||
    key.backspace || key.delete || key.upArrow || key.downArrow ||
    key.leftArrow || key.rightArrow
  ) {
    return null;
  }

  const sanitized = input.replace(/[\r\n]/g, "");
  if (!sanitized) return null;

  for (const ch of sanitized) {
    if (ch.charCodeAt(0) <= 31) return null;
  }

  if (sanitized.length === 1) {
    const reserved = options.reservedSingleKeys;
    if (reserved) {
      for (const k of reserved) {
        if (k === sanitized) return null;
      }
    }
  }

  return sanitized;
}
