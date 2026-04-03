/**
 * LLM Integration - System prompt generation and tool schema building
 *
 * Provides:
 * - System prompt generation from tool registry (tier-filtered)
 * - Tool definition building with caching
 *
 * SSOT-compliant: Uses existing platform abstraction
 */

import {
  getToolRegistryGeneration,
  resolveTools,
  type ToolMetadata,
} from "./registry.ts";
import type { AgentProfile } from "./agent-registry.ts";
import {
  normalizeWebCapabilitySelectors,
  projectPromptToolsForWebCapabilities,
  type ResolvedProviderExecutionPlan,
} from "./tool-capabilities.ts";
import {
  projectNamedToolMapForExecutionSurface,
  type ExecutionSurface,
} from "./execution-surface.ts";
import { buildToolJsonSchema } from "./tool-schema.ts";
import type { ModelTier } from "./constants.ts";
import type { RuntimeMode } from "./runtime-mode.ts";
import {
  type CompiledPrompt,
  compilePrompt,
  EMPTY_INSTRUCTIONS,
  type InstructionHierarchy,
} from "../prompt/mod.ts";

/** Tool definition for native function calling */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

// ============================================================
// Tool Schema + Native Tool Calling
// ============================================================

/**
 * Create a tool definition cache with encapsulated state.
 * Avoids module-level mutable state that could leak between runs.
 */
function createToolDefCache(): {
  build: (
    options?: { allowlist?: string[]; denylist?: string[]; ownerId?: string },
  ) => ToolDefinition[];
  clear: () => void;
} {
  let cached:
    | { key: string; defs: ToolDefinition[]; generation: number }
    | null = null;

  return {
    build(
      options?: { allowlist?: string[]; denylist?: string[]; ownerId?: string },
    ): ToolDefinition[] {
      const generation = getToolRegistryGeneration();
      const cacheKey = JSON.stringify([
        options?.allowlist ?? null,
        options?.denylist ?? null,
        options?.ownerId ?? null,
      ]);
      if (
        cached && cached.key === cacheKey && cached.generation === generation
      ) {
        return cached.defs;
      }

      const tools = resolveTools(options);
      const defs: ToolDefinition[] = Object.entries(tools).map(
        ([name, meta]) => {
          const parameters = meta.skipValidation
            ? { type: "object", properties: {}, additionalProperties: true }
            : buildToolJsonSchema(meta);

          return {
            type: "function" as const,
            function: {
              name,
              description: meta.description,
              parameters: parameters as Record<string, unknown>,
            },
          };
        },
      );
      cached = { key: cacheKey, defs, generation };
      return defs;
    },
    clear() {
      cached = null;
    },
  };
}

const toolDefCache = createToolDefCache();

/** Clear cached tool definitions (call when registry changes or at session start) */
export function clearToolDefCache(): void {
  toolDefCache.clear();
}

/** Build tool definitions with caching */
export function buildToolDefinitions(
  options?: { allowlist?: string[]; denylist?: string[]; ownerId?: string },
): ToolDefinition[] {
  return toolDefCache.build(options);
}

// ============================================================
// System Prompt Generation (backward-compat wrapper)
// ============================================================

/**
 * Generate system prompt from tool registry.
 *
 * Backward-compatible wrapper around `compilePrompt()`.
 * Callers (delegation, tests) see zero change.
 */
export interface SystemPromptOptions {
  toolAllowlist?: string[];
  toolDenylist?: string[];
  toolOwnerId?: string;
  querySource?: string;
  /** Model tier — controls prompt depth */
  modelTier?: ModelTier;
  /** Preloaded agent profiles for delegation guidance. */
  agentProfiles?: readonly AgentProfile[];
  /** Session runtime mode for prompt behavior. */
  runtimeMode?: RuntimeMode;
  /** Generic execution surface for capability-oriented guidance. */
  executionSurface?: ExecutionSurface;
  /** Session-resolved provider execution plan for prompt projection. */
  providerExecutionPlan?: ResolvedProviderExecutionPlan;
  /** Full instruction hierarchy (overrides customInstructions when provided). */
  instructions?: InstructionHierarchy;
}

/**
 * Compile a system prompt and return full metadata.
 * Use this when you need the compiled prompt metadata (sections, hash, sources).
 */
export function compileSystemPrompt(
  options: SystemPromptOptions = {},
): CompiledPrompt {
  const tier = options.modelTier ?? "mid";
  const providerExecutionPlan = options.providerExecutionPlan;
  const resolvedTools = resolveTools({
    allowlist: normalizeWebCapabilitySelectors(options.toolAllowlist),
    denylist: normalizeWebCapabilitySelectors(options.toolDenylist),
    ownerId: options.toolOwnerId,
  });
  const projectedTools = projectNamedToolMapForExecutionSurface(
    projectPromptToolsForWebCapabilities(
      resolvedTools,
      providerExecutionPlan,
    ),
    options.executionSurface,
  );
  const tools = { ...projectedTools };
  if (options.executionSurface?.runtimeMode === "auto") {
    for (const route of Object.values(options.executionSurface.capabilities)) {
      const selectedToolName = route.selectedToolName;
      if (!selectedToolName || selectedToolName in tools) continue;
      const selectedTool = resolvedTools[selectedToolName];
      if (selectedTool) {
        tools[selectedToolName] = selectedTool;
      }
    }
  }

  const instructions: InstructionHierarchy = options.instructions ??
    EMPTY_INSTRUCTIONS;

  return compilePrompt({
    mode: "agent",
    tier,
    tools,
    instructions,
    agentProfiles: options.agentProfiles,
    runtimeMode: options.runtimeMode,
    querySource: options.querySource,
    executionSurface: options.executionSurface,
    providerExecutionPlan,
  });
}

/**
 * Generate system prompt text from tool registry.
 * Backward-compatible wrapper — returns only the text string.
 */
export function generateSystemPrompt(
  options: SystemPromptOptions = {},
): string {
  return compileSystemPrompt(options).text;
}
