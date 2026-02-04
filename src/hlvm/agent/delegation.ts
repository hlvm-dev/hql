/**
 * Delegation - run specialist sub-agents
 */

import { ContextManager } from "./context.ts";
import { generateSystemPrompt } from "./llm-integration.ts";
import {
  runReActLoop,
  type LLMFunction,
  type OrchestratorConfig,
} from "./orchestrator.ts";
import { getAgentProfile, listAgentProfiles } from "./agent-registry.ts";
import { ENGINE_PROFILES } from "./constants.ts";
import { ValidationError } from "../../common/error.ts";
import { hasTool } from "./registry.ts";

interface DelegateArgs {
  agent: string;
  task: string;
  maxToolCalls?: number;
  groundingMode?: "off" | "warn" | "strict";
}

function buildAgentSystemNote(profileName: string, tools: string[]): string {
  return [
    `Specialist agent: ${profileName}`,
    `Allowed tools: ${tools.join(", ") || "none"}`,
    "Do not call delegate_agent.",
    "Return a concise, factual result that a supervisor can use directly.",
  ].join("\n");
}

function resolveAllowedTools(profileName: string): string[] {
  const profile = getAgentProfile(profileName);
  if (!profile) return [];
  return profile.tools.filter((tool) => hasTool(tool));
}

export function createDelegateHandler(
  llm: LLMFunction,
  baseConfig: Pick<OrchestratorConfig, "policy" | "autoApprove">,
): (args: unknown, config: OrchestratorConfig) => Promise<unknown> {
  return async (args: unknown, config: OrchestratorConfig): Promise<unknown> => {
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

    const allowedTools = resolveAllowedTools(profile.name);
    const context = new ContextManager({
      maxTokens: ENGINE_PROFILES.normal.context.maxTokens,
    });
    context.addMessage({
      role: "system",
      content: generateSystemPrompt(),
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
        autoApprove: baseConfig.autoApprove,
        maxToolCalls: typeof record.maxToolCalls === "number"
          ? record.maxToolCalls
          : config.maxToolCalls,
        groundingMode: (record.groundingMode as "off" | "warn" | "strict") ??
          config.groundingMode,
        policy: baseConfig.policy ?? null,
        toolAllowlist: allowedTools,
        toolDenylist: ["delegate_agent"],
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
