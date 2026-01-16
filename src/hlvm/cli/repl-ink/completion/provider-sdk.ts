/**
 * Provider SDK - Everything needed to create custom completion providers.
 *
 * This is SEPARATE from the main completion API used by Input.tsx.
 * Import from here when building new providers.
 *
 * @example
 * ```typescript
 * import {
 *   createCompletionItem,
 *   rankCompletions,
 *   TYPE_ICONS,
 *   COMPLETION_SCORES,
 *   type CompletionProvider,
 *   type CompletionContext,
 *   type CompletionResult,
 * } from "./provider-sdk.ts";
 *
 * const MyProvider: CompletionProvider = {
 *   id: "my-provider",
 *   shouldTrigger(ctx) { return ctx.textBeforeCursor.endsWith("#"); },
 *   async getCompletions(ctx) {
 *     const items = myData.map(d =>
 *       createCompletionItem(d.name, "function", { score: COMPLETION_SCORES.STDLIB })
 *     );
 *     return { items: rankCompletions(items), anchor: ctx.wordStart };
 *   },
 * };
 * ```
 */

// ============================================================
// Types for Provider Development
// ============================================================

export type {
  CompletionProvider,
  CompletionItem,
  CompletionContext,
  CompletionResult,
  CompletionType,
  CompletionAction,
  ApplyContext,
  ApplyResult,
  ItemRenderSpec,
  ProviderId,
} from "./types.ts";

// ============================================================
// Utilities for Provider Development
// ============================================================

export {
  createCompletionItem,
  rankCompletions,
  generateItemId,
  resetItemIdCounter,
  buildContext,
  getWordAtCursor,
} from "./providers.ts";

// ============================================================
// Constants for Provider Development
// ============================================================

export {
  TYPE_ICONS,
  TYPE_LABELS,
  TYPE_PRIORITY,
  COMPLETION_SCORES,
  RENDER_MAX_WIDTH,
  PROVIDER_HELP_TEXT,
  MAX_VISIBLE_ITEMS,
} from "./types.ts";

// ============================================================
// Trigger Detection Helpers (for building shouldTrigger)
// ============================================================

export {
  shouldTriggerFileMention,
  shouldTriggerCommand,
  shouldTriggerSymbol,
  extractMentionQuery,
  extractCommandQuery,
} from "./providers.ts";
