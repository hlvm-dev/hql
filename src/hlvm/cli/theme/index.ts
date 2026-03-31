/**
 * HLVM Theme System
 *
 * React Context-based theming:
 * - ThemeProvider: Wrap app to enable theming
 * - useTheme(): Access theme in any component
 * - useSemanticColors(): Access structured semantic color tokens
 */

import { useMemo } from "react";
import { buildSemanticColors, type SemanticColors } from "./semantic.ts";
import { useTheme } from "./ThemeContext.tsx";
export { THEMES, THEME_NAMES, type ThemeName, type ThemePalette } from "./palettes.ts";
export { type SemanticColors } from "./semantic.ts";

// ============================================================
// React Context-based theming (preferred)
// ============================================================

export {
  ThemeProvider,
  useTheme,
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

