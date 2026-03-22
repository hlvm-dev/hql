/**
 * Prompt Compiler — single entry point for prompt assembly.
 *
 * Pure function: no I/O, no side effects.
 * Collects sections, filters by tier, joins, and produces metadata.
 */

import { tierMeetsMinimum } from "../agent/constants.ts";
import { fnv1aHex } from "../../common/hash.ts";
import { collectSections } from "./sections.ts";
import {
  GLOBAL_INSTRUCTIONS_DISPLAY_PATH,
  type CompiledPrompt,
  type InstructionSource,
  type PromptCompilerInput,
  type SectionManifestEntry,
} from "./types.ts";

/**
 * Compile a prompt from structured input.
 *
 * 1. Collects sections for the given mode
 * 2. Filters by tier
 * 3. Joins into final text
 * 4. Builds section manifest + instruction sources + signature hash
 */
export function compilePrompt(input: PromptCompilerInput): CompiledPrompt {
  const allSections = collectSections(input);
  const filtered = allSections.filter(
    (s) => s.content && tierMeetsMinimum(input.tier, s.minTier),
  );

  const text = filtered.map((s) => s.content).join("\n\n");

  const sections: SectionManifestEntry[] = filtered.map((s) => ({
    id: s.id,
    charCount: s.content.length,
  }));

  // Build instruction source manifest for observability.
  // Record any source that was attempted, even if the file was missing.
  const instructionSources: InstructionSource[] = [];
  const hasGlobal = input.instructions.global.length > 0;
  const hasProjectPath = !!input.instructions.projectPath;
  if (hasGlobal || hasProjectPath) {
    instructionSources.push({
      path: GLOBAL_INSTRUCTIONS_DISPLAY_PATH,
      trusted: true,
      loaded: hasGlobal,
    });
  }
  if (hasProjectPath) {
    instructionSources.push({
      path: input.instructions.projectPath!,
      trusted: input.instructions.trusted,
      loaded: input.instructions.project.length > 0 &&
        input.instructions.trusted,
    });
  }

  const signatureHash = `${input.mode}:${input.tier}:${
    fnv1aHex(`${input.mode}:${input.tier}:${text}`)
  }`;

  return {
    text,
    mode: input.mode,
    tier: input.tier,
    sections,
    instructionSources,
    signatureHash,
  };
}
