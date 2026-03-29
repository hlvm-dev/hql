/**
 * HLVM REPL Commands
 * Handles slash-prefixed commands like /help and /flush.
 */

import { ANSI_COLORS } from "../ansi.ts";
import type { ReplState } from "./state.ts";
import { handleConfigCommand } from "./config/index.ts";
import { registry } from "../repl-ink/keybindings/index.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { normalizeModelId } from "../../../common/config/types.ts";
import { persistSelectedModelConfig } from "../../../common/config/model-selection.ts";
import { listRuntimeMcpServers } from "../../runtime/host-client.ts";
import {
  getTaskManager,
  isDelegateTask,
  isEvalTask,
  isModelPullTask,
  isTaskActive,
} from "./task-manager/index.ts";
import {
  formatElapsed,
  formatProgressBar,
} from "../repl-ink/utils/formatting.ts";
import { STATUS_GLYPHS } from "../repl-ink/ui-constants.ts";

const { CYAN, GREEN, YELLOW, DIM_GRAY, RESET, BOLD } = ANSI_COLORS;

// Pre-compiled whitespace pattern for command parsing
const WHITESPACE_SPLIT_REGEX = /\s+/;

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
  {
    name: "/runtime",
    description: "Set session runtime mode (manual|auto)",
  },
  {
    name: "/surface",
    description: "Open the active execution-surface inspector",
  },
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

${BOLD}Input Routing:${RESET}
  ${CYAN}(expression)${RESET}         HQL code evaluation
  ${CYAN}(js "code")${RESET}          JavaScript evaluation
  ${CYAN}/command${RESET}             Slash commands
  Everything else      AI conversation

${BOLD}Tip:${RESET} Press ${YELLOW}Ctrl+P${RESET} to open the command palette with fuzzy search.

${BOLD}Examples:${RESET}

  ${DIM_GRAY}; HQL evaluation${RESET}
  ${GREEN}(def name "seoksoon")${RESET}
  ${GREEN}(defn greet [name] (str "Hello, " name "!"))${RESET}

  ${DIM_GRAY}; JavaScript evaluation${RESET}
  ${GREEN}(js "let x = 42")${RESET}
  ${GREEN}(js "await Promise.resolve(42)")${RESET}

  ${DIM_GRAY}; AI conversation (just type naturally)${RESET}
  ${GREEN}what does this function do?${RESET}
  ${GREEN}explain the error in my code${RESET}
`;
}

export const commands: Record<string, Command> = {
  "/help": {
    description: "Show help message",
    handler: (_state, _args, context) => {
      context.output(generateHelpText());
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

  "/tasks": {
    description: "List background tasks",
    handler: (_state, _args, context) => {
      const tm = getTaskManager();
      const tasks = Array.from(tm.getTasks().values());
      if (tasks.length === 0) {
        context.output("No background tasks.");
        return;
      }
      const now = Date.now();
      for (const task of tasks) {
        const active = isTaskActive(task);
        const icon = active
          ? STATUS_GLYPHS.running
          : task.status === "completed"
          ? STATUS_GLYPHS.success
          : task.status === "failed"
          ? STATUS_GLYPHS.error
          : STATUS_GLYPHS.cancelled;
        const elapsed = task.startedAt
          ? formatElapsed((task.completedAt ?? now) - task.startedAt)
          : "";
        const timeSuffix = active
          ? elapsed ? `(${elapsed})` : ""
          : elapsed
          ? `(${elapsed} ago)`
          : "";

        if (isModelPullTask(task)) {
          const pct = task.progress.total && task.progress.completed
            ? Math.round((task.progress.completed / task.progress.total) * 100)
            : 0;
          const bar = active
            ? `${formatProgressBar(pct)} ${pct}%`
            : task.status;
          context.output(
            `  ${icon}  Pulling ${task.modelName.padEnd(20)} ${
              bar.padEnd(16)
            } ${timeSuffix}`,
          );
        } else if (isEvalTask(task)) {
          const preview = task.preview.padEnd(24);
          const detail = task.status === "completed"
            ? `\u2192 ${String(task.result ?? "").slice(0, 30)}`
            : task.status === "failed"
            ? `Error: ${task.error?.message?.slice(0, 25) ?? "unknown"}`
            : task.progress.status;
          context.output(
            `  ${icon}  ${preview} ${detail.padEnd(20)} ${timeSuffix}`,
          );
        } else if (isDelegateTask(task)) {
          const label = `${task.nickname} (${task.agent}): ${
            task.task.slice(0, 20)
          }`;
          context.output(
            `  ${icon}  ${label.padEnd(36)} ${
              task.status.padEnd(12)
            } ${timeSuffix}`,
          );
        } else {
          context.output(`  ${icon}  ${task.label}  (${task.status})`);
        }
      }
      if (tm.getActiveCount() > 0) {
        context.output(`\n  ${DIM_GRAY}Ctrl+F cancels all${RESET}`);
      }
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
};

/** Unified catalog of all slash commands (derived from `commands` + App-handled commands). */
export const COMMAND_CATALOG: readonly { name: string; description: string }[] =
  [
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
