#!/usr/bin/env -S deno run -A
/**
 * HLVM CLI - Main entry point
 * Dispatches to appropriate command handlers
 */

import { getPlatform } from "../../platform/platform.ts";
import { log } from "../api/log.ts";
import { hasHelpFlag } from "./utils/common-helpers.ts";
import { platformGetArgs } from "./utils/platform-helpers.ts";
import { hqlCommand } from "./commands/hql.ts";
import {
  showUninstallHelp,
  uninstall as uninstallCommand,
} from "./commands/uninstall.ts";
import { showUpdateHelp, update as updateCommand } from "./commands/upgrade.ts";
import { aiCommand, showAiHelp } from "./commands/ai.ts";
import { askCommand, showAskHelp } from "./commands/ask.ts";
import { chatCommand, showChatHelp } from "./commands/chat.ts";
import { classifyCommand, showClassifyHelp } from "./commands/classify.ts";
import { ollamaCommand, showOllamaHelp } from "./commands/ollama.ts";
import { serveCommand, showServeHelp } from "./commands/serve.ts";
import { mcpCommand, showMcpHelp } from "./commands/mcp.ts";
import { modelCommand, showModelHelp } from "./commands/model.ts";
import { bootstrapCommand, showBootstrapHelp } from "./commands/bootstrap.ts";
import { chromeExtCommand, showChromeExtHelp } from "./commands/chrome-ext.ts";

import { run as runCommand } from "./run.ts";
const loadOldRepl = () =>
  import("./repl-ink/index.tsx").then((m) => m.startInkRepl);
import { VERSION } from "../../common/version.ts";
import { HLVM_RUNTIME_DEFAULT_PORT } from "../runtime/host-config.ts";
import { ensureDenoAvailable } from "./utils/toolchain.ts";
import { ValidationError } from "../../common/error.ts";

interface ParsedReplArgs {
  debug: boolean;
  showBanner: boolean;
  useNewTui: boolean;
}

function parseReplArgs(args: string[]): ParsedReplArgs {
  const parsed: ParsedReplArgs = {
    debug: false,
    showBanner: true,
    useNewTui: false,
  };

  for (const arg of args) {
    switch (arg) {
      case "--debug":
        parsed.debug = true;
        break;
      case "--ink":
        break;
      case "--new":
        parsed.useNewTui = true;
        break;
      case "--no-banner":
        parsed.showBanner = false;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new ValidationError(`Unknown option: ${arg}`, "repl");
        }
        throw new ValidationError(`Unexpected argument: ${arg}`, "repl");
    }
  }

  return parsed;
}

/**
 * Handle `hlvm repl` command
 */
async function replCommand(args: string[]): Promise<number> {
  // Handle help
  if (hasHelpFlag(args)) {
    log.raw.log(`
HLVM Interactive Shell - HQL/JS Read-Eval-Print Loop

USAGE:
  hlvm repl [options]

OPTIONS:
  --new             Use TUI v2 (experimental)
  --ink             Force Ink REPL (interactive terminal only)
  --debug           Show internal agent trace rows in the REPL transcript
  --no-banner       Skip the startup banner
  --help, -h        Show this help
  --version         Show version

INPUT ROUTING:
  (expression)         HQL code evaluation
  (js "code")          JavaScript evaluation
  /command             Slash commands
  Everything else      AI conversation

EXAMPLES:
  hlvm repl              Start REPL
  hlvm repl --debug      Start REPL with internal trace rows
`);
    return 0;
  }

  // Handle version
  if (args.includes("--version")) {
    log.raw.log(`HLVM REPL v${VERSION}`);
    return 0;
  }

  const parsedArgs = parseReplArgs(args);

  if (parsedArgs.useNewTui && parsedArgs.debug) {
    throw new ValidationError(
      "--debug is currently supported in the default Ink REPL only; remove --new.",
      "repl",
    );
  }

  if (parsedArgs.useNewTui) {
    return await launchTuiV2Baseline(args);
  }

  const startInkRepl = await loadOldRepl();

  return await startInkRepl({
    showBanner: parsedArgs.showBanner,
    debug: parsedArgs.debug,
  });
}

async function launchTuiV2Baseline(args: string[]): Promise<number> {
  const platform = getPlatform();
  const denoBinary = await ensureDenoAvailable();
  const { configPath, mainPath } = await resolveTuiV2LaunchPaths();
  const proc = platform.command.run({
    cmd: [
      denoBinary,
      "run",
      "--allow-all",
      "--unstable-sloppy-imports",
      "--config",
      configPath,
      mainPath,
      ...args.filter((arg) => arg !== "--new"),
    ],
    env: platform.env.toObject(),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await proc.status;
  return status.code;
}

async function resolveTuiV2LaunchPaths(): Promise<{
  configPath: string;
  mainPath: string;
}> {
  const platform = getPlatform();
  const candidates = [
    platform.path.resolve(platform.process.cwd(), "src/hlvm/tui-v2"),
    platform.path.resolve(
      platform.path.dirname(platform.process.execPath()),
      "src/hlvm/tui-v2",
    ),
    platform.path.fromFileUrl(new URL("../tui-v2", import.meta.url)),
  ];

  for (const baseDir of candidates) {
    const configPath = platform.path.join(baseDir, "deno.json");
    const mainPath = platform.path.join(baseDir, "main.tsx");
    if (
      await platform.fs.exists(configPath) && await platform.fs.exists(mainPath)
    ) {
      return { configPath, mainPath };
    }
  }

  throw new Error(
    "TUI v2 entry files not found. Expected src/hlvm/tui-v2/{main.tsx,deno.json}.",
  );
}

/**
 * Display main CLI help
 */
function showHelp(): void {
  log.raw.log(`
HLVM - AI-native runtime infrastructure

Usage: hlvm <command> [options]

Commands:
  run <file|expr>    Run a file or expression
  repl               Start interactive shell
  chat "<query>"     Plain non-agent chat
  classify "<prompt>" Fast local LLM classification (no agent)
  serve              Start HTTP REPL server
  hql                HQL language tools (init, compile, publish)
  ask "<query>"      Ask AI agent to perform a task
  model              Manage AI models (list, set, show, pull, rm)
  ai                 Setup and manage AI models
  ollama serve       Explicit compatibility bridge to system Ollama
  mcp                Manage MCP tool servers
  update             Update HLVM to the latest version
  uninstall          Uninstall HLVM

Options:
  -h, --help         Show this help message
  -v, --version      Show version information

Examples:
  hlvm run hello.hql           Run an HQL file
  hlvm run '(print "Hello")'   Run an HQL expression
  hlvm hql init -y             Initialize a new HQL project
  hlvm hql compile app.hql     Compile to JavaScript
  hlvm chat "hello"            Plain chat
  hlvm ask "refactor main.ts"  Run AI agent task

For command-specific help:
  hlvm <command> --help
`);
}

/**
 * Show version information
 */
function showVersion(): void {
  log.raw.log(`HLVM version ${VERSION}`);
}

type CommandEntry = {
  run: (args: string[]) => Promise<unknown>;
  help?: () => void;
};
const COMMANDS: Record<string, CommandEntry> = {
  run: { run: runCommand },
  repl: { run: replCommand },
  hql: { run: hqlCommand },
  ai: { run: aiCommand, help: showAiHelp },
  ask: { run: askCommand, help: showAskHelp },
  chat: { run: chatCommand, help: showChatHelp },
  classify: { run: classifyCommand, help: showClassifyHelp },
  update: { run: updateCommand, help: showUpdateHelp },
  uninstall: { run: uninstallCommand, help: showUninstallHelp },
  ollama: { run: ollamaCommand, help: showOllamaHelp },
  serve: { run: serveCommand, help: showServeHelp },
  mcp: { run: mcpCommand, help: showMcpHelp },
  model: { run: modelCommand, help: showModelHelp },
  bootstrap: { run: bootstrapCommand, help: showBootstrapHelp },
  "chrome-ext": { run: chromeExtCommand, help: showChromeExtHelp },
};

function exitIfNonZero(result: unknown): void {
  if (typeof result === "number" && result !== 0) {
    getPlatform().process.exit(result);
  }
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = platformGetArgs();

  if (args[0] === "-h" || args[0] === "--help") {
    showHelp();
    return;
  }

  if (args[0] === "-v" || args[0] === "--version") {
    showVersion();
    return;
  }

  // Default: start REPL when no arguments (for GUI compatibility)
  if (args.length === 0) {
    exitIfNonZero(await replCommand([]));
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  if (command === "__runtime-default-port") {
    log.raw.log(String(HLVM_RUNTIME_DEFAULT_PORT));
    return;
  }

  if (command === "upgrade") {
    log.raw.error("Unknown command: upgrade");
    log.raw.log("Use `hlvm update`.");
    getPlatform().process.exit(1);
  }

  const entry = COMMANDS[command];
  if (!entry) {
    // Default: assume it's a file or expression to run
    exitIfNonZero(await runCommand(args));
    return;
  }
  if (entry.help && hasHelpFlag(commandArgs)) {
    entry.help();
  } else {
    exitIfNonZero(await entry.run(commandArgs));
  }
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    log.raw.error("Error:", error.message);
    getPlatform().process.exit(1);
  });
}

export { main };
