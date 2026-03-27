/**
 * Handler Registry - Central handler management for keybindings
 *
 * Allows components to register handlers that can be invoked by ID from anywhere
 * (palette, keyboard shortcuts, etc). Inspired by VS Code, OpenCode, and lazygit patterns.
 *
 * @example
 * // Input.tsx registers handlers
 * useEffect(() => {
 *   registerHandler("paredit.slurp-forward", () => slurpForward());
 *   return () => unregisterHandler("paredit.slurp-forward");
 * }, [value, cursor]);
 *
 * // Palette can execute
 * executeHandler("paredit.slurp-forward");
 */

import { log } from "../../../api/log.ts";

// ============================================================
// Types
// ============================================================

type HandlerFn = () => void | Promise<void>;

interface HandlerInfo {
  id: string;
  handler: HandlerFn;
  /** Component that registered this handler */
  source?: string;
}

// ============================================================
// Registry State
// ============================================================

const handlers = new Map<string, HandlerInfo>();

// ============================================================
// Public API
// ============================================================

/**
 * Register a handler function for a keybinding action ID.
 * If a handler with the same ID exists, it will be replaced.
 */
export function registerHandler(
  id: string,
  handler: HandlerFn,
  source?: string,
): void {
  handlers.set(id, { id, handler, source });
}

/**
 * Unregister a handler by ID.
 */
export function unregisterHandler(id: string): void {
  handlers.delete(id);
}

/**
 * Execute a handler by ID.
 * Returns true if handler was found and executed, false otherwise.
 */
export async function executeHandler(id: string): Promise<boolean> {
  const info = handlers.get(id);
  if (!info) {
    log.warn(`[handler-registry] Handler not found: ${id}`);
    return false;
  }

  try {
    await info.handler();
    return true;
  } catch (error) {
    log.error(`[handler-registry] Handler error for ${id}: ${error}`);
    return false;
  }
}

// ============================================================
// Handler ID Constants
// ============================================================

/**
 * Standard handler IDs for all keybindable actions.
 * Components should use these IDs when registering handlers.
 */
export const HandlerIds = {
  // Global
  APP_SHORTCUTS: "app.shortcuts",
  APP_EXIT: "app.exit",
  APP_CLEAR: "app.clear",
  APP_PALETTE: "app.palette",
  APP_BACKGROUND: "app.background",
  APP_TEAM_DASHBOARD: "app.openTeamDashboard",
  APP_CYCLE_TEAMMATE: "app.cycleTeammate",
  APP_KILL_ALL: "app.killAll",
  APP_TASK_OVERLAY: "app.taskOverlay",
  CONVERSATION_OPEN_HISTORY: "conversation.open-history",
  CONVERSATION_TOGGLE_LATEST: "conversation.toggle-latest",
  CONVERSATION_OPEN_LATEST_SOURCE: "conversation.open-latest-source",
  COMPOSER_CYCLE_MODE: "composer.cycle-mode",
  COMPOSER_CLEAR: "composer.clear",
  COMPOSER_FORCE_SUBMIT: "composer.force-submit",

  // Editing
  EDIT_JUMP_START: "edit.jump-start",
  EDIT_JUMP_END: "edit.jump-end",
  EDIT_DELETE_TO_START: "edit.delete-to-start",
  EDIT_DELETE_TO_END: "edit.delete-to-end",
  EDIT_DELETE_WORD_BACK: "edit.delete-word-back",
  EDIT_UNDO: "edit.undo",
  EDIT_REDO: "edit.redo",

  // Navigation
  NAV_WORD_BACK: "nav.word-back",
  NAV_WORD_FORWARD: "nav.word-forward",
  NAV_SEXP_BACK: "nav.sexp-back",
  NAV_SEXP_FORWARD: "nav.sexp-forward",
  NAV_SEXP_UP: "nav.sexp-up",
  NAV_SEXP_DOWN: "nav.sexp-down",
  NAV_INSERT_NEWLINE: "nav.insert-newline",

  // Completion
  COMPLETION_ACCEPT: "completion.accept",
  COMPLETION_CANCEL: "completion.cancel",
  COMPLETION_TOGGLE_DOCS: "completion.toggle-docs",

  // History
  HISTORY_SEARCH: "history.search",

  // Paredit
  PAREDIT_SLURP_FORWARD: "paredit.slurp-forward",
  PAREDIT_SLURP_BACKWARD: "paredit.slurp-backward",
  PAREDIT_BARF_FORWARD: "paredit.barf-forward",
  PAREDIT_BARF_BACKWARD: "paredit.barf-backward",
  PAREDIT_WRAP: "paredit.wrap",
  PAREDIT_SPLICE: "paredit.splice",
  PAREDIT_RAISE: "paredit.raise",
  PAREDIT_TRANSPOSE: "paredit.transpose",
  PAREDIT_KILL: "paredit.kill",
} as const;
