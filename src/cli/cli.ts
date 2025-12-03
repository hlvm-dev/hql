import { run } from "./run.ts";
import {
  exit as platformExit,
  getArgs as platformGetArgs,
} from "../platform/platform.ts";
import { hasHelpFlag } from "./utils/common-helpers.ts";
import { version as VERSION } from "../../mod.ts";
const VALID_COMMANDS = ["repl", "init", "publish", "run", "compile"] as const;
const COMMANDS_REQUIRING_TARGET = new Set<Command>(["run", "compile"]);

// Types
type Command = typeof VALID_COMMANDS[number];
type CommandExecutor = (args: string[]) => Promise<void>;

/**
 * Print help information to the console
 */
function printHelp(): void {
  console.log(`
HQL - Command Line Interface

USAGE:
  hql repl                  Start interactive REPL
  hql init [options]        Initialize a new HQL project
  hql run <file>            Execute an HQL source file
  hql run '<expr>'          Evaluate an HQL expression
  hql compile <file>        Compile HQL to JavaScript or native binary
  hql publish [options]     Publish HQL module to JSR/NPM

OPTIONS:
  --help, -h                Show this help message
  --version                 Show version
  --time                    Show performance timing information
  --verbose                 Enable detailed logging
  --debug                   Show detailed error information and call stacks
  --log <namespaces>        Filter log output to specific namespaces

COMPILE OPTIONS:
  --target <target>         Compilation target (default: js)
                            js          - JavaScript output
                            native      - Binary for current platform
                            all         - All platforms at once
                            linux       - Linux x86_64 binary
                            macos       - macOS ARM64 binary (Apple Silicon)
                            macos-intel - macOS x86_64 binary (Intel)
                            windows     - Windows x86_64 binary
  -o, --output <path>       Output file path

EXAMPLES:
  hql repl                      # Start interactive REPL
  hql init                      # Initialize project
  hql run hello.hql             # Run HQL file
  hql run '(+ 1 2)'             # Evaluate expression: 3
  hql compile hello.hql         # Compile to JavaScript
  hql compile hello.hql --target native  # Compile to native binary
  hql compile hello.hql --target all     # Compile for all platforms

For command-specific help:
  hql compile --help
`);
}

/**
 * Display version information
 */
function showVersion(): void {
  console.log(`HQL CLI version ${VERSION}`);
}

/**
 * Validate command and arguments
 */
function validateCommand(args: string[]): Command {
  const [command, ...commandArgs] = args;

  if (!command) {
    console.error("Error: Missing command");
    printHelp();
    platformExit(1);
  }

  if (!VALID_COMMANDS.includes(command as Command)) {
    console.error(`Error: Unknown command '${command}'`);
    printHelp();
    platformExit(1);
  }

  if (COMMANDS_REQUIRING_TARGET.has(command as Command) && !commandArgs.length) {
    console.error(`Error: Missing target for '${command}' command`);
    printHelp();
    platformExit(1);
  }

  return command as Command;
}

/**
 * Execute the REPL command
 */
async function executeReplCommand(args: string[]): Promise<void> {
  const { main } = await import("./repl.ts");
  await main(args);
}

/**
 * Execute the compile command
 */
async function executeCompileCommand(args: string[]): Promise<void> {
  await executeWithHelpHandler(
    args,
    () => import("./commands/compile.ts"),
    (m) => m.showCompileHelp,
    (m) => m.compileCommand
  );
}

/**
 * Handle help flag and execute command
 */
async function executeWithHelpHandler<T>(
  args: string[],
  importModule: () => Promise<T>,
  getHelpFn: (module: T) => () => void,
  getCommandFn: (module: T) => (args: string[]) => Promise<void>
): Promise<void> {
  const module = await importModule();

  if (hasHelpFlag(args)) {
    getHelpFn(module)();
    platformExit(0);
  }

  await getCommandFn(module)(args);
}

/**
 * Execute the init command
 */
async function executeInitCommand(args: string[]): Promise<void> {
  await executeWithHelpHandler(
    args,
    () => import("./commands/init.ts"),
    (m) => m.showInitHelp,
    (m) => m.init
  );
}

/**
 * Execute the publish command
 */
async function executePublishCommand(args: string[]): Promise<void> {
  await executeWithHelpHandler(
    args,
    () => import("./commands/publish.ts"),
    (m) => m.showPublishHelp,
    (m) => m.publishCommand
  );
}

/**
 * Execute the run command
 */
async function executeRunCommand(args: string[]): Promise<void> {
  await run(args);
}

/**
 * Command handler map for O(1) routing
 */
const commandHandlers: Record<Command, CommandExecutor> = {
  repl: executeReplCommand,
  init: executeInitCommand,
  publish: executePublishCommand,
  run: executeRunCommand,
  compile: executeCompileCommand,
};

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  const args = platformGetArgs();

  // Handle no arguments
  if (args.length === 0) {
    printHelp();
    platformExit(0);
  }

  // Handle global version flag
  if (args.includes("--version")) {
    showVersion();
    platformExit(0);
  }

  // Handle global help flag (when no valid command follows)
  const [firstArg] = args;
  if (hasHelpFlag(args) && !VALID_COMMANDS.includes(firstArg as Command)) {
    printHelp();
    platformExit(0);
  }

  // Validate command
  const command = validateCommand(args);
  const [, ...commandArgs] = args;

  // Route to command handler (O(1) lookup)
  const handler = commandHandlers[command];
  await handler(commandArgs);
}

if (import.meta.main) {
  main();
}
