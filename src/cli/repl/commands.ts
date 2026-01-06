/**
 * HQL REPL Commands
 * Handles dot-prefixed commands like .help, .clear, .reset
 */

import { ANSI_COLORS } from "../ansi.ts";
import type { ReplState } from "./state.ts";
import { getMemoryStats, forgetFromMemory, compactMemory, getMemoryNames } from "./memory.ts";

const { CYAN, GREEN, YELLOW, DIM_GRAY, RESET, BOLD } = ANSI_COLORS;

export interface Command {
  description: string;
  handler: (state: ReplState, args: string) => void | Promise<void>;
}

const helpText = `
${BOLD}HQL REPL Functions:${RESET}

  ${CYAN}(memory)${RESET}         List all saved definitions
  ${CYAN}(forget "x")${RESET}     Remove definition from memory
  ${CYAN}(inspect x)${RESET}      Show source code (fast, no AI)
  ${CYAN}(describe x)${RESET}     Source + AI explanation & examples
  ${CYAN}(help)${RESET}           Show this help
  ${CYAN}(exit)${RESET}           Exit the REPL
  ${CYAN}(clear)${RESET}          Clear the screen

${BOLD}Memory (auto-persist def/defn):${RESET}

  Definitions are automatically saved to ~/.hql/memory.hql
  They persist across sessions. No explicit save needed.

${BOLD}Dot Commands (aliases):${RESET}

  ${DIM_GRAY}.help .clear .reset .bindings .history .exit${RESET}
  ${DIM_GRAY}.memory .forget .compact${RESET}

${BOLD}Keyboard Shortcuts:${RESET}

  ${YELLOW}Tab${RESET}        Complete / cycle forward through options
  ${YELLOW}Shift+Tab${RESET}  Cycle backward through options
  ${YELLOW}Up/Down${RESET}    Navigate history
  ${YELLOW}→ / End${RESET}    Accept ghost suggestion
  ${YELLOW}Ctrl+C${RESET}     Cancel current input (twice to exit)
  ${YELLOW}Ctrl+D${RESET}     Exit REPL
  ${YELLOW}Ctrl+A${RESET}     Jump to start of line
  ${YELLOW}Ctrl+E${RESET}     Jump to end of line
  ${YELLOW}Ctrl+U${RESET}     Delete to start of line
  ${YELLOW}Ctrl+K${RESET}     Delete to end of line
  ${YELLOW}Ctrl+W${RESET}     Delete word backward
  ${YELLOW}Ctrl+L${RESET}     Clear screen

${BOLD}Examples:${RESET}

  ${DIM_GRAY}; Define a persistent value${RESET}
  ${GREEN}(def name "seoksoon")${RESET}

  ${DIM_GRAY}; Define a persistent function${RESET}
  ${GREEN}(defn greet [name] (str "Hello, " name "!"))${RESET}

  ${DIM_GRAY}; Use AI (requires embedded @hql/ai)${RESET}
  ${GREEN}(import [ask] from "@hql/ai")${RESET}
  ${GREEN}(await (ask "What is 2+2?"))${RESET}
`;

export const commands: Record<string, Command> = {
  ".help": {
    description: "Show help message",
    handler: () => {
      console.log(helpText);
    },
  },

  ".clear": {
    description: "Clear the screen",
    handler: () => {
      console.clear();
    },
  },

  ".reset": {
    description: "Reset REPL state",
    handler: (state: ReplState) => {
      state.reset();
      console.log(`${GREEN}REPL state reset. All bindings cleared.${RESET}`);
    },
  },

  ".bindings": {
    description: "Show all bound names",
    handler: (state: ReplState) => {
      const bindings = state.getBindings();
      if (bindings.length === 0) {
        console.log(`${DIM_GRAY}No bindings defined.${RESET}`);
      } else {
        console.log(`${BOLD}Bindings:${RESET}`);
        for (const name of bindings) {
          const value = (globalThis as Record<string, unknown>)[name];
          const type = typeof value;
          console.log(`  ${CYAN}${name}${RESET} : ${DIM_GRAY}${type}${RESET}`);
        }
      }
    },
  },

  ".history": {
    description: "Show command history",
    handler: (state: ReplState) => {
      const history = state.history;
      if (history.length === 0) {
        console.log(`${DIM_GRAY}No history.${RESET}`);
      } else {
        console.log(`${BOLD}History:${RESET}`);
        const start = Math.max(0, history.length - 20);
        for (let i = start; i < history.length; i++) {
          console.log(`  ${DIM_GRAY}${i + 1}:${RESET} ${history[i]}`);
        }
      }
    },
  },

  ".exit": {
    description: "Exit the REPL",
    handler: () => {
      console.log("\nGoodbye!");
      Deno.exit(0);
    },
  },

  ".memory": {
    description: "Show memory file location and stats",
    handler: async () => {
      const stats = await getMemoryStats();
      if (stats) {
        console.log(`${BOLD}Memory:${RESET}`);
        console.log(`  ${CYAN}Location:${RESET} ${stats.path}`);
        console.log(`  ${CYAN}Definitions:${RESET} ${stats.count}`);
        console.log(`  ${CYAN}Size:${RESET} ${stats.size} bytes`);
        if (stats.count > 0) {
          const names = await getMemoryNames();
          console.log(`  ${CYAN}Names:${RESET} ${names.join(", ")}`);
        }
      } else {
        console.log(`${YELLOW}Could not read memory file.${RESET}`);
      }
    },
  },

  ".forget": {
    description: "Remove a definition from memory",
    handler: async (_state: ReplState, args: string) => {
      const name = args.trim();
      if (!name) {
        console.log(`${YELLOW}Usage: .forget <name>${RESET}`);
        console.log(`${DIM_GRAY}Example: .forget myFunction${RESET}`);
        return;
      }

      const removed = await forgetFromMemory(name);
      if (removed) {
        console.log(`${GREEN}Removed '${name}' from memory.${RESET}`);
        console.log(`${DIM_GRAY}Note: The binding still exists in this session. Use .reset to clear all bindings.${RESET}`);
      } else {
        console.log(`${YELLOW}'${name}' not found in memory.${RESET}`);
      }
    },
  },

  ".compact": {
    description: "Manually trigger memory compaction",
    handler: async () => {
      const result = await compactMemory();
      if (result.before === result.after) {
        console.log(`${DIM_GRAY}Memory already compact (${result.after} definitions).${RESET}`);
      } else {
        console.log(`${GREEN}Compacted memory: ${result.before} → ${result.after} definitions.${RESET}`);
      }
    },
  },
};

/** Check if input is a command */
export function isCommand(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.startsWith(".") && !trimmed.startsWith("..");
}

/** Run a command */
export async function runCommand(input: string, state: ReplState): Promise<void> {
  const trimmed = input.trim();
  const [cmdName, ...args] = trimmed.split(/\s+/);

  const command = commands[cmdName];
  if (command) {
    await command.handler(state, args.join(" "));
  } else {
    console.log(`${YELLOW}Unknown command: ${cmdName}${RESET}`);
    console.log(`${DIM_GRAY}Type .help for available commands.${RESET}`);
  }
}
