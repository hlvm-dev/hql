/**
 * Keybindings Registry - Type Definitions
 *
 * Central type definitions for the keybindings system.
 * Used by: CommandPaletteOverlay, /help generation, registry.
 */

import { config } from "../../../api/config.ts";
import { getPlatform as getHostPlatform } from "../../../../platform/platform.ts";

// ============================================================
// Category Types
// ============================================================

/** Categories for grouping in palette and help */
export type KeybindingCategory =
  | "Global"
  | "Editing"
  | "Navigation"
  | "Completion"
  | "History"
  | "Paredit"
  | "Commands";

// ============================================================
// Action Types
// ============================================================

/** Execution behavior when selected from palette */
export type KeybindingAction =
  | { type: "HANDLER"; id: string }        // Call handler by ID (e.g., "app.exit")
  | { type: "SLASH_COMMAND"; cmd: string } // Run slash command (e.g., "/config")
  | { type: "INFO" };                      // Display only (can't execute from palette)

// ============================================================
// Platform Types
// ============================================================

/** Platform for display variants */
export type Platform = "darwin" | "linux" | "win32";

// ============================================================
// Keybinding Definition
// ============================================================

/**
 * A single keybinding definition.
 * Immutable - all properties are readonly.
 */
export interface Keybinding {
  /** Unique identifier (e.g., "ctrl+l", "slurp-forward") */
  readonly id: string;

  /** Human-readable display (e.g., "Ctrl+L", "Ctrl+Shift+)") */
  readonly display: string;

  /** Platform-specific display variants (optional) */
  readonly displayByPlatform?: Partial<Record<Platform, string>>;

  /** Short label for palette display (e.g., "Clear screen") */
  readonly label: string;

  /** Extended description for help/docs (optional) */
  readonly description?: string;

  /** Category for grouping */
  readonly category: KeybindingCategory;

  /** What happens when executed from palette */
  readonly action: KeybindingAction;
}

// ============================================================
// Search Result Types
// ============================================================

/** Search result with fuzzy match info */
export interface KeybindingMatch {
  readonly keybinding: Keybinding;
  readonly score: number;
  readonly indices: readonly number[];
}

// ============================================================
// Category Order (for display)
// ============================================================

/** Order of categories in palette and help */
export const CATEGORY_ORDER: readonly KeybindingCategory[] = [
  "Global",
  "Editing",
  "Navigation",
  "Completion",
  "History",
  "Paredit",
  "Commands",
];

// ============================================================
// Platform Detection
// ============================================================

/** Get current platform */
export function getPlatform(): Platform {
  const os = getHostPlatform().build.os;
  if (os === "darwin") return "darwin";
  if (os === "windows") return "win32";
  return "linux";
}

/** Get display string for keybinding on current platform */
export function getDisplay(kb: Keybinding): string {
  // Check for custom override first
  const customBindings = config.keybindings.snapshot ?? {};
  const customCombo = customBindings[kb.id];
  if (customCombo) {
    return customCombo;
  }

  // Fall back to default (with platform-specific variant if available)
  const platform = getPlatform();
  return kb.displayByPlatform?.[platform] ?? kb.display;
}
