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
} from "./registry.ts";
import type { AgentProfile } from "./agent-registry.ts";
import { buildToolJsonSchema } from "./tool-schema.ts";
import type { ModelTier } from "./constants.ts";
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
  /** Full instruction hierarchy (overrides customInstructions when provided). */
  instructions?: InstructionHierarchy;
  /** Whether the active model supports vision inputs. */
  visionCapable?: boolean;
}

/**
 * Compile a system prompt and return full metadata.
 * Use this when you need the compiled prompt metadata (sections, hash, sources).
 */
export function compileSystemPrompt(
  options: SystemPromptOptions = {},
): CompiledPrompt {
  const tier = options.modelTier ?? "mid";
  const tools = resolveTools({
    allowlist: options.toolAllowlist,
    denylist: options.toolDenylist,
    ownerId: options.toolOwnerId,
  });

  const instructions: InstructionHierarchy = options.instructions ??
    EMPTY_INSTRUCTIONS;

  return compilePrompt({
    mode: "agent",
    tier,
    tools,
    instructions,
    agentProfiles: options.agentProfiles,
    querySource: options.querySource,
    visionCapable: options.visionCapable,
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
