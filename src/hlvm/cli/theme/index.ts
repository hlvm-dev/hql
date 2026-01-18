/**
 * HLVM Theme System
 *
 * React Context-based theming (preferred approach):
 * - ThemeProvider: Wrap app to enable theming
 * - useTheme(): Access theme in any component
 *
 * ANSI helpers (for raw terminal output):
 * - getThemedAnsi(): Get ANSI escape codes for current theme
 */

import { THEMES, type ThemeName, type ThemePalette } from "./palettes.ts";
import { config } from "../../api/config.ts";
export { THEMES, THEME_NAMES, type ThemeName, type ThemePalette } from "./palettes.ts";

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
// ANSI Terminal Output (for non-React code)
// ============================================================

/**
 * Convert hex color to ANSI 24-bit escape code
 * @internal Used by getThemedAnsi
 */
function hexToAnsi(hex: string): string {
  const cleanHex = hex.replace("#", "");
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

const ANSI_RESET = "\x1b[0m";

/**
 * Get current theme from config API snapshot (sync)
 * @internal Used by getThemedAnsi
 */
function getCurrentTheme(): ThemePalette {
  const themeName = (config.snapshot?.theme || "sicp") as ThemeName;
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
