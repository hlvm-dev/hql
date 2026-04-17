/**
 * Agent Tool Utilities
 *
 * CC-faithful implementation of tool resolution and filtering.
 * CC source: tools/AgentTool/agentToolUtils.ts
 *
 * Key algorithms:
 * - filterToolsForAgent(): baseline filtering via disallow lists
 * - resolveAgentTools(): resolve agent's tool spec against available tools
 */

import type { ToolMetadata } from "../registry.ts";
import type { AgentDefinition } from "./agent-types.ts";
import {
  ALL_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
} from "./agent-constants.ts";
import { isBuiltInAgent } from "./agent-types.ts";

// ============================================================
// Types
// ============================================================

export interface ResolvedAgentTools {
  hasWildcard: boolean;
  validTools: string[];
  invalidTools: string[];
  resolvedTools: Map<string, ToolMetadata>;
}

// ============================================================
// filterToolsForAgent (CC: agentToolUtils.ts lines 70-116)
// ============================================================

/**
 * Baseline tool filtering for sub-agents.
 * Applies universal and source-specific disallow lists.
 *
 * CC logic exactly:
 * 1. Allow all MCP tools (mcp__ prefix)
 * 2. Block ALL_AGENT_DISALLOWED_TOOLS (universal)
 * 3. Block CUSTOM_AGENT_DISALLOWED_TOOLS for non-built-in agents
 * 4. For async agents, only allow ASYNC_AGENT_ALLOWED_TOOLS
 */
export function filterToolsForAgent(opts: {
  tools: Record<string, ToolMetadata>;
  isBuiltIn: boolean;
  isAsync?: boolean;
}): Record<string, ToolMetadata> {
  const { tools, isBuiltIn, isAsync = false } = opts;
  const filtered: Record<string, ToolMetadata> = {};

  for (const [name, meta] of Object.entries(tools)) {
    // Rule 1: Allow MCP tools
    if (name.startsWith("mcp__")) {
      filtered[name] = meta;
      continue;
    }

    // Rule 2: Block universal disallow list
    if (ALL_AGENT_DISALLOWED_TOOLS.has(name)) {
      continue;
    }

    // Rule 3: Block custom agent disallow list for non-built-in
    if (!isBuiltIn && CUSTOM_AGENT_DISALLOWED_TOOLS.has(name)) {
      continue;
    }

    // Rule 4: Async agents restricted to allowlist
    if (isAsync && !ASYNC_AGENT_ALLOWED_TOOLS.has(name)) {
      continue;
    }

    filtered[name] = meta;
  }

  return filtered;
}

// ============================================================
// resolveAgentTools (CC: agentToolUtils.ts lines 122-225)
// ============================================================

/**
 * Resolve an agent's tool specification against available tools.
 *
 * CC logic exactly:
 * 1. Apply baseline filtering via filterToolsForAgent
 * 2. Remove explicitly disallowed tools from agent definition
 * 3. Handle wildcard (undefined or ["*"]) → return all filtered tools
 * 4. Otherwise resolve explicit tool list against available map
 */
export function resolveAgentTools(
  agentDef: Pick<
    AgentDefinition,
    "tools" | "disallowedTools" | "source"
  >,
  allTools: Record<string, ToolMetadata>,
  isAsync = false,
): ResolvedAgentTools {
  const { tools: agentTools, disallowedTools, source } = agentDef;

  // Step 1: Baseline filter
  const filteredTools = filterToolsForAgent({
    tools: allTools,
    isBuiltIn: source === "built-in",
    isAsync,
  });

  // Step 2: Remove explicitly disallowed tools
  const disallowedSet = new Set(disallowedTools ?? []);
  const allowedTools: Record<string, ToolMetadata> = {};
  for (const [name, meta] of Object.entries(filteredTools)) {
    if (!disallowedSet.has(name)) {
      allowedTools[name] = meta;
    }
  }

  // Step 3: Handle wildcard
  const hasWildcard = agentTools === undefined ||
    (agentTools.length === 1 && agentTools[0] === "*");

  if (hasWildcard) {
    return {
      hasWildcard: true,
      validTools: [],
      invalidTools: [],
      resolvedTools: new Map(Object.entries(allowedTools)),
    };
  }

  // Step 4: Resolve explicit tool list
  const validTools: string[] = [];
  const invalidTools: string[] = [];
  const resolved = new Map<string, ToolMetadata>();

  for (const toolName of agentTools) {
    const tool = allowedTools[toolName];
    if (tool) {
      validTools.push(toolName);
      if (!resolved.has(toolName)) {
        resolved.set(toolName, tool);
      }
    } else {
      invalidTools.push(toolName);
    }
  }

  return {
    hasWildcard: false,
    validTools,
    invalidTools,
    resolvedTools: resolved,
  };
}

