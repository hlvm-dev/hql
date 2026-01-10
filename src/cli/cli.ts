#!/usr/bin/env -S deno run -A
/**
 * HQL CLI - Main entry point
 * Dispatches to appropriate command handlers
 */

import { getArgs as platformGetArgs } from "../platform/platform.ts";
import { compileCommand, showCompileHelp } from "./commands/compile.ts";
import { init as initCommand, showInitHelp } from "./commands/init.ts";
import { lspCommand, showLspHelp } from "./commands/lsp.ts";
import { publishCommand, showPublishHelp } from "./commands/publish.ts";
import { uninstall as uninstallCommand, showUninstallHelp } from "./commands/uninstall.ts";
import { upgrade as upgradeCommand, showUpgradeHelp } from "./commands/upgrade.ts";
import { initConfigRuntime } from "../common/config/runtime.ts";

// Import run command from run.ts
import { run as runCommand } from "./run.ts";
// Import repl command from Ink REPL
import { startInkRepl, type InkReplOptions } from "./repl-ink/index.tsx";
import type { SessionInitOptions } from "./repl/session/types.ts";
import { VERSION } from "../version.ts";

/**
 * Handle `hql repl` command
 */
async function replCommand(args: string[]): Promise<number> {
  // Handle help
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
HQL REPL - Interactive Read-Eval-Print Loop

USAGE:
  hql repl [options]

OPTIONS:
  --js              Enable JavaScript polyglot mode (HQL + JS)
  --no-banner       Skip the startup banner
  --help, -h        Show this help
  --version         Show version

SESSION OPTIONS:
  --continue, -c    Resume the last session
  --resume, -r [id] Resume specific session (or open picker if no id)
  --new             Force new session

SESSIONS:
  Sessions persist conversations automatically.
  Use /resume in the REPL to switch sessions.
  Use /sessions to list all sessions.

POLYGLOT MODE (--js):
  Input starting with ( is evaluated as HQL.
  All other input is evaluated as JavaScript.
  Both languages share variables via globalThis.

EXAMPLES:
  hql repl              Start REPL (new session)
  hql repl --continue   Resume last session
  hql repl -c           Resume last session (short form)
  hql repl --resume     Open session picker
  hql repl --js         Start polyglot REPL (HQL + JavaScript)
`);
    return 0;
  }

  // Handle version
  if (args.includes("--version")) {
    console.log(`HQL REPL v${VERSION}`);
    return 0;
  }

  // Parse session flags
  let continueSession = false;
  let resumeId: string | undefined;
  let forceNew = false;
  let openPicker = false;

  if (args.includes("--continue") || args.includes("-c")) {
    continueSession = true;
  }

  const resumeIndex = args.findIndex((a) => a === "--resume" || a === "-r");
  if (resumeIndex !== -1) {
    const nextArg = args[resumeIndex + 1];
    if (nextArg && !nextArg.startsWith("-")) {
      resumeId = nextArg;
    } else {
      // --resume without id: open picker
      openPicker = true;
    }
  }

  if (args.includes("--new")) {
    forceNew = true;
  }

  const sessionOptions: SessionInitOptions = {
    continue: continueSession,
    resumeId,
    forceNew,
    openPicker,
  };

  const replOptions: InkReplOptions = {
    jsMode: args.includes("--js"),
    showBanner: !args.includes("--no-banner"),
    session: sessionOptions,
  };

  return await startInkRepl(replOptions);
}

/**
 * Display main CLI help
 */
function showHelp(): void {
  console.log(`
HQL - A homoiconic language that compiles to JavaScript

Usage: hql <command> [options]

Commands:
  run <file|expr>    Run an HQL file or expression
  repl               Start interactive REPL
  compile <file>     Compile HQL to JavaScript or native binary
  init               Initialize a new HQL project
  lsp                Start the Language Server Protocol server
  publish            Publish an HQL package
  upgrade            Upgrade HQL to the latest version
  uninstall          Uninstall HQL

Options:
  -h, --help         Show this help message
  -v, --version      Show version information

Examples:
  hql run hello.hql           Run an HQL file
  hql run '(print "Hello")'   Run an HQL expression
  hql compile app.hql         Compile to JavaScript
  hql compile app.hql -t native  Compile to native binary

For command-specific help:
  hql <command> --help
`);
}

/**
 * Show version information
 */
function showVersion(): void {
  console.log("HQL version 0.1.0");
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  // Initialize config runtime before any command
  // This sets globalThis.__hqlConfig for AI functions to use
  await initConfigRuntime();

  const args = platformGetArgs();

  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    showHelp();
    return;
  }

  if (args[0] === "-v" || args[0] === "--version") {
    showVersion();
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case "run":
      // Run command with remaining args
      await runCommand(commandArgs);
      break;

    case "repl":
      // Start interactive REPL
      await replCommand(commandArgs);
      break;

    case "compile":
      if (commandArgs.includes("-h") || commandArgs.includes("--help")) {
        showCompileHelp();
      } else {
        await compileCommand(commandArgs);
      }
      break;

    case "init":
      if (commandArgs.includes("-h") || commandArgs.includes("--help")) {
        showInitHelp();
      } else {
        await initCommand(commandArgs);
      }
      break;

    case "lsp":
      if (commandArgs.includes("-h") || commandArgs.includes("--help")) {
        showLspHelp();
      } else {
        await lspCommand(commandArgs);
      }
      break;

    case "publish":
      if (commandArgs.includes("-h") || commandArgs.includes("--help")) {
        showPublishHelp();
      } else {
        await publishCommand(commandArgs);
      }
      break;

    case "upgrade":
      if (commandArgs.includes("-h") || commandArgs.includes("--help")) {
        showUpgradeHelp();
      } else {
        await upgradeCommand(commandArgs);
      }
      break;

    case "uninstall":
      if (commandArgs.includes("-h") || commandArgs.includes("--help")) {
        showUninstallHelp();
      } else {
        await uninstallCommand(commandArgs);
      }
      break;

    default:
      // Assume it's a file or expression to run
      // Pass the entire args (command included) as it might be a file path
      await runCommand(args);
      break;
  }
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error.message);
    Deno.exit(1);
  });
}

export { main };
