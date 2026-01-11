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
} from "./renderer.ts";
