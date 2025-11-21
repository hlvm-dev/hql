#!/usr/bin/env deno run -A

import { REPL } from "../../vendor/repl/mod.ts";
import type { REPLConfig } from "../../vendor/repl/mod.ts";
import { initializeRuntime } from "../src/common/runtime-initializer.ts";
import { getArgs as platformGetArgs, exit as platformExit } from "../src/platform/platform.ts";
import { hqlPlugin } from "./hql-plugin.ts";
import { HQL_REPL_KEYWORDS } from "./repl-keywords.ts";

const VERSION = "0.1.0";

function getBanner(): string {
  const CYAN = "\x1b[36m";
  const PURPLE = "\x1b[35m";
  const YELLOW = "\x1b[33m";
  const RED = "\x1b[31m";
  const DIM = "\x1b[90m";
  const RESET = "\x1b[0m";

  return `
${CYAN}            __${RESET}
${CYAN}           / _)${RESET}      ${RED}~${YELLOW}*${RESET}~
${CYAN}    .-^^^-/ /${RESET}       ${RED}~${YELLOW}*${RESET}*~
${CYAN} __/       /${RESET}         ${YELLOW}~*${RESET}
${CYAN}<__.|_|-|_|${RESET}

${PURPLE}HQL REPL v${VERSION}${RESET} — Lisp-like language for modern JavaScript
${DIM}Commands: .help | .clear | .reset | close()${RESET}
`;
}

async function createREPL(): Promise<REPL> {
  const config: REPLConfig = {
    prompt: "hql>",
    banner: getBanner(),
    keywords: HQL_REPL_KEYWORDS,
    tempDirPrefix: "hql-repl-",
  };
  return new REPL([hqlPlugin], config);
}

export async function main(args: string[] = platformGetArgs()): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
HQL REPL

USAGE:
  hql repl [options]

OPTIONS:
  --help, -h     Show this help
  --version      Show version
`);
    return 0;
  }

  if (args.includes("--version")) {
    console.log(`HQL REPL v${VERSION}`);
    return 0;
  }

  await initializeRuntime();
  const repl = await createREPL();
  await repl.start();
  return 0;
}

if (import.meta.main) {
  const exitCode = await main();
  platformExit(exitCode);
}
