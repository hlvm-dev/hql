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
  type PromptCacheSegment,
  type PromptCompilerInput,
  type PromptSection,
  type PromptSectionStability,
  type PromptStableCacheProfile,
  type SectionManifestEntry,
} from "./types.ts";

const STABILITY_ORDER: Record<PromptSectionStability, number> = {
  static: 0,
  session: 1,
  turn: 2,
};

function buildSectionContentHash(content: string): string {
  return fnv1aHex(content);
}

function orderSections(
  sections: PromptSection[],
): PromptSection[] {
  return sections
    .map((section, index) => ({ section, index }))
    .sort((left, right) => {
      const stabilityDelta =
        STABILITY_ORDER[left.section.stability] -
        STABILITY_ORDER[right.section.stability];
      return stabilityDelta !== 0 ? stabilityDelta : left.index - right.index;
    })
    .map(({ section }) => section);
}

function buildCacheSegments(filtered: PromptSection[]): PromptCacheSegment[] {
  const segments: PromptCacheSegment[] = [];
  let current: PromptSection[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const stability = current[0].stability;
    const text = current.map((section) => section.content).join("\n\n");
    segments.push({
      id: `${stability}:${segments.length}`,
      stability,
      sectionIds: current.map((section) => section.id),
      charCount: text.length,
      contentHash: buildSectionContentHash(text),
      text,
    });
    current = [];
  };

  for (const section of filtered) {
    if (
      current.length > 0 &&
      current[0].stability !== section.stability
    ) {
      flush();
    }
    current.push(section);
  }
  flush();

  return segments;
}

function buildStableCacheProfile(
  cacheSegments: readonly PromptCacheSegment[],
): PromptStableCacheProfile {
  const stableSegmentHashes = cacheSegments
    .filter((segment) => segment.stability !== "turn")
    .map((segment) => segment.contentHash);

  return {
    stableSegmentCount: stableSegmentHashes.length,
    stableSegmentHashes,
    stableSignatureHash: fnv1aHex(stableSegmentHashes.join("\n")),
  };
}

/**
 * Compile a prompt from structured input.
 *
 * 1. Collects sections for the given mode
 * 2. Filters by tier
 * 3. Joins into final text
 * 4. Builds section manifest + instruction sources + signature hash
 */
export function compilePrompt(input: PromptCompilerInput): CompiledPrompt {
  const filtered = orderSections(collectSections(input).filter(
    (s) => s.content && tierMeetsMinimum(input.tier, s.minTier),
  ));

  const text = filtered.map((s) => s.content).join("\n\n");

  const sections: SectionManifestEntry[] = filtered.map((s) => ({
    id: s.id,
    charCount: s.content.length,
    stability: s.stability,
    contentHash: buildSectionContentHash(s.content),
    cacheEligible: s.stability !== "turn",
  }));
  const cacheSegments = buildCacheSegments(filtered);
  const stableCacheProfile = buildStableCacheProfile(cacheSegments);

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
    querySource: input.querySource,
    sections,
    cacheSegments,
    stableCacheProfile,
    instructionSources,
    signatureHash,
  };
}
