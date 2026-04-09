/**
 * Classify Command — lightweight local LLM classification.
 *
 * Calls collectChat() directly: temperature 0, maxTokens 64, no system prompt,
 * no agent loop. Designed for fast structured true/false classification.
 *
 * Usage:
 *   hlvm classify "Is this a visual failure? Error: element not visible"
 */

import { log } from "../../api/log.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";
import { collectChat, extractJson } from "../../runtime/local-llm.ts";

export function showClassifyHelp(): void {
  log.raw.log(`
hlvm classify — Lightweight local LLM classification

Usage:
  hlvm classify "<prompt>"

Calls the local fallback model directly with temperature=0, maxTokens=64.
No agent loop, no tools, no system prompt. Returns raw model output.

Examples:
  hlvm classify "Is this a visual browser failure? Reply {v:true/false}. Error: element not visible"
  hlvm classify "Is this error retryable? Reply {r:true/false}. Error: connection timeout"
`);
}

export async function classifyCommand(args: string[]): Promise<number> {
  if (hasHelpFlag(args) || args.length === 0) {
    showClassifyHelp();
    return 0;
  }

  const prompt = args.join(" ");
  const start = performance.now();

  try {
    const raw = await collectChat(prompt, { temperature: 0, maxTokens: 64 });
    const elapsed = performance.now() - start;
    const json = extractJson(raw);

    log.raw.log(json);
    log.raw.log(`\n${elapsed.toFixed(0)}ms`);
    return 0;
  } catch (error) {
    log.raw.error(`classify failed: ${error}`);
    return 1;
  }
}
