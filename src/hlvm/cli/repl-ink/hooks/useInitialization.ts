/**
 * HLVM Ink REPL - Initialization Hook
 * Handles runtime initialization, AI import, memory loading
 */

import { useState, useEffect, useRef } from "npm:react@18";
import { initializeRuntime } from "../../../../common/runtime-initializer.ts";
import { run } from "../../../../../mod.ts";
import { memory } from "../../../api/memory.ts";
import { getFileIndex } from "../../repl/file-search.ts";
import { evaluate } from "../../repl/evaluator.ts";
import { ReplState } from "../../repl/state.ts";
import { registerReplHelpers } from "../../repl/helpers.ts";
import { registerApis } from "../../../api/index.ts";
import { getMedia } from "../../repl/context.ts";
import { refreshKeybindingLookup } from "../keybindings/index.ts";
import { KEYWORD_SET, MACRO_SET, OPERATOR_SET } from "../../../../common/known-identifiers.ts";
import { checkDefaultModelInstalled, getDefaultModelName } from "../components/ModelSetupOverlay.tsx";

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

export function useInitialization(state: ReplState, jsMode: boolean): InitializationState {
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
        const historyInit = state.initHistory().catch((err) => {
          console.error("History init failed:", err);
        });

        // Initialize runtime
        await initializeRuntime();

        // Register ALL stdlib functions with auto-extracted signatures
        // This is the fundamental fix - no hardcoding needed
        try {
          const stdlib = await import("../../../../hql/lib/stdlib/js/index.js") as Record<string, unknown>;
          for (const [name, value] of Object.entries(stdlib)) {
            if (typeof value === "function" && !name.startsWith("_")) {
              state.addJsFunction(name, value as (...args: unknown[]) => unknown);
            }
          }
        } catch {
          // Stdlib not available - continue without signatures
        }

        // Auto-import AI module - use direct TS import + register each function via HQL
        const loadedAiExports: string[] = [];
        try {
          // Direct import to get all functions including example
          const aiModule = await import("../../../../hql/lib/stdlib/js/ai.js") as Record<string, unknown>;

          // Get exported names (skip internal helpers)
          const exportedNames: string[] = [];
          const exportedFunctions: string[] = [];
          if (aiModule && typeof aiModule === "object") {
            for (const [name, value] of Object.entries(aiModule)) {
              if (name.startsWith("_") || name === "default") continue;
              exportedNames.push(name);
              if (typeof value === "function") {
                exportedFunctions.push(name);
              }
            }
          }

          // Set exports on globalThis and register with HQL
          // This makes them available in HQL evaluation context
          const reservedNames = new Set([...KEYWORD_SET, ...MACRO_SET, ...OPERATOR_SET]);
          const declaredNames: string[] = [];
          const globalAny = globalThis as unknown as Record<string, unknown>;
          for (const name of exportedNames) {
            const value = aiModule[name];
            globalAny[name] = value;

            const isReserved = reservedNames.has(name) || state.hasBinding(name);
            if (isReserved) continue;

            // Register with state for Tab completion
            if (typeof value === "function") {
              state.addJsFunction(name, value as (...args: unknown[]) => unknown);
              loadedAiExports.push(name);
            } else {
              state.addBinding(name);
            }
            declaredNames.push(name);
          }

          // Run HQL code that references globalThis to make names known to transpiler
          // This is the key - HQL needs to see the names through its own evaluation
          if (declaredNames.length > 0) {
            const assignments = declaredNames
              .map(name => `(let ${name} (js-get globalThis "${name}"))`)
              .join("\n");
            await run(assignments, { baseDir: Deno.cwd(), currentFile: "<repl>", suppressUnknownNameErrors: true });
          }
        } catch {
          // AI module not available - continue without it
          // console.error("Failed to load AI module:", err);
        }
        setAiExports(loadedAiExports);

        // Compact and load memory
        const loadErrors: string[] = [];
        try {
          await memory.compact();
          state.setLoadingMemory(true);
          const result = await memory.load(async (code: string) => {
            const evalResult = await evaluate(code, state, jsMode);
            return { success: evalResult.success, error: evalResult.error };
          });
          state.setLoadingMemory(false);
          // Register docstrings from memory with state
          if (result.docstrings.size > 0) {
            state.addDocstrings(result.docstrings);
          }
          if (result.errors.length > 0) {
            loadErrors.push(...result.errors);
          }
        } catch {
          state.setLoadingMemory(false);
        }

        setErrors(loadErrors);

        // Register helper functions
        registerReplHelpers(state);

        // Register API objects on globalThis for REPL access
        registerApis({
          replState: state, // Provides history
          runtime: {
            getMedia,
            getDocstrings: () => state.getDocstrings(),
            getSignatures: () => state.getSignatures(),
          },
        });
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
        setErrors([error instanceof Error ? error.message : String(error)]);
        setLoading(false);
      }
    })();
  }, [state, jsMode]);

  return { loading, ready, aiExports, readyTime, errors, needsModelSetup, modelToSetup };
}
