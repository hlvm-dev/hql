/**
 * Unified Completion System - Public API
 *
 * This is the ONLY API that consumers (Input.tsx) should use.
 *
 * @example
 * ```tsx
 * import {
 *   useCompletion,
 *   Dropdown,
 *   ATTACHMENT_PLACEHOLDER,
 * } from "../completion/index.ts";
 *
 * function MyComponent() {
 *   const completion = useCompletion({ userBindings, signatures, docstrings });
 *
 *   return (
 *     <>
 *       {completion.renderProps && (
 *         <Dropdown
 *           items={completion.renderProps.items}
 *           selectedIndex={completion.renderProps.selectedIndex}
 *           helpText={completion.renderProps.helpText}
 *           isLoading={completion.renderProps.isLoading}
 *         />
 *       )}
 *     </>
 *   );
 * }
 * ```
 */

// ============================================================
// Main Hook (the primary interface)
// ============================================================

export { useCompletion } from "./useCompletion.ts";
export type {
  DropdownRenderProps,
  UseCompletionOptions,
  UseCompletionReturn,
} from "./useCompletion.ts";

// ============================================================
// UI Components
// ============================================================

export { Dropdown } from "./Dropdown.tsx";

// ============================================================
// Essential Types for Consumers
// ============================================================

export type {
  ApplyContext,
  ApplyResult,
  CompletionAction,
  CompletionItem,
  ProviderId,
} from "./types.ts";

// ============================================================
// Constants that Consumers Need
// ============================================================

export {
  ATTACHMENT_PLACEHOLDER,
  STRING_PLACEHOLDER_FUNCTIONS,
  TYPE_ICONS,
} from "./types.ts";

// ============================================================
// Utility Functions for Auto-Trigger Detection
// ============================================================

export {
  buildContext,
  extractMentionQuery,
  findMentionTokenEnd,
  getWordAtCursor,
  shouldTriggerCommand,
  shouldTriggerFileMention,
} from "./providers.ts";
