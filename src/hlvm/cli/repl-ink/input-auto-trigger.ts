// Import DIRECTLY from providers.ts, NOT from ./completion/index.ts.
// The `./completion/index.ts` barrel eagerly re-exports `Dropdown` from
// `./completion/Dropdown.tsx`, which in turn imports `PickerRow.tsx` and
// `HighlightedText.tsx` — all three use bare `from "ink"`. When v2 reaches
// this module through PromptInput, those three files get pulled into the
// v2 dependency graph, where bare `"ink"` resolves through v2's deno.json
// ink-barrel alias. Routing around the barrel keeps them out of the v2
// graph entirely so the `ink/index.ts` bridge can eventually be deleted.
// `extractMentionQuery` and `shouldTriggerFileMention` are defined in
// providers.ts; the barrel only re-exports them.
import {
  extractMentionQuery,
  shouldTriggerFileMention,
} from "./completion/providers.ts";
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
