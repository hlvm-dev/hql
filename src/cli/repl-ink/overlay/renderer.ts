/**
 * Overlay Renderer
 *
 * Draws floating content on top of Ink's output using raw ANSI escape codes.
 * This allows true overlay/modal behavior that Ink doesn't natively support.
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

// ANSI escape sequences for cursor manipulation
const ESC = "\x1b";
const CSI = `${ESC}[`;

// Cursor positioning
export const ansi = {
  /** Move cursor to absolute position (0-indexed) */
  cursorTo: (x: number, y: number): string => `${CSI}${y + 1};${x + 1}H`,

  /** Save cursor position (works on most terminals) */
  cursorSave: `${ESC}7`,

  /** Restore cursor position */
  cursorRestore: `${ESC}8`,

  /** Hide cursor */
  cursorHide: `${CSI}?25l`,

  /** Show cursor */
  cursorShow: `${CSI}?25h`,

  /** Clear from cursor to end of line */
  clearToEndOfLine: `${CSI}K`,

  /** Clear entire line */
  clearLine: `${CSI}2K`,

  /** Move cursor up N lines */
  cursorUp: (n: number): string => `${CSI}${n}A`,

  /** Move cursor down N lines */
  cursorDown: (n: number): string => `${CSI}${n}B`,

  /** Colors and styles */
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  inverse: `${CSI}7m`,
  fg: (r: number, g: number, b: number): string => `${CSI}38;2;${r};${g};${b}m`,
  bg: (r: number, g: number, b: number): string => `${CSI}48;2;${r};${g};${b}m`,
};

/** Box drawing characters */
export const box = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
};

export interface OverlayConfig {
  /** X position (0 = left edge) */
  x: number;
  /** Y position (0 = top edge) */
  y: number;
  /** Width of the overlay box */
  width: number;
  /** Height of the overlay box */
  height: number;
  /** Title shown in top border */
  title?: string;
  /** Border color (RGB) */
  borderColor?: [number, number, number];
  /** Background color (RGB) */
  bgColor?: [number, number, number];
}

export interface OverlayLine {
  /** Text content (will be truncated to fit width) */
  text: string;
  /** Is this line selected/highlighted? */
  selected?: boolean;
  /** Text color (RGB) */
  color?: [number, number, number];
  /** Bold text? */
  bold?: boolean;
  /** Dim text? */
  dim?: boolean;
}

/**
 * Draw a floating overlay box at absolute screen coordinates.
 * This writes directly to stdout, bypassing Ink's rendering.
 */
export function drawOverlay(
  config: OverlayConfig,
  lines: OverlayLine[],
  footer?: string
): void {
  const { x, y, width, height, title, borderColor, bgColor } = config;

  // Build the output string
  let output = "";

  // Save cursor position
  output += ansi.cursorSave;
  output += ansi.cursorHide;

  // Colors
  const borderStyle = borderColor
    ? ansi.fg(borderColor[0], borderColor[1], borderColor[2])
    : ansi.fg(100, 100, 100);
  const bgStyle = bgColor
    ? ansi.bg(bgColor[0], bgColor[1], bgColor[2])
    : ansi.bg(30, 30, 30);

  // Calculate inner width (accounting for borders)
  const innerWidth = width - 2;

  // Draw top border
  output += ansi.cursorTo(x, y);
  output += borderStyle;
  output += box.topLeft;
  if (title) {
    const titleText = ` ${title} `;
    const remaining = innerWidth - titleText.length;
    const leftPad = Math.floor(remaining / 2);
    const rightPad = remaining - leftPad;
    output += box.horizontal.repeat(leftPad);
    output += ansi.bold + titleText + ansi.reset + borderStyle;
    output += box.horizontal.repeat(rightPad);
  } else {
    output += box.horizontal.repeat(innerWidth);
  }
  output += box.topRight;

  // Draw content lines
  const contentHeight = height - 2; // Subtract top and bottom borders
  for (let i = 0; i < contentHeight; i++) {
    output += ansi.cursorTo(x, y + 1 + i);
    output += borderStyle + box.vertical + ansi.reset;

    const line = lines[i];
    if (line) {
      // Apply background
      output += bgStyle;

      // Apply selection highlight
      if (line.selected) {
        output += ansi.inverse;
      }

      // Apply text styles
      if (line.bold) output += ansi.bold;
      if (line.dim) output += ansi.dim;
      if (line.color) {
        output += ansi.fg(line.color[0], line.color[1], line.color[2]);
      }

      // Truncate or pad text to fit
      const text = line.text.slice(0, innerWidth).padEnd(innerWidth);
      output += text;
      output += ansi.reset;
    } else {
      // Empty line with background
      output += bgStyle + " ".repeat(innerWidth) + ansi.reset;
    }

    output += borderStyle + box.vertical + ansi.reset;
  }

  // Draw bottom border
  output += ansi.cursorTo(x, y + height - 1);
  output += borderStyle;
  output += box.bottomLeft;
  if (footer) {
    const footerText = ` ${footer} `;
    const remaining = innerWidth - footerText.length;
    const leftPad = Math.floor(remaining / 2);
    const rightPad = remaining - leftPad;
    output += box.horizontal.repeat(leftPad);
    output += ansi.dim + footerText + ansi.reset + borderStyle;
    output += box.horizontal.repeat(rightPad);
  } else {
    output += box.horizontal.repeat(innerWidth);
  }
  output += box.bottomRight;

  // Restore cursor position
  output += ansi.reset;
  output += ansi.cursorRestore;
  output += ansi.cursorShow;

  // Write directly to stdout
  process.stdout.write(output);
}

/**
 * Clear a region of the screen (restore what was behind overlay).
 * Note: This doesn't restore the original content - Ink will need to re-render.
 */
export function clearOverlay(config: OverlayConfig): void {
  const { x, y, width, height } = config;

  let output = "";
  output += ansi.cursorSave;

  for (let i = 0; i < height; i++) {
    output += ansi.cursorTo(x, y + i);
    output += " ".repeat(width);
  }

  output += ansi.cursorRestore;
  process.stdout.write(output);
}

/**
 * Get terminal dimensions
 */
export function getTerminalSize(): { columns: number; rows: number } {
  return {
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

/**
 * Calculate centered position for an overlay
 */
export function centerOverlay(
  width: number,
  height: number
): { x: number; y: number } {
  const term = getTerminalSize();
  return {
    x: Math.max(0, Math.floor((term.columns - width) / 2)),
    y: Math.max(0, Math.floor((term.rows - height) / 2)),
  };
}
