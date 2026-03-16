/**
 * HLVM REPL Commands
 * Handles slash-prefixed commands like /help, /new, and /flush.
 */

import { ANSI_COLORS } from "../ansi.ts";
import type { ReplState } from "./state.ts";
import { handleConfigCommand } from "./config/index.ts";
import { registry } from "../repl-ink/keybindings/index.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { clearCurrentSession } from "../../api/session.ts";
import { normalizeModelId } from "../../../common/config/types.ts";
import { persistSelectedModelConfig } from "../../../common/config/model-selection.ts";
import { listRuntimeMcpServers } from "../../runtime/host-client.ts";

const { CYAN, GREEN, YELLOW, DIM_GRAY, RESET, BOLD } = ANSI_COLORS;

// Pre-compiled whitespace pattern for command parsing
const WHITESPACE_SPLIT_REGEX = /\s+/;

function getStartupWarnings(): string[] {
  const warnings = (globalThis as Record<string, unknown>).__hlvmStartupWarnings;
  return Array.isArray(warnings)
    ? warnings.filter((line: unknown): line is string =>
      typeof line === "string" && line.length > 0
    )
    : [];
}

interface Command {
  description: string;
  handler: (
    state: ReplState,
    args: string,
    context: CommandContext,
  ) => void | Promise<void>;
}

interface CommandContext {
  output: (...args: unknown[]) => void;
}

interface RunCommandOptions {
  onOutput?: (line: string) => void;
}

function stringifyOutputArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return "[Circular]";
    }
  }
  return String(value);
}

function createOutputWriter(
  options?: RunCommandOptions,
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    if (options?.onOutput) {
      options.onOutput(args.map((arg) => stringifyOutputArg(arg)).join(" "));
      return;
    }
    log.raw.log(...args);
  };
}

// Commands handled by App.tsx (not in the `commands` record below)
const APP_HANDLED_COMMANDS: readonly { name: string; description: string }[] = [
  { name: "/resume", description: "Switch to another session" },
  { name: "/tasks", description: "View background tasks" },
  { name: "/bg", description: "Push current eval to background" },
];

/** Generate help text dynamically using keybinding registry */
function generateHelpText(): string {
  const shortcuts = registry.generateHelpText();

  return `
${BOLD}HLVM REPL Functions:${RESET}

  ${CYAN}(bindings)${RESET}           List all saved definitions
  ${CYAN}(unbind "x")${RESET}         Remove a definition
  ${CYAN}(remember "text")${RESET}    Save a note to MEMORY.md
  ${CYAN}(memory)${RESET}             Open MEMORY.md in your editor
  ${CYAN}(inspect x)${RESET}          Show source code (fast, no AI)
  ${CYAN}(describe x)${RESET}         Source + AI explanation & examples
  ${CYAN}(help)${RESET}               Show this help
  ${CYAN}(exit)${RESET}               Exit the REPL

${BOLD}Bindings (auto-persist def/defn):${RESET}

  Definitions are automatically saved to ~/.hlvm/memory.hql
  They persist across sessions. No explicit save needed.

${BOLD}Keybindings & Commands:${RESET}
${shortcuts}

${BOLD}Polyglot (always on):${RESET}
  Input starting with ( is HQL.
  All other input is JavaScript.

${BOLD}Tip:${RESET} Press ${YELLOW}Ctrl+P${RESET} to open the command palette with fuzzy search.

${BOLD}Examples:${RESET}

  ${DIM_GRAY}; Define a persistent value${RESET}
  ${GREEN}(def name "seoksoon")${RESET}

  ${DIM_GRAY}; Define a persistent function${RESET}
  ${GREEN}(defn greet [name] (str "Hello, " name "!"))${RESET}

  ${DIM_GRAY}; Use AI (requires embedded @hlvm/ai)${RESET}
  ${GREEN}(import [ask] from "@hlvm/ai")${RESET}
  ${GREEN}(await (ask "What is 2+2?"))${RESET}
`;
}

export const commands: Record<string, Command> = {
  "/help": {
    description: "Show help message",
    handler: (_state, _args, context) => {
      context.output(generateHelpText());
    },
  },

  "/new": {
    description: "Start a fresh conversation session",
    handler: () => {
      clearCurrentSession();
      log.raw.clear();
    },
  },

  "/flush": {
    description: "Clear visible screen output",
    handler: () => {
      log.raw.clear();
    },
  },

  "/exit": {
    description: "Exit the REPL",
    handler: async (state, _args, context) => {
      context.output("\nGoodbye!");
      await state.flushHistory();
      getPlatform().process.exit(0);
    },
  },

  "/config": {
    description: "View/set configuration",
    handler: async (_state, args) => {
      await handleConfigCommand(args);
    },
  },

  "/model": {
    description: "Show or set current model",
    handler: async (_state, args, context) => {
      const modelArg = args.trim();
      const configApi = (globalThis as Record<string, unknown>).config as
        | {
          snapshot?: { model?: unknown };
          set?: (key: string, value: unknown) => Promise<unknown>;
          patch?: (
            updates: Partial<Record<string, unknown>>,
          ) => Promise<unknown>;
        }
        | undefined;

      if (!configApi) {
        context.output(`${YELLOW}Configuration API not initialized.${RESET}`);
        return;
      }

      if (!modelArg) {
        const current = typeof configApi.snapshot?.model === "string"
          ? configApi.snapshot.model
          : "not configured";
        context.output(`${BOLD}Current model:${RESET} ${current}`);
        context.output(
          `${DIM_GRAY}Tip: /model opens the picker; /model <provider/model> sets it.${RESET}`,
        );
        return;
      }

      if (!normalizeModelId(modelArg)) {
        context.output(
          `${YELLOW}Invalid model ID.${RESET} Use format ${CYAN}provider/model${RESET}.`,
        );
        return;
      }

      if (!configApi.set && !configApi.patch) {
        context.output(
          `${YELLOW}Config setter unavailable in this context.${RESET}`,
        );
        return;
      }

      const normalized = await persistSelectedModelConfig(configApi, modelArg);
      context.output(`${GREEN}Default model set to ${normalized}.${RESET}`);
    },
  },

  "/status": {
    description: "Show runtime status",
    handler: (_state, _args, context) => {
      const configApi = (globalThis as Record<string, unknown>).config as
        | {
          snapshot?: { model?: unknown };
        }
        | undefined;
      const model = typeof configApi?.snapshot?.model === "string"
        ? configApi.snapshot.model
        : "not configured";
      const aiApi = (globalThis as Record<string, unknown>).ai as
        | { chat?: unknown }
        | undefined;
      const aiStatus = aiApi?.chat ? "ready" : "off";
      const warningCount = getStartupWarnings().length;

      context.output(`${BOLD}Status:${RESET}`);
      context.output(`  ${CYAN}AI:${RESET} ${aiStatus}`);
      context.output(`  ${CYAN}Model:${RESET} ${model}`);
      context.output(`  ${CYAN}Startup warnings:${RESET} ${warningCount}`);
    },
  },
  "/mcp": {
    description: "List configured MCP servers",
    handler: async (_state, _args, context) => {
      const servers = await listRuntimeMcpServers();
      if (servers.length === 0) {
        context.output(
          `${YELLOW}No MCP servers configured.${RESET} Use ${CYAN}hlvm mcp add${RESET} to add one.`,
        );
        return;
      }
      context.output(`${BOLD}MCP Servers:${RESET}`);
      for (const server of servers) {
        context.output(
          `  ${CYAN}${server.name.padEnd(20)}${RESET} ${
            server.transport.padEnd(6)
          } ${server.target}  ${DIM_GRAY}(${server.scopeLabel})${RESET}`,
        );
      }
    },
  },
  // NOTE: /tasks is handled by App.tsx to open BackgroundTasksOverlay
  // /bg, /resume, and /tasks are handled by App.tsx to manage interactive UI state.
};

/** Unified catalog of all slash commands (derived from `commands` + App-handled commands). */
export const COMMAND_CATALOG: readonly { name: string; description: string }[] = [
  ...Object.entries(commands).map(([name, cmd]) => ({
    name,
    description: cmd.description,
  })),
  ...APP_HANDLED_COMMANDS,
];

/** Check if input is a slash command */
export function isCommand(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.startsWith("/");
}

/** Run a command */
export async function runCommand(
  input: string,
  state: ReplState,
  options?: RunCommandOptions,
): Promise<void> {
  const output = createOutputWriter(options);
  const trimmed = input.trim();
  const [cmdName, ...args] = trimmed.split(WHITESPACE_SPLIT_REGEX);

  const command = commands[cmdName];
  if (command) {
    await command.handler(state, args.join(" "), { output });
  } else {
    output(`${YELLOW}Unknown command: ${cmdName}${RESET}`);
    output(`${DIM_GRAY}Type /help for available commands.${RESET}`);
  }
}
