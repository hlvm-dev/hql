import {
  extractMentionQuery,
  shouldTriggerFileMention,
} from "./completion/index.ts";
import type { CompletionContext } from "./completion/types.ts";

/**
 * Composer auto-trigger guard.
 *
 * Closed completion should only auto-open when the draft text itself changed.
 * Cursor-only navigation through existing @mentions or /commands must not
 * reopen the picker. Once the picker is already open, cursor movement still
 * needs to be processed so the visible session can re-filter or close cleanly.
 */
export function shouldProcessComposerAutoTrigger(
  previousValue: string | null,
  currentValue: string,
  isCompletionVisible: boolean,
): boolean {
  if (isCompletionVisible) {
    return true;
  }

  return previousValue !== currentValue;
}

/**
 * File mentions should open only from an explicit '@' keystroke, not from
 * passive cursor movement into already-completed mention text.
 */
export function shouldOpenMentionPickerOnTypedChar(
  typedChar: string,
  isCompletionVisible: boolean,
  isInsideString: boolean,
  context: CompletionContext,
): boolean {
  return typedChar === "@" &&
    !isCompletionVisible &&
    !isInsideString &&
    shouldTriggerFileMention(context) &&
    extractMentionQuery(context) !== null;
}
