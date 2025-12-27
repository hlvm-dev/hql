/**
 * HQL REPL Commands
 * Handles dot-prefixed commands like .help, .clear, .reset
 */

import { ANSI_COLORS } from "../ansi.ts";
import type { ReplState } from "./state.ts";

const { CYAN, GREEN, YELLOW, DIM_GRAY, RESET, BOLD } = ANSI_COLORS;

export interface Command {
  description: string;
  handler: (state: ReplState, args: string) => void | Promise<void>;
}

const helpText = `
${BOLD}HQL REPL Commands:${RESET}

  ${CYAN}.help${RESET}      Show this help message
  ${CYAN}.clear${RESET}     Clear the screen
  ${CYAN}.reset${RESET}     Reset REPL state (clear all bindings)
  ${CYAN}.bindings${RESET}  Show all bound names
  ${CYAN}.history${RESET}   Show command history
  ${CYAN}.exit${RESET}      Exit the REPL (or use Ctrl+D)

${BOLD}Keyboard Shortcuts:${RESET}

  ${YELLOW}Up/Down${RESET}    Navigate history
  ${YELLOW}Ctrl+C${RESET}     Cancel current input (twice to exit)
  ${YELLOW}Ctrl+D${RESET}     Exit REPL
  ${YELLOW}Ctrl+A${RESET}     Jump to start of line
  ${YELLOW}Ctrl+E${RESET}     Jump to end of line
  ${YELLOW}Ctrl+U${RESET}     Delete to start of line
  ${YELLOW}Ctrl+K${RESET}     Delete to end of line
  ${YELLOW}Ctrl+W${RESET}     Delete word backward

${BOLD}Examples:${RESET}

  ${DIM_GRAY}; Basic math${RESET}
  ${GREEN}(+ 1 2 3)${RESET}

  ${DIM_GRAY}; Define a function${RESET}
  ${GREEN}(fn greet [name] (str "Hello, " name "!"))${RESET}

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
