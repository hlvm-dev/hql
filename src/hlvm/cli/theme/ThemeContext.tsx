/**
 * HLVM Theme Context
 *
 * React Context-based theming - the standard pattern used by:
 * - Material-UI, Chakra UI, styled-components
 * - Professional CLIs like Claude Code, OpenCode
 *
 * Benefits:
 * - Components auto-update when theme changes (React context)
 * - No scattered getColor() calls
 * - No hacky forceUpdate workarounds
 * - Hot-reload built into React's reconciliation
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { THEMES, type ThemeName, type ThemePalette } from "./palettes.ts";
import { ValidationError } from "../../../common/error.ts";
import { getCurrentThemeName, normalizeThemeName, setCurrentThemeName } from "./state.ts";

// ============================================================
// Types
// ============================================================

interface ThemeContextValue {
  /** Current theme palette */
  theme: ThemePalette;
  /** Current theme name */
  themeName: ThemeName;
  /** Change the current theme */
  setTheme: (name: ThemeName) => void;
  /** Get a specific color from current theme */
  color: (key: keyof ThemePalette) => string;
}

// ============================================================
// Context
// ============================================================

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ============================================================
// Provider
// ============================================================

interface ThemeProviderProps {
  children?: React.ReactNode;
  /** Initial theme name (default: from config snapshot or "sicp") */
  initialTheme?: ThemeName;
}

/**
 * ThemeProvider - Wrap your app to enable theming
 *
 * @example
 * ```tsx
 * <ThemeProvider>
 *   <App />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({ children, initialTheme }: ThemeProviderProps): React.ReactElement {
  const getInitialTheme = (): ThemeName => {
    return setCurrentThemeName(initialTheme ?? getCurrentThemeName());
  };

  const [themeName, setThemeName] = useState<ThemeName>(getInitialTheme);

  const setTheme = useCallback((name: ThemeName) => {
    if (name in THEMES) {
      const normalized = normalizeThemeName(name);
      setCurrentThemeName(normalized);
      setThemeName(normalized);
    }
  }, []);

  const theme = useMemo((): ThemePalette => {
    return THEMES[themeName as keyof typeof THEMES] ?? THEMES.sicp;
  }, [themeName]);

  const color = useCallback((key: keyof ThemePalette) => theme[key], [theme]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    themeName,
    setTheme,
    color,
  }), [theme, themeName, setTheme, color]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// ============================================================
// Hook
// ============================================================

/**
 * useTheme - Access theme in any component
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { color, setTheme } = useTheme();
 *   return <Text color={color("primary")}>Hello</Text>;
 * }
 * ```
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new ValidationError("useTheme must be used within a ThemeProvider", "useTheme");
  }
  return context;
}
