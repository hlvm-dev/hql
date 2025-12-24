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

// Import run command from run.ts
import { run as runCommand } from "./run.ts";

/**
 * Display main CLI help
 */
function showHelp(): void {
  console.log(`
HQL - A homoiconic language that compiles to JavaScript

Usage: hql <command> [options]

Commands:
  run <file|expr>    Run an HQL file or expression
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
