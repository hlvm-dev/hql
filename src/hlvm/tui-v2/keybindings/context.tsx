import React, { createContext, useCallback, useContext, useRef } from "react";
import type { KeyBinding, KeyContext, Keystroke } from "./types.ts";
import { DEFAULT_BINDINGS } from "./defaults.ts";
import { resolveKeystroke } from "./resolver.ts";

type ActionHandler = () => void;

interface KeybindingAPI {
  resolve: (keystroke: Keystroke, activeContexts: ReadonlyArray<KeyContext>) => string | null;
  registerHandler: (action: string, handler: ActionHandler) => () => void;
  invokeAction: (action: string) => boolean;
}

const KeybindingContext = createContext<KeybindingAPI | null>(null);

interface ProviderProps {
  bindings?: ReadonlyArray<KeyBinding>;
  children: React.ReactNode;
}

export function KeybindingProvider({ bindings = DEFAULT_BINDINGS, children }: ProviderProps) {
  const handlersRef = useRef<Map<string, ActionHandler>>(new Map());

  const resolve = useCallback(
    (keystroke: Keystroke, activeContexts: ReadonlyArray<KeyContext>) =>
      resolveKeystroke(keystroke, activeContexts, bindings),
    [bindings],
  );

  const registerHandler = useCallback((action: string, handler: ActionHandler) => {
    handlersRef.current.set(action, handler);
    return () => {
      handlersRef.current.delete(action);
    };
  }, []);

  const invokeAction = useCallback((action: string) => {
    const handler = handlersRef.current.get(action);
    if (handler) {
      handler();
      return true;
    }
    return false;
  }, []);

  const api: KeybindingAPI = { resolve, registerHandler, invokeAction };

  return (
    <KeybindingContext.Provider value={api}>
      {children}
    </KeybindingContext.Provider>
  );
}

export function useKeybindings(): KeybindingAPI {
  const ctx = useContext(KeybindingContext);
  if (!ctx) {
    throw new Error("useKeybindings must be used within a KeybindingProvider");
  }
  return ctx;
}
