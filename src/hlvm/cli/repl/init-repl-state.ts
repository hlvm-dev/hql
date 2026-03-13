/**
 * REPL State Initialization - SSOT for REPL setup
 * Shared by Ink REPL and HTTP REPL to prevent drift.
 */

import type { RuntimeState } from "../../api/runtime.ts";
import { registerApis } from "../../api/index.ts";
import { bindings, type BindingsApi } from "../../api/bindings.ts";
import { evaluate } from "./evaluator.ts";
import { registerReplHelpers } from "./helpers.ts";
import { loadStdlibModules, type ModuleLoaderResult } from "./module-loader.ts";
import { ReplState } from "./state.ts";

type BindingsLoadResult = Awaited<ReturnType<BindingsApi["load"]>>;

export type HistoryInitMode = "await" | "defer" | "skip";

export interface InitReplStateOptions {
  state?: ReplState;
  /** Whether to evaluate memory entries in JS mode */
  bindingsJsMode?: boolean;
  /** History init mode; defaults to "await" */
  initHistory?: HistoryInitMode;
  /** Use an existing history init promise (e.g., started early) */
  historyInitPromise?: Promise<void>;
  onHistoryError?: (error: unknown) => void;
  onBindingsError?: (error: unknown) => void;
  runtime?: Pick<RuntimeState, "getMedia">;
  loadModules?: boolean;
  loadBindings?: boolean;
  registerApis?: boolean;
  registerHelpers?: boolean;
  suppressModuleErrors?: boolean;
}

export interface InitReplStateResult {
  state: ReplState;
  historyInit?: Promise<void>;
  moduleResult?: ModuleLoaderResult;
  bindingsResult?: BindingsLoadResult;
}

export function startReplHistoryInit(
  state: ReplState,
  onError?: (error: unknown) => void,
): Promise<void> {
  const initPromise = state.initHistory();
  if (onError) {
    initPromise.catch(onError);
  }
  return initPromise;
}

export async function initReplState(
  options: InitReplStateOptions = {},
): Promise<InitReplStateResult> {
  const {
    state: providedState,
    bindingsJsMode = false,
    initHistory = "await",
    historyInitPromise,
    onHistoryError,
    onBindingsError,
    runtime,
    loadModules = true,
    loadBindings: shouldLoadBindings = true,
    registerApis: shouldRegisterApis = true,
    registerHelpers: shouldRegisterHelpers = true,
    suppressModuleErrors = true,
  } = options;

  const state = providedState ?? new ReplState();

  let historyInit: Promise<void> | undefined;
  let historyPromise = historyInitPromise;
  if (!historyPromise && initHistory !== "skip") {
    historyPromise = state.initHistory();
  }
  if (historyPromise && onHistoryError) {
    historyPromise.catch(onHistoryError);
  }
  if (historyPromise) {
    if (initHistory === "await") {
      await historyPromise;
    } else if (initHistory === "defer") {
      historyInit = historyPromise;
    }
  }

  if (shouldRegisterApis) {
    const runtimeState: RuntimeState = {
      getMedia: runtime?.getMedia,
      getDocstrings: () => state.getDocstrings(),
      getSignatures: () => state.getSignatures(),
    };

    registerApis({
      replState: state,
      runtime: runtimeState,
    });
  }

  let moduleResult: ModuleLoaderResult | undefined;
  if (loadModules) {
    moduleResult = await loadStdlibModules({
      state,
      suppressErrors: suppressModuleErrors,
    });
  }

  let bindingsResult: BindingsLoadResult | undefined;
  if (shouldLoadBindings) {
    try {
      await bindings.compact();
      state.setLoadingBindings(true);
      const result = await bindings.load(async (code: string) => {
        const evalResult = await evaluate(code, state, bindingsJsMode);
        return { success: evalResult.success, error: evalResult.error };
      });
      state.setLoadingBindings(false);
      if (result.docstrings.size > 0) {
        state.addDocstrings(result.docstrings);
      }
      bindingsResult = result;
    } catch (error) {
      state.setLoadingBindings(false);
      if (onBindingsError) {
        onBindingsError(error);
      }
    }
  }

  if (shouldRegisterHelpers) {
    registerReplHelpers(state);
  }

  return {
    state,
    historyInit,
    moduleResult,
    bindingsResult,
  };
}
