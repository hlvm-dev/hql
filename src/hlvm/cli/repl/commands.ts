/**
 * HLVM REPL Commands
 * Handles slash-prefixed commands like /help, /clear, /reset
 */

import { ANSI_COLORS } from "../ansi.ts";
import type { ReplState } from "./state.ts";
import { handleConfigCommand } from "./config/index.ts";
import { registry } from "../repl-ink/keybindings/index.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { listSessions } from "../../store/conversation-store.ts";
import { handleDeleteAllSessions } from "./handlers/sessions.ts";
import { normalizeModelId } from "../../../common/config/types.ts";

const { CYAN, GREEN, YELLOW, DIM_GRAY, RESET, BOLD } = ANSI_COLORS;

// Pre-compiled whitespace pattern for command parsing
const WHITESPACE_SPLIT_REGEX = /\s+/;

export interface Command {
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

export interface RunCommandOptions {
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

export const COMMAND_CATALOG: readonly { name: string; description: string }[] =
  [
    { name: "/help", description: "Show help message" },
    { name: "/clear", description: "Clear the screen" },
    { name: "/reset", description: "Reset REPL state and clear memory" },
    { name: "/exit", description: "Exit the REPL" },
    { name: "/memory", description: "Show memory file location and stats" },
    { name: "/forget", description: "Remove a definition from memory" },
    { name: "/config", description: "View/set configuration" },
    { name: "/model", description: "Show or set current model" },
    { name: "/models", description: "Open model picker" },
    { name: "/status", description: "Show runtime status" },
    { name: "/tasks", description: "View background tasks" },
    { name: "/bg", description: "Push current eval to background" },
    { name: "/resume", description: "Resume a previous session" },
    { name: "/clear-history", description: "Delete all chat history" },
    { name: "/mcp", description: "List configured MCP servers" },
    { name: "/quickstart", description: "Show getting-started examples" },
    { name: "/warnings", description: "Show startup warnings" },
  ];

/** Generate help text dynamically using keybinding registry */
function generateHelpText(): string {
  const shortcuts = registry.generateHelpText();

  return `
${BOLD}HLVM REPL Functions:${RESET}

  ${CYAN}(memory)${RESET}         List all saved definitions
  ${CYAN}(forget "x")${RESET}     Remove definition from memory
  ${CYAN}(inspect x)${RESET}      Show source code (fast, no AI)
  ${CYAN}(describe x)${RESET}     Source + AI explanation & examples
  ${CYAN}(help)${RESET}           Show this help
  ${CYAN}(exit)${RESET}           Exit the REPL
  ${CYAN}(clear)${RESET}          Clear the screen

${BOLD}Memory (auto-persist def/defn):${RESET}

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

  "/clear": {
    description: "Clear the screen",
    handler: () => {
      log.raw.clear();
    },
  },

  "/reset": {
    description: "Reset REPL state and clear memory",
    handler: async (state, _args, context) => {
      state.reset();
      // Use memory API for single source of truth
      const memoryApi = (globalThis as Record<string, unknown>).memory as {
        clear: () => Promise<void>;
      } | undefined;
      if (memoryApi?.clear) {
        await memoryApi.clear();
      }
      context.output(
        `${GREEN}REPL state reset. All bindings and memory cleared.${RESET}`,
      );
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

  "/memory": {
    description: "Show memory file location and stats",
    handler: async (_state, _args, context) => {
      // Use memory API for single source of truth
      const memoryApi = (globalThis as Record<string, unknown>).memory as {
        stats: () => Promise<
          { path: string; count: number; size: number } | null
        >;
        list: () => Promise<string[]>;
      } | undefined;

      if (!memoryApi) {
        context.output(`${YELLOW}Memory API not initialized.${RESET}`);
        return;
      }

      const stats = await memoryApi.stats();
      if (stats) {
        context.output(`${BOLD}Memory:${RESET}`);
        context.output(`  ${CYAN}Location:${RESET} ${stats.path}`);
        context.output(`  ${CYAN}Definitions:${RESET} ${stats.count}`);
        context.output(`  ${CYAN}Size:${RESET} ${stats.size} bytes`);
        if (stats.count > 0) {
          const names = await memoryApi.list();
          context.output(`  ${CYAN}Names:${RESET} ${names.join(", ")}`);
        }
      } else {
        context.output(`${YELLOW}Could not read memory file.${RESET}`);
      }
    },
  },

  "/forget": {
    description: "Remove a definition from memory",
    handler: async (_state, args, context) => {
      const name = args.trim();
      if (!name) {
        context.output(`${YELLOW}Usage: /forget <name>${RESET}`);
        context.output(`${DIM_GRAY}Example: /forget myFunction${RESET}`);
        return;
      }

      // Use memory API for single source of truth
      const memoryApi = (globalThis as Record<string, unknown>).memory as {
        remove: (name: string) => Promise<boolean>;
      } | undefined;

      if (!memoryApi) {
        context.output(`${YELLOW}Memory API not initialized.${RESET}`);
        return;
      }

      const removed = await memoryApi.remove(name);
      if (removed) {
        context.output(`${GREEN}Removed '${name}' from memory.${RESET}`);
        context.output(
          `${DIM_GRAY}Note: The binding still exists in this session. Use /reset to clear all bindings.${RESET}`,
        );
      } else {
        context.output(`${YELLOW}'${name}' not found in memory.${RESET}`);
      }
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
        context.output(`${DIM_GRAY}Tip: /model <provider/model> to set (or /models to browse).${RESET}`);
        return;
      }

      const normalized = normalizeModelId(modelArg);
      if (!normalized) {
        context.output(`${YELLOW}Invalid model ID.${RESET} Use format ${CYAN}provider/model${RESET}.`);
        return;
      }

      if (!configApi.set) {
        context.output(`${YELLOW}Config setter unavailable in this context.${RESET}`);
        return;
      }

      await configApi.set("model", normalized);
      context.output(`${GREEN}Default model set to ${normalized}.${RESET}`);
    },
  },

  "/models": {
    description: "Open model picker",
    handler: (_state, _args, context) => {
      context.output(`${DIM_GRAY}Use /models in the interactive REPL to open the model picker.${RESET}`);
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
      const warnings = (globalThis as Record<string, unknown>).__hlvmStartupWarnings;
      const warningCount = Array.isArray(warnings)
        ? warnings.filter((line: unknown) => typeof line === "string" && line.length > 0).length
        : 0;

      context.output(`${BOLD}Status:${RESET}`);
      context.output(`  ${CYAN}AI:${RESET} ${aiStatus}`);
      context.output(`  ${CYAN}Model:${RESET} ${model}`);
      context.output(`  ${CYAN}Startup warnings:${RESET} ${warningCount}`);
    },
  },

  "/clear-history": {
    description: "Delete all chat history",
    handler: async (_state, _args, context) => {
      const sessions = listSessions();
      if (sessions.length === 0) {
        context.output(`${YELLOW}No conversations to delete.${RESET}`);
        return;
      }
      const response = handleDeleteAllSessions();
      const payload = await response.json() as { count?: number };
      const count = typeof payload.count === "number" ? payload.count : sessions.length;
      context.output(`${GREEN}Deleted ${count} conversation(s).${RESET}`);
    },
  },
  "/mcp": {
    description: "List configured MCP servers",
    handler: async (_state, _args, context) => {
      const { formatServerEntry, loadMcpConfigMultiScope } = await import(
        "../../agent/mcp/config.ts"
      );
      const workspace = getPlatform().process.cwd();
      const servers = await loadMcpConfigMultiScope(workspace);
      if (servers.length === 0) {
        context.output(
          `${YELLOW}No MCP servers configured.${RESET} Use ${CYAN}hlvm mcp add${RESET} to add one.`,
        );
        return;
      }
      context.output(`${BOLD}MCP Servers:${RESET}`);
      for (const s of servers) {
        const { transport, target, scopeLabel } = formatServerEntry(s);
        context.output(
          `  ${CYAN}${s.name.padEnd(20)}${RESET} ${transport.padEnd(6)} ${target}  ${DIM_GRAY}(${scopeLabel})${RESET}`,
        );
      }
    },
  },
  "/quickstart": {
    description: "Show getting-started examples",
    handler: (_state, _args, context) => {
      context.output(`
${BOLD}Polyglot Mode${RESET}  ${DIM_GRAY}(expr) → HQL  |  expr → JS${RESET}

  ${GREEN}let x = 10${RESET}                ${DIM_GRAY}→ JS variable${RESET}
  ${GREEN}(+ x 5)${RESET}                   ${DIM_GRAY}→ HQL with JS${RESET}
  ${GREEN}const f = (a,b) => a+b${RESET}    ${DIM_GRAY}→ JS function${RESET}
  ${GREEN}(f 3 4)${RESET}                   ${DIM_GRAY}→ Call from HQL${RESET}

${BOLD}Quick Start${RESET}

  ${GREEN}(+ 1 2)${RESET}                   ${DIM_GRAY}→ Simple math${RESET}
  ${GREEN}(fn add [x y] (+ x y))${RESET}   ${DIM_GRAY}→ Define function${RESET}
  ${GREEN}(add 10 20)${RESET}               ${DIM_GRAY}→ Call function${RESET}

${BOLD}AI${RESET}  ${DIM_GRAY}(import [ask] from "@hlvm/ai")${RESET}

  ${GREEN}(await (ask "Hello"))${RESET}     ${DIM_GRAY}→ AI response${RESET}

${DIM_GRAY}Tip: Type /help for all commands and keybindings.${RESET}`);
    },
  },

  "/warnings": {
    description: "Show startup warnings",
    handler: (_state, _args, context) => {
      const warnings = (globalThis as Record<string, unknown>).__hlvmStartupWarnings;
      const lines = Array.isArray(warnings)
        ? warnings.filter((line: unknown): line is string => typeof line === "string" && line.length > 0)
        : [];

      if (lines.length === 0) {
        context.output(`${DIM_GRAY}No startup warnings.${RESET}`);
        return;
      }

      context.output(`${BOLD}Startup warnings:${RESET}`);
      for (const warning of lines) {
        context.output(`${YELLOW}•${RESET} ${warning}`);
      }
    },
  },

  // NOTE: /tasks is handled by App.tsx to open BackgroundTasksOverlay
  // Do not add /tasks handler here - it would conflict
};

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
