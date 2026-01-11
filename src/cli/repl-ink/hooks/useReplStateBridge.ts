/**
 * Bridge hook that connects ReplState (mutable) to React (reactive)
 * Uses React 18's useSyncExternalStore for proper external store subscription
 */

import { useSyncExternalStore, useMemo } from "npm:react@18";
import type { ReplState } from "../../repl/state.ts";

/**
 * Snapshot of all reactive state from ReplState
 */
export interface ReplStateSnapshot {
  bindings: ReadonlySet<string>;
  signatures: ReadonlyMap<string, string[]>;
  docstrings: ReadonlyMap<string, string>;
  history: readonly string[];
  replState: ReplState;
  /** Version number - use this as useEffect dependency, not collections */
  version: number;
}

/**
 * Bridge hook using React 18's useSyncExternalStore.
 * This is the official React API for subscribing to external mutable stores.
 *
 * Benefits over manual useEffect + useReducer:
 * - Concurrent rendering safe
 * - Automatic batching handled by React
 * - SSR compatible (with getServerSnapshot)
 * - Tear-safe (no inconsistent reads during render)
 *
 * @param replState - The ReplState instance to subscribe to
 * @returns Reactive snapshot of all state values
 */
export function useReplStateBridge(replState: ReplState): ReplStateSnapshot {
  // useSyncExternalStore triggers re-render when snapshot changes
  const version = useSyncExternalStore(
    replState.subscribe,
    replState.getSnapshot,
    replState.getSnapshot  // Server snapshot (same as client for CLI)
  );

  // Return fresh state values on every version change
  return useMemo(
    (): ReplStateSnapshot => ({
      bindings: replState.getBindingsSet(),
      signatures: replState.getSignatures(),
      docstrings: replState.getDocstrings(),
      history: replState.history,
      replState,
      version,  // Include version for useEffect dependencies
    }),
    [replState, version]
  );
}
