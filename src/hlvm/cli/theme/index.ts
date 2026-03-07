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
import { THEMES, type ThemeName, type ThemePalette } from "./palettes.ts";
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

/**
 * Get current theme from config API snapshot (sync)
 * @internal Used by getThemedAnsi
 */
function getCurrentTheme(): ThemePalette {
  const themeName = getCurrentThemeName();
  return THEMES[themeName] || THEMES.sicp;
}

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
  const theme = getCurrentTheme();
  return {
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
}

/** Syntax token -> themed ANSI color mapping for REPL highlighting */
export function getSyntaxAnsi(): Record<string, string> & { reset: string } {
  const theme = getCurrentTheme();
  return {
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
}
