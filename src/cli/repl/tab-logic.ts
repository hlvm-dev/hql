/**
 * Tab Key Decision Logic - Extracted for Testability
 *
 * This module contains the pure logic for deciding what Tab should do.
 * Extracted from Input.tsx so it can be properly unit tested.
 */

import type { Suggestion } from "./suggester.ts";

/**
 * Determine if Tab should accept the ghost text suggestion.
 *
 * Conditions:
 * 1. A suggestion exists (ghost text is visible)
 * 2. Cursor is at the end of the line
 * 3. Not currently in completion cycling mode
 *
 * This ensures Tab accepts suggestions only when appropriate,
 * and doesn't interfere with completion cycling.
 */
export function shouldTabAcceptSuggestion(
  suggestion: Suggestion | null,
  cursorPos: number,
  valueLength: number,
  showingCompletions: boolean
): boolean {
  return suggestion !== null && cursorPos === valueLength && !showingCompletions;
}

/**
 * Tab key priority order:
 * 1. Placeholder mode → navigate placeholders (handled in Input.tsx)
 * 2. @mention mode → select file (handled in Input.tsx)
 * 3. Suggestion visible → accept ghost text (this function)
 * 4. Completion cycling → cycle candidates (handleTab)
 * 5. Default → start completions (handleTab)
 */
