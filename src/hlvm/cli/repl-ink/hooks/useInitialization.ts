/**
 * HLVM Ink REPL - Initialization Hook
 * Handles runtime initialization, AI import, memory loading
 */

import { useState, useEffect, useRef } from "react";
import { initializeRuntime } from "../../../../common/runtime-initializer.ts";
import { getFileIndex } from "../../repl/file-search.ts";
import { ReplState } from "../../repl/state.ts";
import { initReplState, startReplHistoryInit } from "../../repl/init-repl-state.ts";
import { getMedia } from "../../repl/context.ts";
import { refreshKeybindingLookup } from "../keybindings/index.ts";
import { checkDefaultModelInstalled, getDefaultModelName } from "../components/ModelSetupOverlay.tsx";
import { log } from "../../../api/log.ts";
import { getErrorMessage } from "../../../../common/utils.ts";

export interface InitializationState {
  loading: boolean;
  ready: boolean;
  aiExports: string[];
  readyTime: number;
  errors: string[];
  /** True if the default AI model needs to be downloaded */
  needsModelSetup: boolean;
  /** The model name that needs to be downloaded */
  modelToSetup: string;
  // memoryNames and refreshMemoryNames removed - now handled by FRP via ReplContext
}

export function useInitialization(state: ReplState): InitializationState {
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [aiExports, setAiExports] = useState<string[]>([]);
  const [readyTime, setReadyTime] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [needsModelSetup, setNeedsModelSetup] = useState(false);
  const [modelToSetup, setModelToSetup] = useState("");
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const startTime = Date.now();

    (async () => {
      try {
        // Pre-index files in background for @ mention feature
        getFileIndex().catch(() => {});

        // Load persistent history early (in parallel with other init)
        const historyInit = startReplHistoryInit(state, (error) => {
          log.error(`History init failed: ${getErrorMessage(error)}`);
        });

        // Initialize runtime
        await initializeRuntime();

        const initResult = await initReplState({
          state,
          memoryJsMode: true,
          initHistory: "defer",
          historyInitPromise: historyInit,
          runtime: { getMedia },
        });

        const loadErrors: string[] = [];
        if (initResult.moduleResult) {
          setAiExports(initResult.moduleResult.aiExports);
          if (initResult.moduleResult.errors.length > 0) {
            loadErrors.push(...initResult.moduleResult.errors);
          }
        }
        if (initResult.memoryResult?.errors.length) {
          loadErrors.push(...initResult.memoryResult.errors);
        }

        setErrors(loadErrors);
        refreshKeybindingLookup();

        // Register API names for tab completion
        for (const name of ["config", "memory", "session", "history", "ai", "runtime"]) {
          state.addBinding(name);
        }

        await historyInit;

        // Check if default AI model needs to be downloaded (non-blocking)
        const modelInstalled = await checkDefaultModelInstalled();
        if (!modelInstalled) {
          setNeedsModelSetup(true);
          setModelToSetup(getDefaultModelName());
        }

        setReadyTime(Date.now() - startTime);
        setLoading(false);
        setReady(true);
      } catch (error) {
        setErrors([getErrorMessage(error)]);
        setLoading(false);
      }
    })();
  }, [state]);

  return { loading, ready, aiExports, readyTime, errors, needsModelSetup, modelToSetup };
}
