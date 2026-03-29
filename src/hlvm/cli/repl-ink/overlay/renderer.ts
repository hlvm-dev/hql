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
import { buildSemanticColors } from "../../theme/semantic.ts";
import type { ThemePalette } from "../../theme/palettes.ts";
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
const overlayEncoder = new TextEncoder();

/** Region to clear on screen */
export interface ClearRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fitted overlay rectangle within the current terminal viewport. */
interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayFrame extends ClearRegion {
  clipped: boolean;
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
function getTerminalSize(): { columns: number; rows: number } {
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
function hexToRgb(hex: string): [number, number, number] {
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

/** Create ANSI foreground color string from RGB */
export function fg(rgb: RGB): string {
  return ansi.fg(rgb[0], rgb[1], rgb[2]);
}

/** Create ANSI background color string from RGB */
export function bg(rgb: RGB): string {
  return ansi.bg(rgb[0], rgb[1], rgb[2]);
}

const ROUND_BORDER = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
} as const;

function truncateFrameLabel(label: string, maxWidth: number): string {
  const glyphs = Array.from(label);
  if (glyphs.length <= maxWidth) return label;
  if (maxWidth <= 0) return "";
  if (maxWidth === 1) return "…";
  return `${glyphs.slice(0, maxWidth - 1).join("")}…`;
}

export function buildOverlayFrameText(
  width: number,
  options: { title?: string; rightText?: string } = {},
): { top: string; bottom: string } {
  if (width <= 0) {
    return { top: "", bottom: "" };
  }
  if (width === 1) {
    return {
      top: ROUND_BORDER.topLeft,
      bottom: ROUND_BORDER.bottomLeft,
    };
  }

  const innerWidth = Math.max(0, width - 2);
  const topCells: string[] = Array.from(
    { length: innerWidth },
    () => ROUND_BORDER.horizontal,
  );
  let titleLabel = options.title?.trim() ? ` ${options.title.trim()} ` : "";
  let rightLabel = options.rightText?.trim() ? ` ${options.rightText.trim()} ` : "";

  if (rightLabel.length > innerWidth) {
    rightLabel = truncateFrameLabel(rightLabel, innerWidth);
  }

  const reservedRight = rightLabel ? rightLabel.length + 1 : 0;
  const maxTitleWidth = Math.max(0, innerWidth - reservedRight - 1);
  if (titleLabel.length > maxTitleWidth) {
    titleLabel = truncateFrameLabel(titleLabel, maxTitleWidth);
  }

  const writeLabel = (label: string, start: number): void => {
    Array.from(label).forEach((glyph, index) => {
      const target = start + index;
      if (target >= 0 && target < topCells.length) {
        topCells[target] = glyph;
      }
    });
  };

  if (titleLabel) {
    writeLabel(
      titleLabel,
      Math.min(1, Math.max(0, innerWidth - titleLabel.length)),
    );
  }

  if (rightLabel) {
    const rightStart = Math.max(
      titleLabel.length > 0 ? titleLabel.length + 2 : 0,
      innerWidth - rightLabel.length - 1,
    );
    writeLabel(rightLabel, Math.max(0, rightStart));
  }

  return {
    top: `${ROUND_BORDER.topLeft}${topCells.join("")}${ROUND_BORDER.topRight}`,
    bottom:
      `${ROUND_BORDER.bottomLeft}${ROUND_BORDER.horizontal.repeat(innerWidth)}${ROUND_BORDER.bottomRight}`,
  };
}

export function drawOverlayFrame(
  frame: Pick<ClearRegion, "x" | "y" | "width" | "height">,
  options: {
    borderColor: RGB;
    backgroundColor?: RGB;
    title?: string;
    rightText?: string;
  },
): string {
  if (frame.width <= 0 || frame.height <= 0) return "";

  const backgroundColor = options.backgroundColor ?? options.borderColor;
  const borderStyle = fg(options.borderColor);
  const backgroundStyle = bg(backgroundColor);
  const { top, bottom } = buildOverlayFrameText(frame.width, {
    title: options.title,
    rightText: options.rightText,
  });

  let output = "";
  output += ansi.cursorTo(frame.x, frame.y) + backgroundStyle + borderStyle + top;

  for (let row = 1; row < Math.max(1, frame.height - 1); row++) {
    if (row >= frame.height - 1) break;
    output += ansi.cursorTo(frame.x, frame.y + row) + backgroundStyle +
      borderStyle + ROUND_BORDER.vertical;
    output += ansi.cursorTo(frame.x + frame.width - 1, frame.y + row) +
      backgroundStyle + borderStyle + ROUND_BORDER.vertical;
  }

  if (frame.height > 1) {
    output += ansi.cursorTo(frame.x, frame.y + frame.height - 1) +
      backgroundStyle + borderStyle + bottom;
  }

  return output + ansi.reset;
}

/** Calculate centered overlay position */
function calcOverlayPosition(width: number, height: number): { x: number; y: number } {
  const rect = fitOverlayRect(width, height);
  return {
    x: rect.x,
    y: rect.y,
  };
}

/**
 * Clamp an overlay to the visible terminal viewport while preserving centering.
 * Margin values reserve breathing room around the overlay when space allows.
 */
export function fitOverlayRect(
  width: number,
  height: number,
  options: {
    marginX?: number;
    marginY?: number;
    viewport?: { columns: number; rows: number };
  } = {},
): OverlayRect {
  const term = options.viewport ?? getTerminalSize();
  const marginX = Math.max(0, options.marginX ?? 0);
  const marginY = Math.max(0, options.marginY ?? 0);
  const maxWidth = Math.max(1, term.columns - marginX * 2);
  const maxHeight = Math.max(1, term.rows - marginY * 2);
  const fittedWidth = Math.max(1, Math.min(width, maxWidth));
  const fittedHeight = Math.max(1, Math.min(height, maxHeight));

  return {
    width: fittedWidth,
    height: fittedHeight,
    x: Math.max(0, Math.floor((term.columns - fittedWidth) / 2)),
    y: Math.max(0, Math.floor((term.rows - fittedHeight) / 2)),
  };
}

export function resolveOverlayFrame(
  requestedWidth: number,
  requestedHeight: number,
  {
    minWidth = 24,
    minHeight = 8,
    marginX = 2,
    marginY = 1,
    viewport,
  }: {
    minWidth?: number;
    minHeight?: number;
    marginX?: number;
    marginY?: number;
    viewport?: { columns: number; rows: number };
  } = {},
): OverlayFrame {
  const term = viewport ?? getTerminalSize();
  const availableWidth = Math.max(1, term.columns - marginX * 2);
  const availableHeight = Math.max(1, term.rows - marginY * 2);
  const fittedMinWidth = Math.min(Math.max(1, minWidth), availableWidth);
  const fittedMinHeight = Math.min(Math.max(1, minHeight), availableHeight);
  const width = Math.max(
    fittedMinWidth,
    Math.min(requestedWidth, availableWidth),
  );
  const height = Math.max(
    fittedMinHeight,
    Math.min(requestedHeight, availableHeight),
  );
  const position = calcOverlayPosition(width, height);

  return {
    ...position,
    width,
    height,
    clipped: width !== requestedWidth || height !== requestedHeight,
  };
}

export function shouldClearOverlay(
  previous: ClearRegion | null | undefined,
  next: ClearRegion,
): boolean {
  return !!previous && (
    previous.x !== next.x ||
    previous.y !== next.y ||
    previous.width !== next.width ||
    previous.height !== next.height
  );
}

/** Write raw ANSI output to terminal */
export function writeToTerminal(output: string): void {
  getPlatform().terminal.stdout.writeSync(overlayEncoder.encode(output));
}

// ============================================================
// Shared Theme-to-RGB Conversion (DRY across all overlay components)
// ============================================================

/**
 * Pre-computed overlay RGB colors derived from the current theme palette.
 * Includes ready-to-use ANSI style strings so overlays don't recompute them.
 */
export interface OverlayColors {
  primary: RGB;
  secondary: RGB;
  accent: RGB;
  success: RGB;
  warning: RGB;
  error: RGB;
  muted: RGB;
  background: RGB;
  selectedBackground: RGB;
  title: RGB;
  meta: RGB;
  section: RGB;
  footer: RGB;
  fieldBorder: RGB;
  fieldBorderActive: RGB;
  fieldBackground: RGB;
  fieldText: RGB;
  fieldPlaceholder: RGB;
  fieldCursor: RGB;
  /** ANSI bg string for overlay background — use directly, no bg() call needed */
  bgStyle: string;
  /** ANSI bg string for selected-row highlight — use directly, no bg() call needed */
  selectedBgStyle: string;
}

/**
 * Convert a theme palette (hex strings) to overlay RGB tuples + pre-computed styles.
 * SSOT for all overlay color derivation — call once in useMemo, use everywhere.
 *
 * Usage:
 * ```tsx
 * const colors = useMemo(() => themeToOverlayColors(theme), [theme]);
 * // colors.bgStyle, colors.selectedBgStyle ready to use
 * ```
 */
export function themeToOverlayColors(theme: {
  primary: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  muted: string;
  text: string;
  bg: string;
}): OverlayColors {
  const semantic = buildSemanticColors(theme as ThemePalette);
  const background = hexToRgb(semantic.surface.modal.background) as RGB;
  const selectedBackground = hexToRgb(
    semantic.surface.modal.selectedBackground,
  ) as RGB;
  return {
    primary: hexToRgb(theme.primary) as RGB,
    secondary: hexToRgb(theme.secondary) as RGB,
    accent: hexToRgb(theme.accent) as RGB,
    success: hexToRgb(theme.success) as RGB,
    warning: hexToRgb(theme.warning) as RGB,
    error: hexToRgb(theme.error) as RGB,
    muted: hexToRgb(theme.muted) as RGB,
    background,
    selectedBackground,
    title: hexToRgb(semantic.surface.modal.title) as RGB,
    meta: hexToRgb(semantic.surface.modal.meta) as RGB,
    section: hexToRgb(semantic.surface.modal.section) as RGB,
    footer: hexToRgb(semantic.surface.modal.footer) as RGB,
    fieldBorder: hexToRgb(semantic.surface.field.border) as RGB,
    fieldBorderActive: hexToRgb(semantic.surface.field.borderActive) as RGB,
    fieldBackground: hexToRgb(semantic.surface.field.background) as RGB,
    fieldText: hexToRgb(semantic.surface.field.text) as RGB,
    fieldPlaceholder: hexToRgb(semantic.surface.field.placeholder) as RGB,
    fieldCursor: hexToRgb(semantic.surface.field.cursor) as RGB,
    bgStyle: bg(background),
    selectedBgStyle: bg(selectedBackground),
  };
}
