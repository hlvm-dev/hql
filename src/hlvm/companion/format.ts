/**
 * Companion Agent — Deterministic Observation Formatter
 *
 * Pure functions, zero LLM calls. Formats raw observations into
 * structured prompts for the main agent.
 */

import type { Observation } from "./types.ts";
import type { CompanionContext } from "./context.ts";

/** Format a batch of observations as bullet-point lines. */
export function formatBatch(batch: Observation[]): string {
  return batch
    .map((o) => `- [${o.kind}] ${o.source}: ${JSON.stringify(o.data)}`)
    .join("\n");
}

/** Build the full observation prompt combining context + raw observations. */
export function formatObservationPrompt(
  batch: Observation[],
  context: CompanionContext,
): string {
  return [
    "[Companion Observation]",
    "",
    context.buildPromptContext(),
    "",
    "## Recent Activity",
    formatBatch(batch),
  ].join("\n");
}
