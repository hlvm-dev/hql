/**
 * Prompt Compiler Types
 *
 * Shared type definitions for the prompt compilation pipeline.
 */

import type { ModelCapabilityClass } from "../agent/constants.ts";
import type { ToolMetadata } from "../agent/registry.ts";
import type { AgentProfile } from "../agent/agent-registry.ts";

/** Prompt assembly mode — determines which sections are included. */
export type PromptMode = "chat" | "agent";

/** Prompt section stability — determines cache invalidation boundaries. */
export type PromptSectionStability = "static" | "session" | "turn";

/** A single prompt section with capability-class gating. */
export interface PromptSection {
  id: string;
  content: string;
  minCapability: ModelCapabilityClass;
  stability: PromptSectionStability;
}

/** Input to the prompt compiler. */
export interface PromptCompilerInput {
  mode: PromptMode;
  capability: ModelCapabilityClass;
  tools: Record<string, ToolMetadata>;
  agentProfiles?: readonly AgentProfile[];
  querySource?: string;
  visionCapable?: boolean;
}

/** Section metadata in the compiled output. */
export interface SectionManifestEntry {
  id: string;
  charCount: number;
  stability: PromptSectionStability;
  contentHash: string;
  cacheEligible: boolean;
}

/** Cache-aware contiguous prompt segment built from filtered sections. */
export interface PromptCacheSegment {
  id: string;
  stability: PromptSectionStability;
  sectionIds: string[];
  charCount: number;
  contentHash: string;
  text: string;
}

/** Precomputed stable-cache metadata derived from cache-eligible segments. */
export interface PromptStableCacheProfile {
  stableSegmentCount: number;
  stableSegmentHashes: string[];
  stableSignatureHash: string;
}

/** Output of the prompt compiler. */
export interface CompiledPrompt {
  text: string;
  mode: PromptMode;
  capability: ModelCapabilityClass;
  querySource?: string;
  sections: SectionManifestEntry[];
  cacheSegments: PromptCacheSegment[];
  stableCacheProfile: PromptStableCacheProfile;
  signatureHash: string;
}
