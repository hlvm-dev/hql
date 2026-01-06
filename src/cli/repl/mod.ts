/**
 * HQL REPL - Main Entry Point
 * Production-ready interactive Read-Eval-Print Loop
 *
 * Supports:
 * - Standard evaluation with formatted output
 * - Async iterator streaming (for generators and AI responses)
 */

import { Readline } from "./readline.ts";
import { evaluate } from "./evaluator.ts";
import { ReplState } from "./state.ts";
import { formatValue, formatError } from "./formatter.ts";
import { isCommand, runCommand } from "./commands.ts";
import { ANSI_COLORS } from "../ansi.ts";
import { getErrorMessage } from "../../common/utils.ts";
import { version as VERSION, run } from "../../../mod.ts";
import { initializeRuntime } from "../../common/runtime-initializer.ts";
import { compactMemory, loadMemory, getMemoryFilePath, getMemoryNames, forgetFromMemory, getDefinitionSource } from "./memory.ts";

const {
  BOLD,
  PURPLE,
  CYAN,
  GREEN,
  YELLOW,
  DIM_GRAY,
  RESET,
} = ANSI_COLORS;

/**
 * Check if a value is an async iterator (async generator result)
 */
function isAsyncIterator(value: unknown): value is AsyncIterableIterator<unknown> {
  return value !== null &&
    typeof value === "object" &&
    Symbol.asyncIterator in value;
}

/**
 * Check if a value is a sync iterator (generator result)
 */
function isSyncIterator(value: unknown): value is IterableIterator<unknown> {
  return value !== null &&
    typeof value === "object" &&
    Symbol.iterator in value &&
    typeof (value as IterableIterator<unknown>).next === "function" &&
    !(value instanceof Array) &&
    !(value instanceof String) &&
    !(value instanceof Map) &&
    !(value instanceof Set);
}

/**
 * Stream async iterator values to stdout in real-time.
 * This enables live streaming for AI responses, generators, etc.
 * Returns the concatenated string result (for string yields) or last value.
 */
async function streamAsyncIterator(iterator: AsyncIterableIterator<unknown>): Promise<void> {
  const encoder = new TextEncoder();
  let hasOutput = false;

  try {
    for await (const chunk of iterator) {
      hasOutput = true;
      if (typeof chunk === "string") {
        // String chunks: write directly (no newline) for streaming effect
        Deno.stdout.writeSync(encoder.encode(chunk));
      } else {
        // Non-string values: format and print with newline
        console.log(formatValue(chunk));
      }
    }

    // Add trailing newline if we streamed strings
    if (hasOutput) {
      Deno.stdout.writeSync(encoder.encode("\n"));
    }
  } catch (error) {
    // Ensure newline after partial output before showing error
    if (hasOutput) {
      Deno.stdout.writeSync(encoder.encode("\n"));
    }
    // Re-throw to be caught by outer error handler
    throw error;
  }
}

/**
 * Stream sync iterator values to stdout.
 */
function streamSyncIterator(iterator: IterableIterator<unknown>): void {
  const encoder = new TextEncoder();
  let hasOutput = false;

  try {
    for (const chunk of iterator) {
      hasOutput = true;
      if (typeof chunk === "string") {
        Deno.stdout.writeSync(encoder.encode(chunk));
      } else {
        console.log(formatValue(chunk));
      }
    }

    if (hasOutput) {
      Deno.stdout.writeSync(encoder.encode("\n"));
    }
  } catch (error) {
    // Ensure newline after partial output before showing error
    if (hasOutput) {
      Deno.stdout.writeSync(encoder.encode("\n"));
    }
    throw error;
  }
}

/**
 * REPL configuration options
 */
export interface ReplOptions {
  /** Enable JavaScript polyglot mode (--js flag) */
  jsMode?: boolean;
}

/**
 * Print welcome banner
 */
function printBanner(jsMode: boolean = false): void {
  console.log(`
${BOLD}${PURPLE}██╗  ██╗ ██████╗ ██╗     ${RESET}
${BOLD}${PURPLE}██║  ██║██╔═══██╗██║     ${RESET}
${BOLD}${PURPLE}███████║██║   ██║██║     ${RESET}
${BOLD}${PURPLE}██╔══██║██║▄▄ ██║██║     ${RESET}
${BOLD}${PURPLE}██║  ██║╚██████╔╝███████╗${RESET}
${BOLD}${PURPLE}╚═╝  ╚═╝ ╚══▀▀═╝ ╚══════╝${RESET}

${DIM_GRAY}Version ${VERSION} • Lisp-like language for modern JavaScript${RESET}
`);

  if (jsMode) {
    // Polyglot mode banner
    console.log(`${GREEN}Mode:${RESET} ${CYAN}HQL + JavaScript${RESET} ${DIM_GRAY}(polyglot)${RESET}`);
    console.log(`${DIM_GRAY}  (expr) → HQL    |    expr → JavaScript${RESET}
`);
    console.log(`${GREEN}Examples:${RESET}
  ${CYAN}let x = 10${RESET}                 ${DIM_GRAY}→ JavaScript variable${RESET}
  ${CYAN}(+ x 5)${RESET}                    ${DIM_GRAY}→ HQL using JS var${RESET}
  ${CYAN}const add = (a,b) => a+b${RESET}   ${DIM_GRAY}→ JS arrow function${RESET}
  ${CYAN}(add 3 4)${RESET}                  ${DIM_GRAY}→ HQL calling JS fn${RESET}
`);
  } else {
    // Pure HQL mode banner
    console.log(`${GREEN}Quick Start:${RESET}
  ${CYAN}(+ 1 2)${RESET}                    ${DIM_GRAY}→ Simple math${RESET}
  ${CYAN}(fn add [x y] (+ x y))${RESET}    ${DIM_GRAY}→ Define function${RESET}
  ${CYAN}(add 10 20)${RESET}                ${DIM_GRAY}→ Call function${RESET}

${GREEN}AI (requires @hql/ai):${RESET}
  ${CYAN}(import [ask] from "@hql/ai")${RESET}
  ${CYAN}(await (ask "Hello"))${RESET}      ${DIM_GRAY}→ AI response${RESET}
`);
  }

}

/**
 * Start the REPL
 */
export async function startRepl(options: ReplOptions = {}): Promise<number> {
  const { jsMode = false } = options;
  const state = new ReplState();
  const readline = new Readline();
  const startTime = Date.now();

  // Prompts based on mode
  const prompt = jsMode ? "js> " : "hql> ";
  const continuationPrompt = jsMode ? "..  " : "...  ";

  // Initialize runtime (including AI if available)
  await initializeRuntime();

  // Auto-import AI module (battery-included)
  // Import as namespace, then spread all function exports onto globalThis
  const aiExports: string[] = [];
  try {
    await run(`
      (import ai from "@hql/ai")
      (js-set globalThis "__hql_ai_module__" ai)
    `, { baseDir: Deno.cwd(), currentFile: "<repl>", suppressUnknownNameErrors: true });

    const globalAny = globalThis as unknown as Record<string, unknown>;
    const aiModule = globalAny.__hql_ai_module__ as Record<string, unknown> | undefined;

    if (aiModule && typeof aiModule === "object") {
      for (const [name, value] of Object.entries(aiModule)) {
        if (typeof value === "function") {
          globalAny[name] = value;
          state.addBinding(name);
          aiExports.push(name);
        }
      }
    }
    delete globalAny.__hql_ai_module__;
  } catch {
    // AI module not available - continue without it
  }

  // Load persisted memory from ~/.hql/memory.hql
  let memoryLoadResult = { count: 0, errors: [] as string[] };
  try {
    // Compact memory first (remove duplicate definitions)
    await compactMemory();

    // Load memory with state flag to prevent re-persisting
    state.setLoadingMemory(true);
    memoryLoadResult = await loadMemory(async (code: string) => {
      const result = await evaluate(code, state, jsMode);
      return { success: result.success, error: result.error };
    });
    state.setLoadingMemory(false);
  } catch {
    state.setLoadingMemory(false);
    // Silently continue if memory loading fails
  }

  // Register REPL functions on globalThis for consistent Lisp-style interface
  const globalAny = globalThis as unknown as Record<string, unknown>;

  globalAny.memory = async () => {
    // Single file read - get names and derive count
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

  // inspect: Fast, deterministic source code lookup
  globalAny.inspect = async (value: unknown) => {
    const type = typeof value;

    // For functions: show source from memory if available
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

    // For strings: check if it's a definition name (user might want source lookup)
    if (type === "string") {
      const source = await getDefinitionSource(value as string);
      if (source) {
        console.log(`${CYAN}${value}${RESET}:`);
        console.log(`${DIM_GRAY}${source}${RESET}`);
        return { name: value, type: "definition", source };
      }
      // Not a definition - fall through to show as string value
    }

    // For all other values: show type and value
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

  // describe: inspect + AI-generated explanation and examples
  globalAny.describe = async (value: unknown) => {
    // First run inspect to show source code
    const info = await (globalAny.inspect as (v: unknown) => Promise<{ name: string | null; type: string; source?: string | null }>)(value);

    // If no source available, nothing more to explain
    if (!info.source) {
      return { ...info, explanation: null };
    }

    // Check if AI (ask function) is available (auto-imported at startup)
    const ask = globalAny.ask as ((prompt: string) => Promise<unknown>) | undefined;
    if (typeof ask !== "function") {
      console.log(`\n${YELLOW}AI not available. Check @hql/ai installation and API key.${RESET}`);
      return { ...info, explanation: null };
    }

    // Generate AI explanation
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

      // Handle async iterator (streaming response)
      if (response && typeof (response as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
        const encoder = new TextEncoder();
        let explanation = "";
        for await (const chunk of response as AsyncIterable<unknown>) {
          if (typeof chunk === "string") {
            Deno.stdout.writeSync(encoder.encode(chunk));
            explanation += chunk;
          }
        }
        console.log(); // Final newline
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
    // Import is already at top of file, use runCommand
    runCommand(".help", state);
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

  // Register REPL helper functions for tab completion
  const replHelpers = ["memory", "forget", "inspect", "describe", "help", "exit", "clear"];
  for (const name of replHelpers) {
    state.addBinding(name);
  }

  printBanner(jsMode);

  // Show memory status with names (Option A style)
  const memoryNames = await getMemoryNames();
  if (memoryNames.length > 0) {
    const displayNames = memoryNames.length <= 5
      ? memoryNames.join(", ")
      : `${memoryNames.slice(0, 5).join(", ")}... +${memoryNames.length - 5} more`;
    console.log(`${GREEN}Memory:${RESET} ${displayNames} (${memoryNames.length} definition${memoryNames.length === 1 ? "" : "s"})`);
  } else {
    console.log(`${GREEN}Memory:${RESET} ${DIM_GRAY}empty — def/defn auto-save here${RESET}`);
  }

  // Show AI status
  if (aiExports.length > 0) {
    console.log(`${GREEN}AI:${RESET} ${aiExports.join(", ")} ${DIM_GRAY}(auto-imported from @hql/ai)${RESET}`);
  } else {
    console.log(`${GREEN}AI:${RESET} ${DIM_GRAY}not available — install @hql/ai${RESET}`);
  }

  // Show function commands (consistent Lisp style)
  console.log(`${DIM_GRAY}(memory) | (forget "x") | (inspect x) | (describe x) AI | (help)${RESET}`);

  if (memoryLoadResult.errors.length > 0) {
    console.log(`${YELLOW}Memory warnings:${RESET}`);
    for (const err of memoryLoadResult.errors.slice(0, 3)) {
      console.log(`  ${DIM_GRAY}${err}${RESET}`);
    }
    if (memoryLoadResult.errors.length > 3) {
      console.log(`  ${DIM_GRAY}... and ${memoryLoadResult.errors.length - 3} more${RESET}`);
    }
  }

  const initTime = Date.now() - startTime;
  console.log(`${DIM_GRAY}Ready in ${initTime}ms${RESET}\n`);

  while (true) {
    try {
      const input = await readline.readline({
        prompt,
        continuationPrompt,
        history: state.history,
        userBindings: new Set(state.getBindings()),
        signatures: state.getSignatures(),
      });

      // Ctrl+D or EOF
      if (input === null) {
        console.log("\nGoodbye!");
        return 0;
      }

      const trimmed = input.trim();

      // Empty input
      if (!trimmed) {
        continue;
      }

      // Add to history
      state.addHistory(trimmed);
      state.nextLine();

      // Handle commands
      if (isCommand(trimmed)) {
        await runCommand(trimmed, state);
        continue;
      }

      // Evaluate code (HQL or JavaScript depending on mode)
      const result = await evaluate(input, state, jsMode);

      if (result.success) {
        if (!result.suppressOutput && result.value !== undefined) {
          let value = result.value;

          // Auto-await promises for better UX (no need to type (await ...) in REPL)
          if (value instanceof Promise) {
            value = await value;
          }

          // Check for async iterator (from async generators) - stream in real-time
          if (isAsyncIterator(value)) {
            await streamAsyncIterator(value);
          }
          // Check for sync iterator (from generators) - stream immediately
          else if (isSyncIterator(value)) {
            streamSyncIterator(value);
          }
          // Regular value - format and print
          else {
            console.log(formatValue(value));
          }
        }
      } else if (result.error) {
        console.log(formatError(result.error));
      }
    } catch (error) {
      // Catch any unexpected errors
      if (error instanceof Error) {
        console.log(formatError(error));
      } else {
        console.log(`${ANSI_COLORS.RED}Error: ${getErrorMessage(error)}${RESET}`);
      }
    }
  }
}

/**
 * Main entry point for CLI
 */
export async function main(args: string[] = Deno.args): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
HQL REPL - Interactive Read-Eval-Print Loop

USAGE:
  hql repl [options]

OPTIONS:
  --js              Enable JavaScript polyglot mode (HQL + JS)
  --help, -h        Show this help
  --version         Show version

MODES:
  hql repl          Pure HQL mode (default)
  hql repl --js     Polyglot mode - mix HQL and JavaScript

POLYGLOT MODE (--js):
  Input starting with ( is evaluated as HQL.
  All other input is evaluated as JavaScript.
  Both languages share variables via globalThis.

EXAMPLES:
  hql repl              Start pure HQL REPL
  hql repl --js         Start polyglot REPL (HQL + JavaScript)
`);
    return 0;
  }

  if (args.includes("--version")) {
    console.log(`HQL REPL v${VERSION}`);
    return 0;
  }

  // Parse --js flag for polyglot mode
  const jsMode = args.includes("--js");

  return await startRepl({ jsMode });
}

// Run if executed directly
if (import.meta.main) {
  main().then((exitCode) => {
    Deno.exit(exitCode);
  });
}
