/**
 * HLVM Theme System
 *
 * React Context-based theming (preferred approach):
 * - ThemeProvider: Wrap app to enable theming
 * - useTheme(): Access theme in any component
 * - useSemanticColors(): Access structured semantic color tokens
 *
 * ANSI helpers (for raw terminal output):
 * - getThemedAnsi(): Get ANSI escape codes for current theme
 */

import { useMemo } from "react";
import { THEMES, type ThemePalette } from "./palettes.ts";
import { buildSemanticColors, type SemanticColors } from "./semantic.ts";
import { useTheme } from "./ThemeContext.tsx";
import { getCurrentThemeName } from "./state.ts";
export { THEMES, THEME_NAMES, type ThemeName, type ThemePalette } from "./palettes.ts";
export { type SemanticColors } from "./semantic.ts";

// ============================================================
// React Context-based theming (preferred)
// ============================================================

export {
  ThemeProvider,
  useTheme,
  ThemeContext,
  type ThemeContextValue,
  type ThemeProviderProps,
} from "./ThemeContext.tsx";

// ============================================================
// Semantic Colors Hook
// ============================================================

/**
 * useSemanticColors - Access structured semantic color tokens.
 * Derives all colors from current theme palette — no new values.
 *
 * @example
 * ```tsx
 * const sc = useSemanticColors();
 * return <Text color={sc.status.success}>Done</Text>;
 * ```
 */
export function useSemanticColors(): SemanticColors {
  const { theme } = useTheme();
  return useMemo(() => buildSemanticColors(theme), [theme]);
}

// ============================================================
// ANSI Terminal Output (for non-React code)
// ============================================================

/**
 * Convert hex color to ANSI 24-bit escape code
 * @internal Used by getThemedAnsi
 */
const hexCache = new Map<string, string>();
function hexToAnsi(hex: string): string {
  const cached = hexCache.get(hex);
  if (cached) return cached;
  const cleanHex = hex.replace("#", "");
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  const result = `\x1b[38;2;${r};${g};${b}m`;
  hexCache.set(hex, result);
  return result;
}

const ANSI_RESET = "\x1b[0m";

// Single-entry caches keyed on theme name — avoids rebuilding identical objects
// every keystroke while still updating when the user switches themes.
let _themedAnsiCache: {
  key: string;
  value: Record<keyof ThemePalette | "reset", string>;
} | null = null;
let _syntaxAnsiCache: {
  key: string;
  value: Record<string, string> & { reset: string };
} | null = null;

/**
 * Get themed ANSI escape codes for raw terminal output.
 * Use this for building ANSI strings outside of React components.
 *
 * @example
 * ```ts
 * const ansi = getThemedAnsi();
 * console.log(ansi.primary + "Hello" + ansi.reset);
 * ```
 */
export function getThemedAnsi(): Record<keyof ThemePalette | "reset", string> {
  const themeName = getCurrentThemeName();
  if (_themedAnsiCache && _themedAnsiCache.key === themeName) {
    return _themedAnsiCache.value;
  }
  const theme = THEMES[themeName] || THEMES.sicp;
  const value = {
    primary: hexToAnsi(theme.primary),
    secondary: hexToAnsi(theme.secondary),
    accent: hexToAnsi(theme.accent),
    success: hexToAnsi(theme.success),
    warning: hexToAnsi(theme.warning),
    error: hexToAnsi(theme.error),
    muted: hexToAnsi(theme.muted),
    text: hexToAnsi(theme.text),
    bg: hexToAnsi(theme.bg),
    reset: ANSI_RESET,
  };
  _themedAnsiCache = { key: themeName, value };
  return value;
}

/** Syntax token -> themed ANSI color mapping for REPL highlighting */
export function getSyntaxAnsi(): Record<string, string> & { reset: string } {
  const themeName = getCurrentThemeName();
  if (_syntaxAnsiCache && _syntaxAnsiCache.key === themeName) {
    return _syntaxAnsiCache.value;
  }
  const theme = THEMES[themeName] || THEMES.sicp;
  const value = {
    keyword: hexToAnsi(theme.primary),
    macro: hexToAnsi(theme.secondary),
    string: hexToAnsi(theme.secondary),
    number: hexToAnsi(theme.accent),
    operator: hexToAnsi(theme.accent),
    boolean: hexToAnsi(theme.warning),
    nil: hexToAnsi(theme.muted),
    comment: hexToAnsi(theme.muted),
    delimiter: hexToAnsi(theme.muted),
    functionCall: hexToAnsi(theme.primary),
    reset: ANSI_RESET,
  };
  _syntaxAnsiCache = { key: themeName, value };
  return value;
}
