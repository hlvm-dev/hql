/**
 * HQL Ink REPL - Initialization Hook
 * Handles runtime initialization, AI import, memory loading
 */

import { useState, useEffect, useRef } from "npm:react@18";
import { initializeRuntime } from "../../../common/runtime-initializer.ts";
import { run } from "../../../../mod.ts";
import { compactMemory, loadMemory, getMemoryNames, getMemoryFilePath, forgetFromMemory, getDefinitionSource } from "../../repl/memory.ts";
import { getFileIndex } from "../../repl/file-search.ts";
import { evaluate } from "../../repl/evaluator.ts";
import { ReplState } from "../../repl/state.ts";
import { runCommand } from "../../repl/commands.ts";
import { ANSI_COLORS } from "../../ansi.ts";

const { GREEN, YELLOW, CYAN, DIM_GRAY, RESET } = ANSI_COLORS;

export interface InitializationState {
  loading: boolean;
  ready: boolean;
  aiExports: string[];
  readyTime: number;
  errors: string[];
  // memoryNames and refreshMemoryNames removed - now handled by FRP via ReplContext
}

export function useInitialization(state: ReplState, jsMode: boolean): InitializationState {
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [aiExports, setAiExports] = useState<string[]>([]);
  const [readyTime, setReadyTime] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const startTime = Date.now();

    (async () => {
      try {
        // Pre-index files in background for @ mention feature
        getFileIndex().catch(() => {});

        // Initialize runtime
        await initializeRuntime();

        // Register ALL stdlib functions with auto-extracted signatures
        // This is the fundamental fix - no hardcoding needed
        try {
          const stdlib = await import("../../../lib/stdlib/js/index.js") as Record<string, unknown>;
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
          const aiModule = await import("../../../lib/stdlib/js/ai.js") as Record<string, unknown>;

          // Get exported function names (skip internal helpers)
          const exportedFunctions: string[] = [];
          if (aiModule && typeof aiModule === "object") {
            for (const [name, value] of Object.entries(aiModule)) {
              if (name.startsWith("_") || name === "default") continue;
              if (typeof value === "function") {
                exportedFunctions.push(name);
              }
            }
          }

          // Set functions on globalThis and register with HQL via js-set
          // This makes them available in HQL evaluation context
          const globalAny = globalThis as unknown as Record<string, unknown>;
          for (const name of exportedFunctions) {
            const fn = aiModule[name];
            globalAny[name] = fn;

            // Register with state for Tab completion
            if (typeof fn === "function") {
              state.addJsFunction(name, fn as (...args: unknown[]) => unknown);
              loadedAiExports.push(name);
            }
          }

          // Run HQL code that references globalThis to make names known to transpiler
          // This is the key - HQL needs to see the names through its own evaluation
          if (exportedFunctions.length > 0) {
            const assignments = exportedFunctions
              .map(name => `(let ${name} (js-get globalThis "${name}"))`)
              .join("\n");
            await run(assignments, { baseDir: Deno.cwd(), currentFile: "<repl>", suppressUnknownNameErrors: true });
          }
        } catch (err) {
          // AI module not available - continue without it
          // console.error("Failed to load AI module:", err);
        }
        setAiExports(loadedAiExports);

        // Compact and load memory
        const loadErrors: string[] = [];
        try {
          await compactMemory();
          state.setLoadingMemory(true);
          const result = await loadMemory(async (code: string) => {
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
        registerHelperFunctions(state);

        setReadyTime(Date.now() - startTime);
        setLoading(false);
        setReady(true);
      } catch (error) {
        setErrors([error instanceof Error ? error.message : String(error)]);
        setLoading(false);
      }
    })();
  }, [state, jsMode]);

  return { loading, ready, aiExports, readyTime, errors };
}

/**
 * Register REPL helper functions on globalThis
 */
function registerHelperFunctions(state: ReplState): void {
  const globalAny = globalThis as unknown as Record<string, unknown>;

  globalAny.memory = async () => {
    const names = await getMemoryNames();
    return { count: names.length, names, path: getMemoryFilePath() };
  };

  globalAny.forget = async (name: string) => {
    const removed = await forgetFromMemory(name);
    if (removed) {
      console.log(`${GREEN}Removed '${name}' from memory.${RESET}`);
    } else {
      console.log(`${YELLOW}'${name}' not found in memory.${RESET}`);
    }
    return removed;
  };

  globalAny.inspect = async (value: unknown) => {
    const type = typeof value;

    if (type === "function") {
      const fn = value as ((...args: unknown[]) => unknown) & { name: string };
      const name = fn.name || "<anonymous>";
      const source = await getDefinitionSource(name);

      console.log(`${CYAN}${name}${RESET}: ${DIM_GRAY}function${RESET}`);
      if (source) {
        console.log(`${DIM_GRAY}${source}${RESET}`);
      }
      return { name, type: "function", source };
    }

    if (type === "string") {
      const source = await getDefinitionSource(value as string);
      if (source) {
        console.log(`${CYAN}${value}${RESET}:`);
        console.log(`${DIM_GRAY}${source}${RESET}`);
        return { name: value, type: "definition", source };
      }
    }

    console.log(`${CYAN}<value>${RESET}: ${DIM_GRAY}${type}${RESET}`);
    if (value !== null && value !== undefined) {
      try {
        console.log(`${DIM_GRAY}${JSON.stringify(value, null, 2)}${RESET}`);
      } catch {
        console.log(`${DIM_GRAY}[non-serializable]${RESET}`);
      }
    }
    return { name: null, type, source: null };
  };

  globalAny.describe = async (value: unknown) => {
    const info = await (globalAny.inspect as (v: unknown) => Promise<{ name: string | null; type: string; source?: string | null }>)(value);

    if (!info.source) {
      return { ...info, explanation: null };
    }

    const ask = globalAny.ask as ((prompt: string) => Promise<unknown>) | undefined;
    if (typeof ask !== "function") {
      console.log(`\n${YELLOW}AI not available. Check @hql/ai installation and API key.${RESET}`);
      return { ...info, explanation: null };
    }

    console.log(`\n${CYAN}── AI Explanation ──${RESET}\n`);

    const prompt = `You are explaining an HQL function. HQL is a Lisp-like language that compiles to JavaScript.

Here is the function source code:
${info.source}

Provide:
1. A brief explanation of what this function does (1-2 sentences)
2. 2-3 example usages in HQL syntax

Keep the response concise. Use HQL syntax (parentheses, prefix notation) for examples.`;

    try {
      const response = await ask(prompt);

      if (response && typeof (response as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
        const encoder = new TextEncoder();
        let explanation = "";
        for await (const chunk of response as AsyncIterable<unknown>) {
          if (typeof chunk === "string") {
            Deno.stdout.writeSync(encoder.encode(chunk));
            explanation += chunk;
          }
        }
        console.log();
        return { ...info, explanation };
      } else if (typeof response === "string") {
        console.log(response);
        return { ...info, explanation: response };
      } else {
        console.log(String(response));
        return { ...info, explanation: String(response) };
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.log(`${YELLOW}AI error: ${errMsg}${RESET}`);
      return { ...info, explanation: null };
    }
  };

  globalAny.help = () => {
    runCommand("/help", state);
    return null;
  };

  globalAny.exit = () => {
    console.log("\nGoodbye!");
    Deno.exit(0);
  };

  globalAny.clear = () => {
    console.clear();
    return null;
  };

  // Register for tab completion with auto-extracted parameter names
  const helperNames = ["memory", "forget", "inspect", "describe", "help", "exit", "clear"];
  for (const name of helperNames) {
    const fn = globalAny[name];
    if (typeof fn === "function") {
      state.addJsFunction(name, fn as (...args: unknown[]) => unknown);
    } else {
      state.addBinding(name);
    }
  }
}
