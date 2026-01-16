/**
 * History API Object
 *
 * Programmable access to HQL command history.
 * History persists across sessions in ~/.hql/history.jsonl
 *
 * Usage in REPL:
 *   (history.list)              ; List all commands
 *   (history.get 0)             ; Get command at index
 *   (history.search "def")      ; Search commands
 *   (history.clear)             ; Clear history (memory + disk)
 *   history.count               ; Get command count
 *   (history.save)              ; Force flush to disk
 *   history.path                ; Get history file path
 */

import { getHistoryPath } from "../common/paths.ts";

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
  addHistory(input: string): void;
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
export function createHistoryApi() {
  return {
    /**
     * List all commands in history
     * @example (history.list)
     * @example (history.list {:limit 10})
     */
    list: (options?: { limit?: number; offset?: number }): string[] => {
      if (!_replState) {
        return [];
      }

      const history = _replState.history;
      const start = options?.offset ?? 0;
      const end = options?.limit ? start + options.limit : undefined;
      return history.slice(start, end);
    },

    /**
     * Get a specific command by index (0 = oldest)
     * Negative indices count from end: -1 = last command
     * @example (history.get 0)
     * @example (history.get -1)
     */
    get: (index: number): string | null => {
      if (!_replState) {
        return null;
      }

      const history = _replState.history;
      if (history.length === 0) {
        return null;
      }

      // Normalize negative index
      const normalizedIndex = index < 0 ? history.length + index : index;

      if (normalizedIndex < 0 || normalizedIndex >= history.length) {
        return null;
      }

      return history[normalizedIndex];
    },

    /**
     * Search history for commands matching pattern
     * @example (history.search "def")
     */
    search: (pattern: string): string[] => {
      if (!_replState || !pattern) {
        return [];
      }

      const history = _replState.history;
      const lowerPattern = pattern.toLowerCase();

      return history.filter((cmd) =>
        cmd.toLowerCase().includes(lowerPattern)
      );
    },

    /**
     * Clear command history (memory and disk)
     * @example (history.clear)
     */
    clear: async (): Promise<void> => {
      if (_replState) {
        await _replState.clearHistory();
      }
    },

    /**
     * Force flush pending history to disk
     * @example (history.save)
     */
    save: async (): Promise<void> => {
      if (_replState) {
        await _replState.flushHistory();
      }
    },

    /**
     * Get the history file path
     * @example history.path
     */
    get path(): string {
      return getHistoryPath();
    },

    /**
     * Get count of commands in history
     * @example history.count
     */
    get count(): number {
      return _replState?.history.length ?? 0;
    },

    /**
     * Get the last N commands
     * @example (history.last 5)
     */
    last: (n: number = 1): string[] => {
      if (!_replState || n <= 0) {
        return [];
      }

      const history = _replState.history;
      return history.slice(-n);
    },

    /**
     * Get the first N commands
     * @example (history.first 5)
     */
    first: (n: number = 1): string[] => {
      if (!_replState || n <= 0) {
        return [];
      }

      const history = _replState.history;
      return history.slice(0, n);
    },
  };
}

/**
 * Default history API instance
 */
export const history = createHistoryApi();
