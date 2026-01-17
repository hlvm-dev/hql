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
  UseCompletionOptions,
  UseCompletionReturn,
  DropdownRenderProps,
} from "./useCompletion.ts";

// ============================================================
// UI Components
// ============================================================

export { Dropdown } from "./Dropdown.tsx";

// ============================================================
// Essential Types for Consumers
// ============================================================

export type {
  CompletionItem,
  CompletionAction,
  ApplyContext,
  ProviderId,
} from "./types.ts";

// ============================================================
// Constants that Consumers Need
// ============================================================

export {
  TYPE_ICONS,
  ATTACHMENT_PLACEHOLDER,
  STRING_PLACEHOLDER_FUNCTIONS,
} from "./types.ts";

// ============================================================
// Utility Functions for Auto-Trigger Detection
// ============================================================

export { getWordAtCursor } from "./providers.ts";
