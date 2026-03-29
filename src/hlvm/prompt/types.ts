/**
 * Prompt Compiler Types
 *
 * Shared type definitions for the prompt compilation pipeline.
 */

import type { ModelTier } from "../agent/constants.ts";
import type { ToolMetadata } from "../agent/registry.ts";
import type { AgentProfile } from "../agent/agent-registry.ts";
import type { ResolvedProviderExecutionPlan } from "../agent/tool-capabilities.ts";
import type { ExecutionSurface } from "../agent/execution-surface.ts";
import type { RuntimeMode } from "../agent/runtime-mode.ts";

/** Prompt assembly mode — determines which sections are included. */
export type PromptMode = "chat" | "agent";

/** A single prompt section with tier gating. */
export interface PromptSection {
  id: string;
  content: string;
  minTier: ModelTier;
}

/** Instruction file hierarchy — global + optional project-level. */
export interface InstructionHierarchy {
  /** Content from ~/.hlvm/HLVM.md */
  global: string;
  /** Content from <workspace>/.hlvm/HLVM.md (empty if untrusted or missing) */
  project: string;
  /** Workspace path if project instructions were attempted */
  projectPath?: string;
  /** Whether the workspace is trusted */
  trusted: boolean;
}

/** Empty instruction hierarchy — use instead of manually constructing `{ global: "", ... }`. */
export const EMPTY_INSTRUCTIONS: InstructionHierarchy = Object.freeze({
  global: "",
  project: "",
  trusted: false,
});

/** Maximum combined character length for merged instructions. */
export const MAX_INSTRUCTION_CHARS = 2000;

/** Display path for the global instructions file (used in observability, not I/O). */
export const GLOBAL_INSTRUCTIONS_DISPLAY_PATH = "~/.hlvm/HLVM.md";

/** Input to the prompt compiler. */
export interface PromptCompilerInput {
  mode: PromptMode;
  tier: ModelTier;
  tools: Record<string, ToolMetadata>;
  instructions: InstructionHierarchy;
  agentProfiles?: readonly AgentProfile[];
  runtimeMode?: RuntimeMode;
  executionSurface?: ExecutionSurface;
  providerExecutionPlan?: ResolvedProviderExecutionPlan;
}

/** Section metadata in the compiled output. */
export interface SectionManifestEntry {
  id: string;
  charCount: number;
}

/** Instruction source metadata for observability. */
export interface InstructionSource {
  path: string;
  trusted: boolean;
  loaded: boolean;
}

/** Output of the prompt compiler. */
export interface CompiledPrompt {
  text: string;
  mode: PromptMode;
  tier: ModelTier;
  sections: SectionManifestEntry[];
  instructionSources: InstructionSource[];
  signatureHash: string;
}
