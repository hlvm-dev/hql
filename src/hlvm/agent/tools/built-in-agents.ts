import type { AgentDefinition } from "./agent-types.ts";
import { GENERAL_PURPOSE_AGENT } from "./built-in/general.ts";
import { EXPLORE_AGENT } from "./built-in/explore.ts";
import { PLAN_AGENT } from "./built-in/plan.ts";

export function getBuiltInAgents(): AgentDefinition[] {
  return [
    GENERAL_PURPOSE_AGENT,
    EXPLORE_AGENT,
    PLAN_AGENT,
  ];
}
