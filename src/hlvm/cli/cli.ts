#!/usr/bin/env -S deno run -A

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
import { showSkillHelp, skillCommand } from "./commands/skill.ts";
import { bootstrapCommand, showBootstrapHelp } from "./commands/bootstrap.ts";
import { chromeExtCommand, showChromeExtHelp } from "./commands/chrome-ext.ts";

import { run as runCommand } from "./run.ts";
import { VERSION } from "../../common/version.ts";
import { HLVM_RUNTIME_DEFAULT_PORT } from "../runtime/host-config.ts";
import { ValidationError } from "../../common/error.ts";
import { stripErrorCodeFromMessage } from "../../common/error-codes.ts";
import {
  extractLeadingRuntimePortFlag,
  extractRuntimePortFlag,
  RUNTIME_PORT_ENV,
} from "./utils/runtime-port-flag.ts";

interface ParsedReplArgs {
  debug: boolean;
  showBanner: boolean;
}

const RUNTIME_PORT_COMMANDS = new Set([
  "ask",
  "repl",
  "serve",
]);

function parseReplArgs(args: string[]): ParsedReplArgs {
  const parsed: ParsedReplArgs = {
    debug: false,
    showBanner: true,
  };

  for (const arg of args) {
    switch (arg) {
      case "--debug":
        parsed.debug = true;
        break;
      case "--ink":
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

async function replCommand(args: string[]): Promise<number> {
  if (hasHelpFlag(args)) {
    log.raw.log(`
HLVM Interactive Shell - HQL/JS Read-Eval-Print Loop

USAGE:
  hlvm repl [options]

OPTIONS:
  --ink             Force Ink REPL (interactive terminal only)
  --port <port>     Use a dedicated local runtime port
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

  if (args.includes("--version")) {
    log.raw.log(`HLVM REPL v${VERSION}`);
    return 0;
  }

  const parsedArgs = parseReplArgs(args);

  const startInkRepl = await import("./repl-ink/index.tsx").then((m) =>
    m.startInkRepl
  );

  return await startInkRepl({
    showBanner: parsedArgs.showBanner,
    debug: parsedArgs.debug,
  });
}

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
  skill              Manage agent skills
  update             Update HLVM to the latest version
  uninstall          Uninstall HLVM

Options:
  -h, --help         Show this help message
  -v, --version      Show version information
  --port <port>      Use a dedicated local runtime port

Examples:
  hlvm run hello.hql           Run an HQL file
  hlvm run '(print "Hello")'   Run an HQL expression
  hlvm hql init -y             Initialize a new HQL project
  hlvm hql compile app.hql     Compile to JavaScript
  hlvm chat "hello"            Plain chat
  hlvm ask "refactor main.ts"  Run AI agent task
  hlvm --port 18442 ask "test" Use a dedicated runtime port

For command-specific help:
  hlvm <command> --help
`);
}

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
  skill: { run: skillCommand, help: showSkillHelp },
  model: { run: modelCommand, help: showModelHelp },
  bootstrap: { run: bootstrapCommand, help: showBootstrapHelp },
  "chrome-ext": { run: chromeExtCommand, help: showChromeExtHelp },
};

function exitIfNonZero(result: unknown): void {
  if (typeof result === "number" && result !== 0) {
    getPlatform().process.exit(result);
  }
}

async function main(): Promise<void> {
  const platform = getPlatform();
  let args = platformGetArgs();
  const globalPort = extractLeadingRuntimePortFlag(args);
  args = globalPort.args;
  if (globalPort.port) {
    platform.env.set(RUNTIME_PORT_ENV, globalPort.port);
  }

  if (args[0] === "-h" || args[0] === "--help") {
    showHelp();
    return;
  }

  if (args[0] === "-v" || args[0] === "--version") {
    showVersion();
    return;
  }

  if (args.length === 0) {
    exitIfNonZero(await replCommand([]));
    return;
  }

  const command = args[0];
  let commandArgs = args.slice(1);
  if (RUNTIME_PORT_COMMANDS.has(command)) {
    const commandPort = extractRuntimePortFlag(commandArgs);
    commandArgs = commandPort.args;
    if (commandPort.port) {
      platform.env.set(RUNTIME_PORT_ENV, commandPort.port);
    }
  }

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
    exitIfNonZero(await runCommand(args));
    return;
  }
  if (command === "mcp") {
    exitIfNonZero(await entry.run(commandArgs));
    return;
  }
  if (entry.help && hasHelpFlag(commandArgs)) {
    entry.help();
  } else {
    exitIfNonZero(await entry.run(commandArgs));
  }
}

if (import.meta.main) {
  main().catch((error) => {
    const args = platformGetArgs();
    const command = args[0];
    const message = stripErrorCodeFromMessage(error.message);
    if (command === "mcp") {
      log.raw.error(message);
    } else {
      log.raw.error("Error:", message);
    }
    getPlatform().process.exit(1);
  });
}

export { main };
