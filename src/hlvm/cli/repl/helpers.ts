/**
 * HLVM REPL Helper Functions
 * Registers global helper functions for REPL commands like (bindings) and (help).
 */

import { ANSI_COLORS } from "../ansi.ts";
import { runCommand } from "./commands.ts";
import type { ReplState } from "./state.ts";
import { bindings } from "../../api/bindings.ts";
import { memory } from "../../api/memory.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import { getGlobalRecord } from "./string-utils.ts";
import { appendExplicitMemoryNote, getExplicitMemoryPath } from "../../memory/mod.ts";

const { GREEN, YELLOW, CYAN, DIM_GRAY, RESET } = ANSI_COLORS;

export function registerReplHelpers(state: ReplState): void {
  const globalAny = getGlobalRecord();

  if (!globalAny.bindings) {
    globalAny.bindings = bindings;
  }
  if (!globalAny.memory) {
    // (memory) opens MEMORY.md in native editor; memory.search/add/etc still work
    const openMemory = async () => {
      const mdPath = getExplicitMemoryPath();
      log.raw.log(`${DIM_GRAY}Opening ${mdPath}${RESET}`);
      await getPlatform().openUrl(mdPath);
    };
    Object.defineProperties(openMemory, Object.getOwnPropertyDescriptors(memory));
    globalAny.memory = openMemory;
  }

  globalAny.unbind = async (name: string) => {
    const bindingsApi = globalAny.bindings as { remove: (key: string) => Promise<boolean> } | undefined;
    if (bindingsApi?.remove) {
      const removed = await bindingsApi.remove(name);
      if (removed) {
        log.raw.log(`${GREEN}Removed '${name}' from bindings.${RESET}`);
        log.raw.log(
          `${DIM_GRAY}Note: The binding still exists in this process until the REPL restarts.${RESET}`,
        );
      } else {
        log.raw.log(`${YELLOW}Binding '${name}' not found.${RESET}`);
      }
    } else {
      log.raw.log(`${YELLOW}Bindings API not ready.${RESET}`);
    }
  };

  globalAny.remember = async (text: string) => {
    if (typeof text !== "string" || text.trim().length === 0) {
      log.raw.log(`${YELLOW}Usage: (remember "some note to save")${RESET}`);
      return;
    }
    try {
      await appendExplicitMemoryNote(text.trim());
      log.raw.log(`${GREEN}Saved to MEMORY.md.${RESET}`);
    } catch (error) {
      log.raw.log(`${YELLOW}Failed to save note: ${getErrorMessage(error)}${RESET}`);
    }
  };

  globalAny.inspect = async (value: unknown) => {
    const type = typeof value;
    const bindingsApi = globalAny.bindings as { get: (name: string) => Promise<string | null> } | undefined;

    if (type === "function") {
      const fn = value as ((...args: unknown[]) => unknown) & { name: string };
      const name = fn.name || "<anonymous>";
      const source = bindingsApi?.get ? await bindingsApi.get(name) : null;

      log.raw.log(`${CYAN}${name}${RESET}: ${DIM_GRAY}function${RESET}`);
      if (source) {
        log.raw.log(`${DIM_GRAY}${source}${RESET}`);
      }
      return { name, type: "function", source };
    }

    if (type === "string") {
      const source = bindingsApi?.get ? await bindingsApi.get(value as string) : null;
      if (source) {
        log.raw.log(`${CYAN}${value}${RESET}:`);
        log.raw.log(`${DIM_GRAY}${source}${RESET}`);
        return { name: value, type: "definition", source };
      }
    }

    log.raw.log(`${CYAN}<value>${RESET}: ${DIM_GRAY}${type}${RESET}`);
    if (value !== null && value !== undefined) {
      try {
        log.raw.log(`${DIM_GRAY}${JSON.stringify(value, null, 2)}${RESET}`);
      } catch {
        log.raw.log(`${DIM_GRAY}[non-serializable]${RESET}`);
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

    const aiApi = globalAny.ai as { chat?: (...args: unknown[]) => AsyncIterable<unknown> } | undefined;
    if (!aiApi?.chat) {
      log.raw.log(`\n${YELLOW}AI not available. Check provider configuration.${RESET}`);
      return { ...info, explanation: null };
    }

    log.raw.log(`\n${CYAN}── AI Explanation ──${RESET}\n`);

    const prompt = `You are explaining an HQL function. HQL is a Lisp-like language that compiles to JavaScript.

Here is the function source code:
${info.source}

Provide:
1. A brief explanation of what this function does (1-2 sentences)
2. 2-3 example usages in HQL syntax

Keep the response concise. Use HQL syntax (parentheses, prefix notation) for examples.`;

    try {
      const messages = [{ role: "user", content: prompt }];
      const response = aiApi.chat(messages);

      const encoder = new TextEncoder();
      let explanation = "";
      for await (const chunk of response) {
        if (typeof chunk === "string") {
          getPlatform().terminal.stdout.writeSync(encoder.encode(chunk));
          explanation += chunk;
        }
      }
      log.raw.log();
      return { ...info, explanation };
    } catch (error) {
      const errMsg = getErrorMessage(error);
      log.raw.log(`${YELLOW}AI error: ${errMsg}${RESET}`);
      return { ...info, explanation: null };
    }
  };

  globalAny.help = () => {
    runCommand("/help", state);
    return null;
  };

  globalAny.exit = () => {
    log.raw.log("\nGoodbye!");
    getPlatform().process.exit(0);
  };

  const helperNames = ["bindings", "unbind", "remember", "memory", "inspect", "describe", "help", "exit"];
  for (const name of helperNames) {
    const fn = globalAny[name];
    if (typeof fn === "function") {
      state.addJsFunction(name, fn as (...args: unknown[]) => unknown);
    } else {
      state.addBinding(name);
    }
  }
}
