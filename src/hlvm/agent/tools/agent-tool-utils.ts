import type { ToolMetadata } from "../registry.ts";
import type { AgentDefinition } from "./agent-types.ts";
import { isMcpToolName } from "../mcp/tool-names.ts";
import {
  ALL_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
} from "./agent-constants.ts";
import { permissionRuleValueFromString } from "./permission-rule.ts";

export interface ResolvedAgentTools {
  hasWildcard: boolean;
  validTools: string[];
  invalidTools: string[];
  resolvedTools: Map<string, ToolMetadata>;
}

export function filterToolsForAgent(opts: {
  tools: Record<string, ToolMetadata>;
  isBuiltIn: boolean;
  isAsync?: boolean;
}): Record<string, ToolMetadata> {
  const { tools, isBuiltIn, isAsync = false } = opts;
  const filtered: Record<string, ToolMetadata> = {};

  for (const [name, meta] of Object.entries(tools)) {
    if (isMcpToolName(name)) {
      filtered[name] = meta;
      continue;
    }
    if (ALL_AGENT_DISALLOWED_TOOLS.has(name)) continue;
    if (!isBuiltIn && CUSTOM_AGENT_DISALLOWED_TOOLS.has(name)) continue;
    if (isAsync && !ASYNC_AGENT_ALLOWED_TOOLS.has(name)) continue;
    filtered[name] = meta;
  }

  return filtered;
}

export function applyParentPermissions(
  allTools: Record<string, ToolMetadata>,
  parentAllowlist?: readonly string[],
  parentDenylist?: readonly string[],
): Record<string, ToolMetadata> {
  const hasAllow = parentAllowlist && parentAllowlist.length > 0;
  const hasDeny = parentDenylist && parentDenylist.length > 0;
  if (!hasAllow && !hasDeny) return allTools;

  const allowSet = hasAllow
    ? new Set(
      parentAllowlist!.map((s) => permissionRuleValueFromString(s).toolName),
    )
    : null;
  const denySet = hasDeny
    ? new Set(
      parentDenylist!.map((s) => permissionRuleValueFromString(s).toolName),
    )
    : null;

  const filtered: Record<string, ToolMetadata> = {};
  for (const [name, meta] of Object.entries(allTools)) {
    if (denySet?.has(name)) continue;
    if (allowSet && !allowSet.has(name)) continue;
    filtered[name] = meta;
  }
  return filtered;
}

export function resolveAgentTools(
  agentDef: Pick<
    AgentDefinition,
    "tools" | "disallowedTools" | "source"
  >,
  allTools: Record<string, ToolMetadata>,
  isAsync = false,
): ResolvedAgentTools {
  const { tools: agentTools, disallowedTools, source } = agentDef;

  const filteredTools = filterToolsForAgent({
    tools: allTools,
    isBuiltIn: source === "built-in",
    isAsync,
  });

  const disallowedSet = new Set(
    (disallowedTools ?? []).map((spec) =>
      permissionRuleValueFromString(spec).toolName
    ),
  );
  const allowedTools: Record<string, ToolMetadata> = {};
  for (const [name, meta] of Object.entries(filteredTools)) {
    if (!disallowedSet.has(name)) {
      allowedTools[name] = meta;
    }
  }

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

  const validTools: string[] = [];
  const invalidTools: string[] = [];
  const resolved = new Map<string, ToolMetadata>();

  for (const toolSpec of agentTools) {
    const { toolName } = permissionRuleValueFromString(toolSpec);
    const tool = allowedTools[toolName];
    if (tool) {
      validTools.push(toolName);
      if (!resolved.has(toolName)) {
        resolved.set(toolName, tool);
      }
    } else {
      invalidTools.push(toolSpec);
    }
  }

  return {
    hasWildcard: false,
    validTools,
    invalidTools,
    resolvedTools: resolved,
  };
}
