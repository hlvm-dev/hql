/**
 * Agent Tools - Delegation to specialist agents
 */

import { ValidationError } from "../../../common/error.ts";
import type { ToolMetadata } from "../registry.ts";

async function delegateAgentStub(): Promise<Record<string, unknown>> {
  throw new ValidationError(
    "delegate_agent is not configured. Ensure the session provides a delegate handler.",
    "delegate_agent",
  );
}

export const AGENT_TOOLS: Record<string, ToolMetadata> = {
  delegate_agent: {
    fn: async () => await delegateAgentStub(),
    description:
      "Delegate a task to a specialist agent and return its result.",
    args: {
      agent: "string - Agent name (general, code, file, shell, web, memory)",
      task: "string - Task to delegate",
      maxToolCalls: "number (optional) - Max tool calls for the delegate",
      groundingMode: "string (optional) - off|warn|strict",
    },
    returns: {
      agent: "string",
      result: "string",
      stats: "object",
    },
    safetyLevel: "L1",
    safety: "Delegation triggers sub-agent tool use (policy-gated).",
  },
};
