/**
 * Companion Agent — Observation Gate
 *
 * Uses a cheap/fast LLM for binary SILENT/NOTIFY classification.
 * No LLM configured or any error → always SILENT.
 */

import type { GateResult, Observation } from "./types.ts";
import type { CompanionContext } from "./context.ts";
import type { LLMFunction } from "../agent/orchestrator-llm.ts";
import type { Message } from "../agent/context.ts";
import { withRetry } from "../../common/retry.ts";
import { log } from "../api/log.ts";

const GATE_SYSTEM_PROMPT =
  `You are a silent observer. Your default response is SILENT.
Say NOTIFY only when there is a clear, unmistakable opportunity to help the user — for example, they copied an error message, switched to a docs page repeatedly, or a build/test failed.
Respond with exactly one line: SILENT or NOTIFY <brief reason>`;

export async function gateObservations(
  batch: Observation[],
  context: CompanionContext,
  llm?: LLMFunction,
  signal?: AbortSignal,
): Promise<GateResult> {
  if (!llm) return { decision: "SILENT", reason: "" };

  try {
    const userContent = `${context.buildPromptContext()}\n\n## Recent Observations\n${formatBatch(batch)}`;
    const messages: Message[] = [
      { role: "system", content: GATE_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ];

    const response = await withRetry(
      () => llm(messages, signal),
      { maxAttempts: 2, initialDelayMs: 500 },
    );

    const text = response.content.trim();
    if (text.startsWith("NOTIFY")) {
      const reason = text.slice(6).trim();
      return { decision: "NOTIFY", reason };
    }
    return { decision: "SILENT", reason: "" };
  } catch (err) {
    log.debug("[companion] gate error, defaulting to SILENT", err);
    return { decision: "SILENT", reason: "" };
  }
}

/** Format a batch of observations for LLM prompt injection. */
export function formatBatch(batch: Observation[]): string {
  return batch
    .map((o) => `- [${o.kind}] ${o.source}: ${JSON.stringify(o.data)}`)
    .join("\n");
}
