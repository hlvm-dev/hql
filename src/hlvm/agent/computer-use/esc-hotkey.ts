/**
 * Computer Use — Escape Hotkey (HLVM bridge)
 *
 * CC's `escHotkey.ts` registers a global CGEventTap via `@ant/computer-use-swift`
 * that intercepts Escape keypresses system-wide. When the user presses Escape,
 * it fires the abort callback (PI defense — prevents prompt-injected Escape).
 *
 * HLVM doesn't have CGEventTap access (no Swift native module). Abort is
 * handled by the existing SIGINT → AbortSignal pipeline. These are no-op stubs.
 *
 * CC original: 54 lines (registerEscape via Swift, pump retain/release).
 * HLVM bridge: no-op stubs.
 */

import { getAgentLogger } from "../logger.ts";

// deno-lint-ignore no-unused-vars
let _registered = false;

/**
 * Register ESC hotkey. No-op in HLVM — we use SIGINT for abort.
 * Returns false (registration "failed") — matches CC's fallback path where
 * CU still works without ESC abort when CGEvent.tapCreate fails.
 */
// deno-lint-ignore no-unused-vars
export function registerEscHotkey(_onEscape: () => void): boolean {
  getAgentLogger().debug(
    "[cu-esc] registerEscape skipped (HLVM bridge — no CGEventTap)",
  );
  return false;
}

/** Unregister ESC hotkey. No-op. */
export function unregisterEscHotkey(): void {
  // no-op
}

/** Notify that a model-synthesized Escape is expected. No-op. */
export function notifyExpectedEscape(): void {
  // no-op
}
