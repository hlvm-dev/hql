/**
 * HLVM REPL Commands
 * Handles slash-prefixed commands like /help, /clear, /reset
 */

import { ANSI_COLORS } from "../ansi.ts";
import type { ReplState } from "./state.ts";
import { handleConfigCommand } from "./config/index.ts";
import { registry } from "../repl-ink/keybindings/index.ts";
import { getTaskManager } from "./task-manager/index.ts";

const { CYAN, GREEN, YELLOW, DIM_GRAY, RESET, BOLD } = ANSI_COLORS;

// Pre-compiled whitespace pattern for command parsing
const WHITESPACE_SPLIT_REGEX = /\s+/;

export interface Command {
  description: string;
  handler: (state: ReplState, args: string) => void | Promise<void>;
}

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
    handler: () => {
      console.log(generateHelpText());
    },
  },

  "/clear": {
    description: "Clear the screen",
    handler: () => {
      console.clear();
    },
  },

  "/reset": {
    description: "Reset REPL state and clear memory",
    handler: async (state: ReplState) => {
      state.reset();
      // Use memory API for single source of truth
      const memoryApi = (globalThis as Record<string, unknown>).memory as { clear: () => Promise<void> } | undefined;
      if (memoryApi?.clear) {
        await memoryApi.clear();
      }
      console.log(`${GREEN}REPL state reset. All bindings and memory cleared.${RESET}`);
    },
  },

  "/exit": {
    description: "Exit the REPL",
    handler: async (state: ReplState) => {
      console.log("\nGoodbye!");
      await state.flushHistory();
      state.flushHistorySync();
      Deno.exit(0);
    },
  },

  "/memory": {
    description: "Show memory file location and stats",
    handler: async () => {
      // Use memory API for single source of truth
      const memoryApi = (globalThis as Record<string, unknown>).memory as {
        stats: () => Promise<{ path: string; count: number; size: number } | null>;
        list: () => Promise<string[]>;
      } | undefined;

      if (!memoryApi) {
        console.log(`${YELLOW}Memory API not initialized.${RESET}`);
        return;
      }

      const stats = await memoryApi.stats();
      if (stats) {
        console.log(`${BOLD}Memory:${RESET}`);
        console.log(`  ${CYAN}Location:${RESET} ${stats.path}`);
        console.log(`  ${CYAN}Definitions:${RESET} ${stats.count}`);
        console.log(`  ${CYAN}Size:${RESET} ${stats.size} bytes`);
        if (stats.count > 0) {
          const names = await memoryApi.list();
          console.log(`  ${CYAN}Names:${RESET} ${names.join(", ")}`);
        }
      } else {
        console.log(`${YELLOW}Could not read memory file.${RESET}`);
      }
    },
  },

  "/forget": {
    description: "Remove a definition from memory",
    handler: async (_state: ReplState, args: string) => {
      const name = args.trim();
      if (!name) {
        console.log(`${YELLOW}Usage: /forget <name>${RESET}`);
        console.log(`${DIM_GRAY}Example: /forget myFunction${RESET}`);
        return;
      }

      // Use memory API for single source of truth
      const memoryApi = (globalThis as Record<string, unknown>).memory as {
        remove: (name: string) => Promise<boolean>;
      } | undefined;

      if (!memoryApi) {
        console.log(`${YELLOW}Memory API not initialized.${RESET}`);
        return;
      }

      const removed = await memoryApi.remove(name);
      if (removed) {
        console.log(`${GREEN}Removed '${name}' from memory.${RESET}`);
        console.log(`${DIM_GRAY}Note: The binding still exists in this session. Use /reset to clear all bindings.${RESET}`);
      } else {
        console.log(`${YELLOW}'${name}' not found in memory.${RESET}`);
      }
    },
  },

  "/config": {
    description: "View/set configuration",
    handler: async (_state: ReplState, args: string) => {
      await handleConfigCommand(args);
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
export async function runCommand(input: string, state: ReplState): Promise<void> {
  const trimmed = input.trim();
  const [cmdName, ...args] = trimmed.split(WHITESPACE_SPLIT_REGEX);

  const command = commands[cmdName];
  if (command) {
    await command.handler(state, args.join(" "));
  } else {
    console.log(`${YELLOW}Unknown command: ${cmdName}${RESET}`);
    console.log(`${DIM_GRAY}Type /help for available commands.${RESET}`);
  }
}
