/**
 * React Context for REPL state distribution
 * Provides 100% FRP - all state changes automatically update UI
 */

import React, { createContext, useContext, useState, useEffect, useMemo } from "npm:react@18";
import type { ReplState } from "../../repl/state.ts";
import { useReplStateBridge, type ReplStateSnapshot } from "../hooks/useReplStateBridge.ts";
import { ValidationError } from "../../../../common/error.ts";

/**
 * Context value containing all reactive REPL state
 */
export interface ReplContextValue extends ReplStateSnapshot {
  /** Memory names (persisted definitions from ~/.hlvm/memory.hql) */
  memoryNames: string[];
}

const ReplContext = createContext<ReplContextValue | null>(null);

interface ReplProviderProps {
  children?: React.ReactNode;
  replState: ReplState;
}

/**
 * Provider component that wraps the REPL application
 * Connects ReplState mutations to React re-renders
 */
export function ReplProvider({ children, replState }: ReplProviderProps): React.ReactElement {
  // Bridge hook subscribes to ReplState and provides reactive values
  const bridgeState = useReplStateBridge(replState);

  // Memory names from filesystem (separate from ReplState)
  const [memoryNames, setMemoryNames] = useState<string[]>([]);

  // Auto-refresh memory names when state version changes
  // This catches def/defn/forget operations AND initial mount (version starts at 0)
  // NOTE: Use version, not bindings - bindings is a mutable Set with same reference
      useEffect(() => {
        // SSOT: Use memory API only
        const memoryApi = (globalThis as Record<string, unknown>).memory as {
          list: () => Promise<string[]>;
        } | undefined;
  
        if (memoryApi?.list) {
          memoryApi.list().then(setMemoryNames).catch(() => {
            // Silently ignore errors (file may not exist yet)
          });
        }
      }, [bridgeState.version]);
  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo(
    (): ReplContextValue => ({
      ...bridgeState,
      memoryNames,
    }),
    [bridgeState, memoryNames]
  );

  return <ReplContext.Provider value={value}>{children}</ReplContext.Provider>;
}

/**
 * Hook to access all REPL state
 * @throws Error if used outside ReplProvider
 */
export function useReplContext(): ReplContextValue {
  const ctx = useContext(ReplContext);
  if (!ctx) {
    throw new ValidationError("useReplContext must be used within ReplProvider", "useReplContext");
  }
  return ctx;
}

/**
 * Hook to access only bindings (avoids re-renders from other state changes)
 */
export function useBindings(): ReadonlySet<string> {
  return useReplContext().bindings;
}

/**
 * Hook to access only signatures
 */
export function useSignatures(): ReadonlyMap<string, string[]> {
  return useReplContext().signatures;
}

/**
 * Hook to access only docstrings
 */
export function useDocstrings(): ReadonlyMap<string, string> {
  return useReplContext().docstrings;
}

/**
 * Hook to access only history
 */
export function useHistory(): readonly string[] {
  return useReplContext().history;
}

/**
 * Hook to access only memory names
 */
export function useMemoryNames(): string[] {
  return useReplContext().memoryNames;
}

/**
 * Hook to access ReplState directly (for mutations)
 */
export function useReplState(): ReplState {
  return useReplContext().replState;
}
