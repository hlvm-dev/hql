// Global type declarations for the Ink fork
// Stub — CC's build generates this, we define it manually

declare const Bun: {
  stringWidth?: (str: string, options?: { countAnsiEscapeCodes?: boolean }) => number;
  wrapAnsi?: (str: string, width: number, options?: { hard?: boolean; trim?: boolean }) => string;
} | undefined;
