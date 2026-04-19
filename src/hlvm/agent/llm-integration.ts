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
  TOOL_REGISTRY,
} from "./registry.ts";
import type { AgentProfile } from "./agent-registry.ts";
import { buildToolJsonSchema } from "./tool-schema.ts";
import type { ModelCapabilityClass } from "./constants.ts";
import {
  type CompiledPrompt,
  compilePrompt,
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
    options?: {
      allowlist?: string[];
      denylist?: string[];
      ownerId?: string;
      workspace?: string;
    },
  ) => Promise<ToolDefinition[]>;
  clear: () => void;
} {
  let cached:
    | { key: string; defs: ToolDefinition[]; generation: number }
    | null = null;

  return {
    async build(
      options?: {
        allowlist?: string[];
        denylist?: string[];
        ownerId?: string;
        workspace?: string;
      },
    ): Promise<ToolDefinition[]> {
      const generation = getToolRegistryGeneration();
      const cacheKey = JSON.stringify([
        options?.allowlist ?? null,
        options?.denylist ?? null,
        options?.ownerId ?? null,
        options?.workspace ?? null,
      ]);
      if (
        cached && cached.key === cacheKey && cached.generation === generation
      ) {
        return cached.defs;
      }

      const tools = resolveTools(options);
      // Partition-sort: built-ins as stable sorted prefix, dynamic tools as sorted suffix.
      // Deterministic ordering prevents prompt cache invalidation across turns/restarts.
      const entries = Object.entries(tools);
      const builtIn = entries.filter(([n]) => n in TOOL_REGISTRY).sort(([a], [b]) => a.localeCompare(b));
      const dynamic = entries.filter(([n]) => !(n in TOOL_REGISTRY)).sort(([a], [b]) => a.localeCompare(b));
      const defs: ToolDefinition[] = await Promise.all(
        [...builtIn, ...dynamic].map(async ([name, meta]) => {
          const parameters = meta.skipValidation
            ? { type: "object", properties: {}, additionalProperties: true }
            : buildToolJsonSchema(meta);

          const description = meta.resolveDescription
            ? await meta.resolveDescription({
              workspace: options?.workspace,
              ownerId: options?.ownerId,
            })
            : meta.description;

          return {
            type: "function" as const,
            function: {
              name,
              description,
              parameters: parameters as Record<string, unknown>,
            },
          };
        }),
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
export async function buildToolDefinitions(
  options?: {
    allowlist?: string[];
    denylist?: string[];
    ownerId?: string;
    workspace?: string;
  },
): Promise<ToolDefinition[]> {
  return toolDefCache.build(options);
}

// ============================================================
// System Prompt Generation (backward-compat wrapper)
// ============================================================

/**
 * Generate system prompt from tool registry.
 *
 * Backward-compatible wrapper around `compilePrompt()`.
 * Callers (agent-runner, tests) see zero change.
 */
export interface SystemPromptOptions {
  toolAllowlist?: string[];
  toolDenylist?: string[];
  toolOwnerId?: string;
  querySource?: string;
  /** Model capability class — controls prompt depth */
  modelCapability?: ModelCapabilityClass;
  /** Preloaded agent profiles for child agent guidance. */
  agentProfiles?: readonly AgentProfile[];
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
  const capability = options.modelCapability ?? "agent";
  const tools = resolveTools({
    allowlist: options.toolAllowlist,
    denylist: options.toolDenylist,
    ownerId: options.toolOwnerId,
  });

  return compilePrompt({
    mode: "agent",
    capability,
    tools,
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
