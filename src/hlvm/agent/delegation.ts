/**
 * Delegation - run specialist sub-agents
 */

import { ContextManager } from "./context.ts";
import { generateSystemPrompt } from "./llm-integration.ts";
import {
  type LLMFunction,
  type OrchestratorConfig,
  runReActLoop,
} from "./orchestrator.ts";
import { getAgentProfile, listAgentProfiles } from "./agent-registry.ts";
import { DEFAULT_MAX_TOOL_CALLS, isGroundingMode } from "./constants.ts";
import { ValidationError } from "../../common/error.ts";
import { hasTool } from "./registry.ts";

function buildAgentSystemNote(profileName: string, tools: string[]): string {
  return [
    `Specialist agent: ${profileName}`,
    `Allowed tools: ${tools.join(", ") || "none"}`,
    "Do not call delegate_agent.",
    "Return a concise, factual result that a supervisor can use directly.",
  ].join("\n");
}

function resolveAllowedTools(
  profileName: string,
  toolOwnerId?: string,
): string[] {
  const profile = getAgentProfile(profileName);
  if (!profile) return [];
  return profile.tools.filter((tool) => hasTool(tool, toolOwnerId));
}

export function createDelegateHandler(
  llm: LLMFunction,
  baseConfig: Pick<OrchestratorConfig, "policy">,
): (args: unknown, config: OrchestratorConfig) => Promise<unknown> {
  return async (
    args: unknown,
    config: OrchestratorConfig,
  ): Promise<unknown> => {
    if (!args || typeof args !== "object") {
      throw new ValidationError(
        `delegate_agent requires { agent, task }. Got: ${typeof args}`,
        "delegate_agent",
      );
    }
    const record = args as Record<string, unknown>;
    const agent = typeof record.agent === "string" ? record.agent : "";
    const task = typeof record.task === "string" ? record.task : "";
    if (!agent || !task) {
      throw new ValidationError(
        `delegate_agent requires { agent, task }. Available agents: ${
          listAgentProfiles().map((p) => p.name).join(", ")
        }`,
        "delegate_agent",
      );
    }

    const profile = getAgentProfile(agent);
    if (!profile) {
      throw new ValidationError(
        `Unknown agent "${agent}". Available: ${
          listAgentProfiles().map((p) => p.name).join(", ")
        }`,
        "delegate_agent",
      );
    }

    const allowedTools = resolveAllowedTools(profile.name, config.toolOwnerId);
    // Use parent context's resolved budget instead of hardcoded default
    const parentCtxConfig = config.context.getConfig();
    const context = new ContextManager({
      ...parentCtxConfig,
      maxTokens: config.context.getMaxTokens(),
    });
    context.addMessage({
      role: "system",
      content: generateSystemPrompt({
        toolAllowlist: allowedTools,
        toolOwnerId: config.toolOwnerId,
      }),
    });
    context.addMessage({
      role: "system",
      content: buildAgentSystemNote(profile.name, allowedTools),
    });

    const result = await runReActLoop(
      task,
      {
        workspace: config.workspace,
        context,
        permissionMode: config.permissionMode,
        // Fix 16: Clamp maxToolCalls to prevent resource exhaustion
        maxToolCalls: typeof record.maxToolCalls === "number"
          ? Math.min(
            record.maxToolCalls,
            config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
          )
          : config.maxToolCalls,
        // Fix 17: Validate groundingMode at runtime
        groundingMode: isGroundingMode(record.groundingMode)
          ? record.groundingMode
          : config.groundingMode,
        policy: baseConfig.policy ?? null,
        toolAllowlist: allowedTools,
        toolDenylist: ["delegate_agent"],
        l1Confirmations: new Map<string, boolean>(),
        toolOwnerId: config.toolOwnerId,
        planning: { mode: "off" },
      },
      llm,
    );

    return {
      agent: profile.name,
      result,
      stats: context.getStats(),
    };
  };
}
