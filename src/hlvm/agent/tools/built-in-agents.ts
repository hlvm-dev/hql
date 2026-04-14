/**
 * Built-in Agents Registry
 *
 * CC source: tools/AgentTool/builtInAgents.ts
 * Simplified: no feature flags, no GrowthBook, no coordinator mode.
 * All stable built-in agents are always available.
 */

import type { AgentDefinition } from "./agent-types.ts";
import { GENERAL_PURPOSE_AGENT } from "./built-in/general.ts";
import { EXPLORE_AGENT } from "./built-in/explore.ts";
import { PLAN_AGENT } from "./built-in/plan.ts";

/**
 * Returns all built-in agent definitions.
 * CC: getBuiltInAgents() — simplified (no gates, always returns all stable agents)
 */
export function getBuiltInAgents(): AgentDefinition[] {
  return [
    GENERAL_PURPOSE_AGENT,
    EXPLORE_AGENT,
    PLAN_AGENT,
  ];
}
