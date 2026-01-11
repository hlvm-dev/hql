/**
 * Overlay Module
 *
 * Provides true floating overlay support for Ink applications
 * using raw ANSI escape codes for absolute positioning.
 */

export {
  drawOverlay,
  clearOverlay,
  centerOverlay,
  getTerminalSize,
  ansi,
  box,
  type OverlayConfig,
  type OverlayLine,
} from "./renderer.ts";

export { useOverlay, textToLines, type UseOverlayOptions } from "./useOverlay.ts";
