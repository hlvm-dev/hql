/**
 * Overlay Module
 *
 * Core utilities for drawing floating overlays on top of Ink's output
 * using raw ANSI escape codes for absolute positioning.
 */

export {
  ansi,
  clearOverlay,
  type ClearRegion,
  type OverlayColors,
  type OverlayFrame,
  type RGB,
  OVERLAY_BG_COLOR,
  fg,
  bg,
  fitOverlayRect,
  resolveOverlayFrame,
  shouldClearOverlay,
  themeToOverlayColors,
  writeToTerminal,
} from "./renderer.ts";
