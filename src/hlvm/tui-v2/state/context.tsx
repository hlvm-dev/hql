import React, {
  createContext,
  type Dispatch,
  useContext,
  useReducer,
} from "react";
import type { AppAction, AppState } from "./types.ts";
import { initialAppState } from "./types.ts";
import { appReducer } from "./reducer.ts";

const AppStateContext = createContext<AppState | null>(null);
const AppDispatchContext = createContext<Dispatch<AppAction> | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, undefined, initialAppState);
  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be inside AppStateProvider");
  return ctx;
}

export function useAppDispatch(): Dispatch<AppAction> {
  const ctx = useContext(AppDispatchContext);
  if (!ctx) throw new Error("useAppDispatch must be inside AppStateProvider");
  return ctx;
}
