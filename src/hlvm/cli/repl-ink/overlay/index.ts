/**
 * Overlay Module
 *
 * Core utilities for drawing floating overlays on top of Ink's output
 * using raw ANSI escape codes for absolute positioning.
 */

export {
  ansi,
  bg,
  buildOverlayFrameText,
  clearOverlay,
  type ClearRegion,
  drawOverlayFrame,
  fg,
  fitOverlayRect,
  OVERLAY_BG_COLOR,
  OVERLAY_BG_STYLE,
  OVERLAY_SELECTED_BG_COLOR,
  OVERLAY_SELECTED_BG_STYLE,
  type OverlayColors,
  type OverlayFrame,
  resolveOverlayFrame,
  type RGB,
  shouldClearOverlay,
  themeToOverlayColors,
  writeToTerminal,
} from "./renderer.ts";
export {
  BACKGROUND_TASKS_OVERLAY_SPEC,
  COMMAND_PALETTE_OVERLAY_SPEC,
  CONFIG_OVERLAY_SPEC,
  type FixedOverlayChromeSpec,
  type OverlayChromeLayout,
  type OverlayChromeSpec,
  type OverlayPadding,
  resolveOverlayChromeLayout,
  SHORTCUTS_OVERLAY_SPEC,
  TEAM_DASHBOARD_OVERLAY_SPEC,
} from "./layout.ts";
