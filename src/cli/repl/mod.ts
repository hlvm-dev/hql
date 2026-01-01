/**
 * HQL REPL - Main Entry Point
 * Production-ready interactive Read-Eval-Print Loop
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
 * Print welcome banner
 */
function printBanner(): void {
  console.log(`
${BOLD}${PURPLE}██╗  ██╗ ██████╗ ██╗     ${RESET}
${BOLD}${PURPLE}██║  ██║██╔═══██╗██║     ${RESET}
${BOLD}${PURPLE}███████║██║   ██║██║     ${RESET}
${BOLD}${PURPLE}██╔══██║██║▄▄ ██║██║     ${RESET}
${BOLD}${PURPLE}██║  ██║╚██████╔╝███████╗${RESET}
${BOLD}${PURPLE}╚═╝  ╚═╝ ╚══▀▀═╝ ╚══════╝${RESET}

${DIM_GRAY}Version ${VERSION} • Lisp-like language for modern JavaScript${RESET}

${GREEN}Quick Start:${RESET}
  ${CYAN}(+ 1 2)${RESET}                    ${DIM_GRAY}→ Simple math${RESET}
  ${CYAN}(fn add [x y] (+ x y))${RESET}    ${DIM_GRAY}→ Define function${RESET}
  ${CYAN}(add 10 20)${RESET}                ${DIM_GRAY}→ Call function${RESET}

${GREEN}AI (requires @hql/ai):${RESET}
  ${CYAN}(import [ask] from "@hql/ai")${RESET}
  ${CYAN}(await (ask "Hello"))${RESET}      ${DIM_GRAY}→ AI response${RESET}

${YELLOW}Commands:${RESET} ${DIM_GRAY}.help | .clear | .reset${RESET}
${YELLOW}Exit:${RESET}     ${DIM_GRAY}Ctrl+C | Ctrl+D | .exit${RESET}
`);
}

/**
 * Start the REPL
 */
export async function startRepl(): Promise<number> {
  const state = new ReplState();
  const readline = new Readline();

  // Initialize runtime (including AI if available)
  await initializeRuntime();

  printBanner();

  const startTime = Date.now();
  const initTime = Date.now() - startTime;
  console.log(`${DIM_GRAY}Ready in ${initTime}ms${RESET}\n`);

  while (true) {
    try {
      const input = await readline.readline({
        prompt: "hql> ",
        continuationPrompt: "...  ",
        history: state.history,
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

      // Evaluate HQL
      const result = await evaluate(input, state);

      if (result.success) {
        if (!result.suppressOutput && result.value !== undefined) {
          console.log(formatValue(result.value));
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
  --help, -h        Show this help
  --version         Show version

EXAMPLES:
  hql repl          Start interactive REPL
`);
    return 0;
  }

  if (args.includes("--version")) {
    console.log(`HQL REPL v${VERSION}`);
    return 0;
  }

  return await startRepl();
}

// Run if executed directly
if (import.meta.main) {
  main().then((exitCode) => {
    Deno.exit(exitCode);
  });
}
