#!/usr/bin/env -S deno run -A
/**
 * HLVM CLI - Main entry point
 * Dispatches to appropriate command handlers
 */

import { getArgs as platformGetArgs } from "../../platform/platform.ts";
import { compileCommand, showCompileHelp } from "./commands/compile.ts";
import { init as initCommand, showInitHelp } from "./commands/init.ts";
import { lspCommand, showLspHelp } from "./commands/lsp.ts";
import { publishCommand, showPublishHelp } from "./commands/publish.ts";
import { uninstall as uninstallCommand, showUninstallHelp } from "./commands/uninstall.ts";
import { upgrade as upgradeCommand, showUpgradeHelp } from "./commands/upgrade.ts";
import { aiCommand, showAiHelp } from "./commands/ai.ts";
import { initConfigRuntime } from "../../common/config/runtime.ts";
import { registerApis } from "../api/index.ts";

// Import run command from run.ts
import { run as runCommand } from "./run.ts";
// Import repl command from Ink REPL
import { startInkRepl, type InkReplOptions } from "./repl-ink/index.tsx";
import { startHeadlessRepl } from "./repl/headless.ts";
import type { SessionInitOptions } from "./repl/session/types.ts";
import { VERSION } from "../../version.ts";

/**
 * Handle `hlvm repl` command
 */
async function replCommand(args: string[]): Promise<number> {
  // Handle help
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
HLVM REPL - Interactive HQL/JS Read-Eval-Print Loop

USAGE:
  hlvm repl [options]

OPTIONS:
  --js              Enable JavaScript polyglot mode (HQL + JS)
  --ink             Force Ink REPL (interactive terminal only)
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
  hlvm repl              Start REPL (new session)
  hlvm repl --continue   Resume last session
  hlvm repl -c           Resume last session (short form)
  hlvm repl --resume     Open session picker
  hlvm repl --js         Start polyglot REPL (HQL + JavaScript)
`);
    return 0;
  }

  // Handle version
  if (args.includes("--version")) {
    console.log(`HLVM REPL v${VERSION}`);
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

  const jsMode = args.includes("--js");
  const showBanner = !args.includes("--no-banner");
  const forceInk = args.includes("--ink");
  const hasTty = typeof Deno.stdin.isTerminal === "function" ? Deno.stdin.isTerminal() : true;

  if (!hasTty) {
    if (forceInk) {
      console.error("Error: Requires interactive terminal.");
      return 1;
    }
    return await startHeadlessRepl({ jsMode, showBanner });
  }

  const replOptions: InkReplOptions = {
    jsMode,
    showBanner,
    session: sessionOptions,
  };

  return await startInkRepl(replOptions);
}

/**
 * Display main CLI help
 */
function showHelp(): void {
  console.log(`
HLVM - Runtime platform for HQL and JavaScript

Usage: hlvm <command> [options]

Commands:
  run <file|expr>    Run an HQL file or expression
  repl               Start interactive REPL
  compile <file>     Compile HQL to JavaScript or native binary
  init               Initialize a new HLVM project
  lsp                Start the Language Server Protocol server
  publish            Publish an HLVM package
  ai                 Setup and manage AI models
  upgrade            Upgrade HLVM to the latest version
  uninstall          Uninstall HLVM

Options:
  -h, --help         Show this help message
  -v, --version      Show version information

Examples:
  hlvm run hello.hql           Run an HQL file
  hlvm run '(print "Hello")'   Run an HQL expression
  hlvm compile app.hql         Compile to JavaScript
  hlvm compile app.hql -t native  Compile to native binary

For command-specific help:
  hlvm <command> --help
`);
}

/**
 * Show version information
 */
function showVersion(): void {
  console.log(`HLVM version ${VERSION}`);
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  // Initialize config runtime before any command
  // Ensures config API is ready for commands and packages
  await initConfigRuntime();
  registerApis();

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

    case "ai":
      if (commandArgs.includes("-h") || commandArgs.includes("--help")) {
        showAiHelp();
      } else {
        await aiCommand(commandArgs);
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
