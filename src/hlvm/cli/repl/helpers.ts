/**
 * HLVM REPL Helper Functions
 * Registers global helper functions for REPL commands like (memory) and (help).
 */

import { ANSI_COLORS } from "../ansi.ts";
import { runCommand } from "./commands.ts";
import type { ReplState } from "./state.ts";
import { memory } from "../../api/memory.ts";

const { GREEN, YELLOW, CYAN, DIM_GRAY, RESET } = ANSI_COLORS;

export function registerReplHelpers(state: ReplState): void {
  const globalAny = globalThis as unknown as Record<string, unknown>;

  if (!globalAny.memory) {
    globalAny.memory = memory;
  }

  globalAny.forget = async (name: string) => {
    const memoryApi = globalAny.memory as { remove: (key: string) => Promise<boolean> } | undefined;
    if (memoryApi?.remove) {
      const removed = await memoryApi.remove(name);
      if (removed) {
        console.log(`${GREEN}Removed '${name}' from memory.${RESET}`);
      } else {
        console.log(`${YELLOW}Binding '${name}' not found in memory.${RESET}`);
      }
    } else {
      console.log(`${YELLOW}Memory API not ready.${RESET}`);
    }
  };

  globalAny.inspect = async (value: unknown) => {
    const type = typeof value;
    const memoryApi = globalAny.memory as { get: (name: string) => Promise<string | null> } | undefined;

    if (type === "function") {
      const fn = value as ((...args: unknown[]) => unknown) & { name: string };
      const name = fn.name || "<anonymous>";
      const source = memoryApi?.get ? await memoryApi.get(name) : null;

      console.log(`${CYAN}${name}${RESET}: ${DIM_GRAY}function${RESET}`);
      if (source) {
        console.log(`${DIM_GRAY}${source}${RESET}`);
      }
      return { name, type: "function", source };
    }

    if (type === "string") {
      const source = memoryApi?.get ? await memoryApi.get(value as string) : null;
      if (source) {
        console.log(`${CYAN}${value}${RESET}:`);
        console.log(`${DIM_GRAY}${source}${RESET}`);
        return { name: value, type: "definition", source };
      }
    }

    console.log(`${CYAN}<value>${RESET}: ${DIM_GRAY}${type}${RESET}`);
    if (value !== null && value !== undefined) {
      try {
        console.log(`${DIM_GRAY}${JSON.stringify(value, null, 2)}${RESET}`);
      } catch {
        console.log(`${DIM_GRAY}[non-serializable]${RESET}`);
      }
    }
    return { name: null, type, source: null };
  };

  globalAny.describe = async (value: unknown) => {
    const inspectFn = globalAny.inspect as (v: unknown) => Promise<{ name: string | null; type: string; source?: string | null }>;
    const info = await inspectFn(value);

    if (!info.source) {
      return { ...info, explanation: null };
    }

    const ask = globalAny.ask as ((prompt: string) => Promise<unknown>) | undefined;
    if (typeof ask !== "function") {
      console.log(`\n${YELLOW}AI not available. Check @hlvm/ai installation and API key.${RESET}`);
      return { ...info, explanation: null };
    }

    console.log(`\n${CYAN}── AI Explanation ──${RESET}\n`);

    const prompt = `You are explaining an HQL function. HQL is a Lisp-like language that compiles to JavaScript.

Here is the function source code:
${info.source}

Provide:
1. A brief explanation of what this function does (1-2 sentences)
2. 2-3 example usages in HQL syntax

Keep the response concise. Use HQL syntax (parentheses, prefix notation) for examples.`;

    try {
      const response = await ask(prompt);

      if (response && typeof (response as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
        const encoder = new TextEncoder();
        let explanation = "";
        for await (const chunk of response as AsyncIterable<unknown>) {
          if (typeof chunk === "string") {
            Deno.stdout.writeSync(encoder.encode(chunk));
            explanation += chunk;
          }
        }
        console.log();
        return { ...info, explanation };
      } else if (typeof response === "string") {
        console.log(response);
        return { ...info, explanation: response };
      } else {
        console.log(String(response));
        return { ...info, explanation: String(response) };
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.log(`${YELLOW}AI error: ${errMsg}${RESET}`);
      return { ...info, explanation: null };
    }
  };

  globalAny.help = () => {
    runCommand("/help", state);
    return null;
  };

  globalAny.exit = () => {
    console.log("\nGoodbye!");
    Deno.exit(0);
  };

  globalAny.clear = () => {
    console.clear();
    return null;
  };

  const helperNames = ["memory", "forget", "inspect", "describe", "help", "exit", "clear"];
  for (const name of helperNames) {
    const fn = globalAny[name];
    if (typeof fn === "function") {
      state.addJsFunction(name, fn as (...args: unknown[]) => unknown);
    } else {
      state.addBinding(name);
    }
  }
}
