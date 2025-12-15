#!/usr/bin/env deno run -A

/**
 * HQL REPL - Interactive Read-Eval-Print Loop
 * Uses the Pure REPL library with HQL plugin
 */

import { REPL } from "@hlvm/repl";
import { hqlPlugin } from "./hql-plugin.ts";
import { getArgs as platformGetArgs, exit as platformExit } from "../platform/platform.ts";
import { ANSI_COLORS } from "./ansi.ts";
import { version as VERSION } from "../../mod.ts";
import { getAllKnownIdentifiers } from "../common/known-identifiers.ts";

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
function makeBanner(): string {
  return `
${BOLD}${PURPLE}██╗  ██╗ ██████╗ ██╗     ${RESET}
${BOLD}${PURPLE}██║  ██║██╔═══██╗██║     ${RESET}
${BOLD}${PURPLE}███████║██║   ██║██║     ${RESET}
${BOLD}${PURPLE}██╔══██║██║▄▄ ██║██║     ${RESET}
${BOLD}${PURPLE}██║  ██║╚██████╔╝███████╗${RESET}
${BOLD}${PURPLE}╚═╝  ╚═╝ ╚══▀▀═╝ ╚══════╝${RESET}

${DIM_GRAY}Version ${VERSION} • Lisp-like language for modern JavaScript${RESET}
${DIM_GRAY}v2.0 - Full JavaScript operator alignment (1335 tests passing)${RESET}

${GREEN}Quick Start:${RESET}
  ${CYAN}(+ 1 2)${RESET}                    ${DIM_GRAY}→ Simple math${RESET}
  ${CYAN}(fn add [x y] (+ x y))${RESET}    ${DIM_GRAY}→ Define function${RESET}
  ${CYAN}(add 10 20)${RESET}                ${DIM_GRAY}→ Call function${RESET}

${YELLOW}Commands:${RESET} ${DIM_GRAY}.help | .clear | .reset | close()${RESET}
${YELLOW}Exit:${RESET}     ${DIM_GRAY}Ctrl+C | Ctrl+D | close()${RESET}
`;
}

/**
 * Main REPL entry point
 */
export async function main(args: string[] = platformGetArgs()): Promise<number> {
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

  // Create REPL with HQL plugin
  // Keywords loaded dynamically from known-identifiers.ts (single source of truth)
  const keywords = [
    ...getAllKnownIdentifiers(),
    // Additional REPL-specific keywords (JS literals, etc.)
    "true", "false", "nil", "null", "undefined",
    "constructor", "this", "else", "from", "async",
  ];

  const repl = new REPL([hqlPlugin], {
    banner: makeBanner(),
    prompt: "hql> ",
    tempDirPrefix: "hql-repl-",
    keywords,
    onInit(_context) {
      const startTime = Date.now();
      const initTime = Date.now() - startTime;
      console.log(`${DIM_GRAY}⚡ Ready in ${initTime}ms${RESET}\n`);
    }
  });

  try {
    await repl.start();
    return 0;
  } catch (error) {
    console.error(`Error: ${error}`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  platformExit(exitCode);
}
