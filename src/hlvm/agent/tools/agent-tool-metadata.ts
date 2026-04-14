/**
 * Agent Tool Metadata — separated from agent-tool.ts to break circular dependency.
 *
 * This file defines ONLY the tool metadata (name, description, args, fn pointer).
 * It does NOT import from registry.ts, so registry.ts can safely import this.
 *
 * The fn implementation delegates to agent-tool.ts via dynamic import at call time.
 */

import { AGENT_TOOL_NAME } from "./agent-constants.ts";
import {
  AGENT_TOOL_ARGS,
  getAgentToolFallbackDescription,
  resolveAgentToolDescription,
} from "./agent-tool-spec.ts";

/**
 * The Agent tool function — delegates to agent-tool.ts via dynamic import.
 * This breaks the circular dep: registry → this file → (no registry import).
 * agent-tool.ts is loaded only when the tool is actually called.
 */
async function agentToolFn(
  args: unknown,
  workspace: string,
  options?: unknown,
): Promise<unknown> {
  const { executeAgentTool } = await import("./agent-tool.ts");
  return executeAgentTool(args, workspace, options);
}

/**
 * Agent tool metadata for registration in TOOL_REGISTRY.
 * Keyed by tool name. No dependency on registry.ts types.
 */
export const AGENT_TOOL_METADATA: Record<string, {
  fn: typeof agentToolFn;
  description: string;
  resolveDescription?: (
    options?: { workspace?: string; ownerId?: string },
  ) => string | Promise<string>;
  args: Record<string, string>;
  safetyLevel: string;
  category: string;
  loading: { exposure: string };
  presentation: { kind: string };
}> = {
  [AGENT_TOOL_NAME]: {
    fn: agentToolFn,
    description: getAgentToolFallbackDescription(),
    resolveDescription: ({ workspace } = {}) =>
      resolveAgentToolDescription(workspace),
    args: AGENT_TOOL_ARGS,
    safetyLevel: "L0",
    category: "meta",
    loading: { exposure: "eager" },
    presentation: { kind: "meta" },
  },
};
