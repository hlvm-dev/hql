/**
 * Tab Key Decision Logic - Extracted for Testability
 *
 * Tab behavior is now strict completion toggle (open/close), never ghost-accept.
 * This helper is retained for compatibility with existing tests and callers.
 */

import type { Suggestion } from "./suggester.ts";

/**
 * Determine if Tab should accept the ghost text suggestion.
 *
 * Current contract: never accept suggestion via Tab.
 * Ghost text acceptance is explicit via Right Arrow / Ctrl+E only.
 */
export function shouldTabAcceptSuggestion(
  _suggestion: Suggestion | null,
  _cursorPos: number,
  _valueLength: number,
  _showingCompletions: boolean
): boolean {
  return false;
}

/**
 * Tab key priority order:
 * 1. Placeholder mode → navigate placeholders (handled in Input.tsx)
 * 2. Completion visible → close dropdown (handleTab)
 * 3. Completion hidden → open dropdown (handleTab)
 */
