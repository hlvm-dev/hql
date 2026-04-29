import { djb2Hash } from "../../utils/hash.ts";

const CC_SPINNER_VERBS = [
  "Analyzing",
  "Checking",
  "Composing",
  "Connecting",
  "Inspecting",
  "Planning",
  "Processing",
  "Reading",
  "Reasoning",
  "Reviewing",
  "Searching",
  "Synthesizing",
  "Thinking",
  "Tracing",
  "Verifying",
  "Working",
] as const;

const CC_TURN_COMPLETION_VERBS = [
  "Worked",
] as const;

function pickStableValue<T extends string>(
  items: readonly T[],
  seed: string,
  fallback: T,
): T {
  if (items.length === 0) return fallback;
  const index = Math.abs(djb2Hash(seed)) % items.length;
  return items[index] ?? fallback;
}

export function getCcSpinnerVerb(seed: string): string {
  return pickStableValue(CC_SPINNER_VERBS, seed, "Thinking");
}

export function getCcTurnCompletionVerb(seed: string): string {
  return pickStableValue(CC_TURN_COMPLETION_VERBS, seed, "Worked");
}
