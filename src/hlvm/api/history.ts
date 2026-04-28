/**
 * History API Object
 *
 * Programmable access to HLVM command history.
 * History persists across sessions in ~/.hlvm/history.jsonl
 *
 * Usage in REPL:
 *   (history.list)              // List all commands
 *   (history.get 0)             // Get command at index
 *   (history.search "def")      // Search commands
 *   (history.clear)             // Clear history (memory + disk)
 *   history.count               // Get command count
 *   (history.save)              // Force flush to disk
 *   history.path                // Get history file path
 */

import { getHistoryPath } from "../../common/paths.ts";
import type { HistoryEntryMetadata } from "../cli/repl/history-storage.ts";

// ============================================================================
// REPL State Reference
// ============================================================================

/**
 * Reference to the REPL state for history access.
 * Set by REPL initialization.
 */
let _replState: ReplStateRef | null = null;

interface ReplStateRef {
  history: string[];
  addHistory(input: string, metadata?: HistoryEntryMetadata): void;
  flushHistory(): Promise<void>;
  clearHistory(): Promise<void>;
}

/**
 * Set the REPL state reference (called during REPL init)
 */
export function setReplState(state: ReplStateRef): void {
  _replState = state;
}

// ============================================================================
// History API Object
// ============================================================================

/**
 * Create the history API object
 * Designed to be registered on globalThis for REPL access
 */
function createHistoryApi() {
  return {
    /** @example (history.list) ; (history.list {limit: 10}) */
    list: (options?: { limit?: number; offset?: number }): string[] => {
      if (!_replState) return [];
      const start = options?.offset ?? 0;
      const end = options?.limit ? start + options.limit : undefined;
      return _replState.history.slice(start, end);
    },

    /** Negative indices count from end. @example (history.get -1) */
    get: (index: number): string | null => {
      if (!_replState) return null;
      const history = _replState.history;
      if (history.length === 0) return null;
      const normalized = index < 0 ? history.length + index : index;
      if (normalized < 0 || normalized >= history.length) return null;
      return history[normalized];
    },

    /** @example (history.search "def") */
    search: (pattern: string): string[] => {
      if (!_replState || !pattern) return [];
      const lower = pattern.toLowerCase();
      return _replState.history.filter((cmd) =>
        cmd.toLowerCase().includes(lower)
      );
    },

    /** @example (history.clear) */
    clear: async (): Promise<void> => {
      await _replState?.clearHistory();
    },

    /** @example (history.save) */
    save: async (): Promise<void> => {
      await _replState?.flushHistory();
    },

    get path(): string {
      return getHistoryPath();
    },

    get count(): number {
      return _replState?.history.length ?? 0;
    },

    /** @example (history.last 5) */
    last: (n = 1): string[] => {
      if (!_replState || n <= 0) return [];
      return _replState.history.slice(-n);
    },

    /** @example (history.first 5) */
    first: (n = 1): string[] => {
      if (!_replState || n <= 0) return [];
      return _replState.history.slice(0, n);
    },
  };
}

/**
 * Default history API instance
 */
export const history = createHistoryApi();
