/**
 * React Context for REPL state distribution
 * Provides 100% FRP - all state changes automatically update UI
 */

import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import type { ReplState } from "../../repl/state.ts";
import { useReplStateBridge, type ReplStateSnapshot } from "../hooks/useReplStateBridge.ts";
import { ValidationError } from "../../../../common/error.ts";

/**
 * Context value containing all reactive REPL state
 */
export interface ReplContextValue extends ReplStateSnapshot {
  /** Binding names (persisted definitions from ~/.hlvm/memory.hql) */
  bindingNames: string[];
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

  // Binding names from filesystem (separate from ReplState)
  const [bindingNames, setBindingNames] = useState<string[]>([]);

  // Auto-refresh binding names when state version changes
  // This catches def/defn/unbind operations AND initial mount (version starts at 0)
  // NOTE: Use version, not bindings - bindings is a mutable Set with same reference
      useEffect(() => {
        // SSOT: Use bindings API only
        const bindingsApi = (globalThis as Record<string, unknown>).bindings as {
          list: () => Promise<string[]>;
        } | undefined;

        if (bindingsApi?.list) {
          bindingsApi.list().then(setBindingNames).catch(() => {
            // Silently ignore errors (file may not exist yet)
          });
        }
      }, [bridgeState.version]);
  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo(
    (): ReplContextValue => ({
      ...bridgeState,
      bindingNames,
    }),
    [bridgeState, bindingNames]
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
