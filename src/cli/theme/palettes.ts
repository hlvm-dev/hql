/**
 * HQL Theme Palettes
 * All color theme definitions for the REPL
 */

// ============================================================
// Theme Interface
// ============================================================

export interface ThemePalette {
  primary: string;    // Prompt, logo, spinner, keywords
  secondary: string;  // Macros, special forms
  accent: string;     // Code examples, selections, cyan elements
  success: string;    // Labels, status messages, green elements
  warning: string;    // Highlights, yellow elements
  error: string;      // Error messages, red elements
  muted: string;      // Comments, hints, dim text
  text: string;       // Default text color
  bg: string;         // Background (reference only, terminal handles this)
}

// ============================================================
// Theme Palettes
// ============================================================

/**
 * SICP Theme (Default)
 * Inspired by the iconic SICP book cover:
 * - Purple background (the book's main color)
 * - Red rectangle (where the wizard illustration sits)
 * - Lambda symbol in starburst
 */
export const sicp: ThemePalette = {
  primary: "#663399",      // Rebecca Purple (the actual SICP book cover purple!)
  secondary: "#dc3545",    // RED (book's iconic red rectangle!)
  accent: "#f8f8f2",       // White/light (like the lambda starburst)
  success: "#22c55e",      // Green
  warning: "#ffd700",      // Gold/Yellow (like lambda glow)
  error: "#dc3545",        // Red
  muted: "#8a8a8a",        // Gray
  text: "#f8f8f2",         // Light text
  bg: "#663399",           // Rebecca Purple (book cover background)
};

/**
 * Dracula Theme
 * Popular dark theme with vibrant colors
 */
export const dracula: ThemePalette = {
  primary: "#bd93f9",      // Purple
  secondary: "#ff79c6",    // Pink
  accent: "#8be9fd",       // Cyan
  success: "#50fa7b",      // Green
  warning: "#f1fa8c",      // Yellow
  error: "#ff5555",        // Red
  muted: "#6272a4",        // Comment
  text: "#f8f8f2",         // Foreground
  bg: "#282a36",           // Background
};

/**
 * Monokai Theme
 * Classic dark theme from Sublime Text
 */
export const monokai: ThemePalette = {
  primary: "#ae81ff",      // Purple
  secondary: "#f92672",    // Pink/Magenta
  accent: "#66d9ef",       // Cyan
  success: "#a6e22e",      // Green
  warning: "#e6db74",      // Yellow
  error: "#f92672",        // Red/Pink
  muted: "#75715e",        // Comment
  text: "#f8f8f2",         // Foreground
  bg: "#272822",           // Background
};

/**
 * Nord Theme
 * Arctic, bluish clean theme
 */
export const nord: ThemePalette = {
  primary: "#81a1c1",      // Frost Blue
  secondary: "#b48ead",    // Purple
  accent: "#88c0d0",       // Cyan
  success: "#a3be8c",      // Green
  warning: "#ebcb8b",      // Yellow
  error: "#bf616a",        // Red
  muted: "#4c566a",        // Comment
  text: "#eceff4",         // Snow
  bg: "#2e3440",           // Polar night
};

/**
 * One Dark Theme
 * Popular Atom/VS Code theme
 */
export const oneDark: ThemePalette = {
  primary: "#c678dd",      // Purple
  secondary: "#e06c75",    // Red
  accent: "#56b6c2",       // Cyan
  success: "#98c379",      // Green
  warning: "#e5c07b",      // Yellow
  error: "#e06c75",        // Red
  muted: "#5c6370",        // Comment
  text: "#abb2bf",         // Foreground
  bg: "#282c34",           // Background
};

/**
 * Solarized Dark Theme
 * Ethan Schoonover's precision colors
 */
export const solarizedDark: ThemePalette = {
  primary: "#6c71c4",      // Violet
  secondary: "#d33682",    // Magenta
  accent: "#2aa198",       // Cyan
  success: "#859900",      // Green
  warning: "#b58900",      // Yellow
  error: "#dc322f",        // Red
  muted: "#586e75",        // Base01
  text: "#839496",         // Base0
  bg: "#002b36",           // Base03
};

/**
 * Solarized Light Theme
 * Light variant of Solarized
 */
export const solarizedLight: ThemePalette = {
  primary: "#6c71c4",      // Violet
  secondary: "#d33682",    // Magenta
  accent: "#2aa198",       // Cyan
  success: "#859900",      // Green
  warning: "#b58900",      // Yellow
  error: "#dc322f",        // Red
  muted: "#93a1a1",        // Base1
  text: "#657b83",         // Base00
  bg: "#fdf6e3",           // Base3
};

/**
 * Gruvbox Dark Theme
 * Retro groove color scheme
 */
export const gruvbox: ThemePalette = {
  primary: "#d3869b",      // Purple
  secondary: "#fb4934",    // Red
  accent: "#83a598",       // Aqua
  success: "#b8bb26",      // Green
  warning: "#fabd2f",      // Yellow
  error: "#fb4934",        // Red
  muted: "#928374",        // Gray
  text: "#ebdbb2",         // Foreground
  bg: "#282828",           // Background
};

// ============================================================
// Theme Registry
// ============================================================

export const THEMES = {
  sicp,
  dracula,
  monokai,
  nord,
  oneDark,
  solarizedDark,
  solarizedLight,
  gruvbox,
} as const;

export type ThemeName = keyof typeof THEMES;

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];
