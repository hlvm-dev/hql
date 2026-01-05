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
import { version as VERSION } from "../../../mod.ts";
import { initializeRuntime } from "../../common/runtime-initializer.ts";
import { compactMemory, loadMemory, getMemoryFilePath } from "./memory.ts";

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

  console.log(`${YELLOW}Commands:${RESET} ${DIM_GRAY}.help | .clear | .reset${RESET}
${YELLOW}Exit:${RESET}     ${DIM_GRAY}Ctrl+C | Ctrl+D | .exit${RESET}`);
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

  printBanner(jsMode);

  // Show memory status if definitions were loaded
  if (memoryLoadResult.count > 0) {
    console.log(`${GREEN}Memory:${RESET} ${DIM_GRAY}Loaded ${memoryLoadResult.count} definition${memoryLoadResult.count === 1 ? "" : "s"} from ${getMemoryFilePath()}${RESET}`);
  }
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
          // Check for async iterator (from async generators) - stream in real-time
          if (isAsyncIterator(result.value)) {
            await streamAsyncIterator(result.value);
          }
          // Check for sync iterator (from generators) - stream immediately
          else if (isSyncIterator(result.value)) {
            streamSyncIterator(result.value);
          }
          // Regular value - format and print
          else {
            console.log(formatValue(result.value));
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
