/**
 * Overlay Renderer
 *
 * Core utilities for drawing floating overlays on top of Ink's output
 * using raw ANSI escape codes.
 *
 * How it works:
 * 1. Save current cursor position
 * 2. Move cursor to absolute screen coordinates
 * 3. Draw content line by line
 * 4. Restore cursor position
 *
 * The key insight: Later terminal writes overwrite earlier ones (painter's algorithm).
 * So we draw the overlay AFTER Ink renders, and it appears on top.
 */

import { getPlatform } from "../../../../platform/platform.ts";
import { DEFAULT_TERMINAL_HEIGHT, DEFAULT_TERMINAL_WIDTH } from "../ui-constants.ts";

// ANSI escape sequences
const ESC = "\x1b";
const CSI = `${ESC}[`;

/**
 * ANSI escape code utilities for terminal manipulation
 */
export const ansi = {
  /** Move cursor to absolute position (0-indexed) */
  cursorTo: (x: number, y: number): string => `${CSI}${y + 1};${x + 1}H`,

  /** Save cursor position */
  cursorSave: `${ESC}7`,

  /** Restore cursor position */
  cursorRestore: `${ESC}8`,

  /** Hide cursor */
  cursorHide: `${CSI}?25l`,

  /** Show cursor */
  cursorShow: `${CSI}?25h`,

  /** Reset all styles */
  reset: `${CSI}0m`,

  /** Bold text */
  bold: `${CSI}1m`,

  /** Inverse/reverse video */
  inverse: `${CSI}7m`,

  /** Set foreground color (24-bit RGB) */
  fg: (r: number, g: number, b: number): string => `${CSI}38;2;${r};${g};${b}m`,

  /** Set background color (24-bit RGB) */
  bg: (r: number, g: number, b: number): string => `${CSI}48;2;${r};${g};${b}m`,
};

/** Shared encoder for terminal output */
export const overlayEncoder = new TextEncoder();

/** Region to clear on screen */
export interface ClearRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Clear a region of the screen (restore what was behind overlay).
 * Note: This doesn't restore original content - Ink will need to re-render.
 */
export function clearOverlay(region: ClearRegion): void {
  const { x, y, width, height } = region;

  let output = "";
  output += ansi.cursorSave;

  for (let i = 0; i < height; i++) {
    output += ansi.cursorTo(x, y + i);
    output += " ".repeat(width);
  }

  output += ansi.cursorRestore;

  getPlatform().terminal.stdout.writeSync(overlayEncoder.encode(output));
}

/**
 * Get terminal dimensions
 */
export function getTerminalSize(): { columns: number; rows: number } {
  try {
    const size = getPlatform().terminal.consoleSize();
    return {
      columns: size.columns || DEFAULT_TERMINAL_WIDTH,
      rows: size.rows || DEFAULT_TERMINAL_HEIGHT,
    };
  } catch {
    return { columns: DEFAULT_TERMINAL_WIDTH, rows: DEFAULT_TERMINAL_HEIGHT };
  }
}

/**
 * Convert hex color string to RGB tuple for ANSI
 * @param hex - Color in hex format (e.g., "#ff6600" or "ff6600")
 * @returns RGB tuple [r, g, b]
 */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b];
}

// ============================================================
// Shared Overlay Helpers (DRY — used by all overlay components)
// ============================================================

/** RGB color tuple */
export type RGB = [number, number, number];

/** Default overlay background color */
export const OVERLAY_BG_COLOR: RGB = [35, 35, 40];

/** Create ANSI foreground color string from RGB */
export function fg(rgb: RGB): string {
  return ansi.fg(rgb[0], rgb[1], rgb[2]);
}

/** Create ANSI background color string from RGB */
export function bg(rgb: RGB): string {
  return ansi.bg(rgb[0], rgb[1], rgb[2]);
}

/** Calculate centered overlay position */
export function calcOverlayPosition(width: number, height: number): { x: number; y: number } {
  const term = getTerminalSize();
  return {
    x: Math.max(2, Math.floor((term.columns - width) / 2)),
    y: Math.max(2, Math.floor((term.rows - height) / 2)),
  };
}

/** Write raw ANSI output to terminal */
export function writeToTerminal(output: string): void {
  getPlatform().terminal.stdout.writeSync(overlayEncoder.encode(output));
}
