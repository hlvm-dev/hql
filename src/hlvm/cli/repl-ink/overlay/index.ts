/**
 * Overlay Module
 *
 * Core utilities for drawing floating overlays on top of Ink's output
 * using raw ANSI escape codes for absolute positioning.
 */

export {
  ansi,
  clearOverlay,
  getTerminalSize,
  hexToRgb,
  type ClearRegion,
  type OverlayFrame,
  type RGB,
  OVERLAY_BG_COLOR,
  fg,
  bg,
  calcOverlayPosition,
  fitOverlayRect,
  resolveOverlayFrame,
  shouldClearOverlay,
  writeToTerminal,
} from "./renderer.ts";
