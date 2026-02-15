import type { Effect, EffectResult } from "./effect-types.ts";

export function joinEffects(a: Effect, b: Effect): Effect {
  return a === "Impure" || b === "Impure" ? "Impure" : "Pure";
}

export function isSubeffect(actual: Effect, required: Effect): boolean {
  if (required === "Impure") return true;
  return actual === "Pure";
}

export function pureResult(): EffectResult {
  return { effect: "Pure" };
}

export function impureResult(
  violation: EffectResult["violation"],
): EffectResult {
  if (!violation) return { effect: "Impure" };
  return { effect: "Impure", violation };
}

export function joinResults(a: EffectResult, b: EffectResult): EffectResult {
  const effect = joinEffects(a.effect, b.effect);
  if (effect === "Pure") return pureResult();
  return impureResult(a.violation ?? b.violation);
}
