/**
 * Agent Session - Shared setup for CLI agent commands
 *
 * Centralizes:
 * - Policy loading
 * - MCP tool registration
 * - Context + system prompt
 * - LLM creation (fixture or live)
 *
 * SSOT: Avoids duplicated setup logic across entry points.
 */

import { ContextManager } from "./context.ts";
import {
  createAgentLLM,
  createSummarizationFn,
  generateSystemPrompt,
} from "./llm-integration.ts";
import { createFixtureLLM, loadLlmFixture } from "./llm-fixtures.ts";
import { type AgentPolicy, loadAgentPolicy } from "./policy.ts";
import { ENGINE_PROFILES } from "./constants.ts";
import type { LLMFunction } from "./orchestrator.ts";
import { loadMcpTools, resolveBuiltinMcpServers } from "./mcp.ts";
import { ValidationError } from "../../common/error.ts";

export interface AgentSessionOptions {
  workspace: string;
  model?: string;
  fixturePath?: string;
  engineProfile?: keyof typeof ENGINE_PROFILES;
  failOnContextOverflow?: boolean;
  policyPath?: string;
  mcpConfigPath?: string;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  /** Optional callback for streaming tokens to the terminal */
  onToken?: (text: string) => void;
}

export interface AgentSession {
  context: ContextManager;
  llm: LLMFunction;
  policy: AgentPolicy | null;
  dispose: () => Promise<void>;
  profile: typeof ENGINE_PROFILES[keyof typeof ENGINE_PROFILES];
  /** True if the model is a frontier model (API provider, not local) */
  isFrontierModel: boolean;
}

/** Detect whether a model string refers to a frontier API model */
function detectFrontierModel(model?: string): boolean {
  if (!model) return false;
  const prefix = model.split("/")[0]?.toLowerCase() ?? "";
  return ["anthropic", "openai", "google"].includes(prefix);
}

export async function createAgentSession(
  options: AgentSessionOptions,
): Promise<AgentSession> {
  const profile = ENGINE_PROFILES[options.engineProfile ?? "normal"];
  const policy = await loadAgentPolicy(options.workspace, options.policyPath);
  const builtinMcpServers = await resolveBuiltinMcpServers(options.workspace);

  // Load MCP tools before generating system prompt
  const mcp = await loadMcpTools(
    options.workspace,
    options.mcpConfigPath,
    builtinMcpServers,
  );

  const contextConfig: Record<string, unknown> = { ...profile.context };
  if (options.failOnContextOverflow) {
    contextConfig.overflowStrategy = "fail";
  }
  // Wire LLM-powered summarization for context compaction (only for live models)
  if (!options.fixturePath && options.model) {
    contextConfig.llmSummarize = createSummarizationFn(options.model);
  }

  const context = new ContextManager(contextConfig);
  context.addMessage({
    role: "system",
    content: generateSystemPrompt({
      toolAllowlist: options.toolAllowlist,
      toolDenylist: options.toolDenylist,
    }),
  });

  const llm = options.fixturePath
    ? createFixtureLLM(await loadLlmFixture(options.fixturePath))
    : createAgentLLM({
      model: options.model ?? (() => {
        throw new ValidationError(
          "Model is required when no fixture is provided",
          "agent_session",
        );
      })(),
      options: { temperature: 0.0 },
      toolAllowlist: options.toolAllowlist,
      toolDenylist: options.toolDenylist,
      onToken: options.onToken,
    });

  return {
    context,
    llm,
    policy,
    dispose: mcp.dispose,
    profile,
    isFrontierModel: detectFrontierModel(options.model),
  };
}
