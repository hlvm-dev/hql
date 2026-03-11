/**
 * useSpinnerFrame
 *
 * Returns a static frame index (always 0) — NO animation, NO timers.
 *
 * Ink does full erase+redraw on every React render. Any setInterval that
 * triggers setState causes a complete screen repaint, which is the root
 * cause of visible flicker during streaming. Competitors (Claude Code,
 * Gemini CLI, Codex) avoid this by using static indicators.
 *
 * Consumers display BRAILLE_SPINNER_FRAMES[0] ("⠋") as a static
 * activity indicator. This is visually clear and flicker-free.
 */

/**
 * Returns frame index 0 (static). The `isActive` parameter is kept
 * for API compatibility but has no effect — no animation runs.
 */
export function useSpinnerFrame(_isActive = true): number {
  return 0;
}
