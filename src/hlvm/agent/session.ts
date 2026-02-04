/**
 * Agent Session - Shared setup for CLI and wire mode
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
import { generateSystemPrompt, createAgentLLM } from "./llm-integration.ts";
import { createFixtureLLM, loadLlmFixture } from "./llm-fixtures.ts";
import { loadAgentPolicy, type AgentPolicy } from "./policy.ts";
import { ENGINE_PROFILES } from "./constants.ts";
import type { LLMFunction } from "./orchestrator.ts";
import { loadMcpTools, type McpServerConfig } from "./mcp.ts";
import { ValidationError } from "../../common/error.ts";
import { getPlatform } from "../../platform/platform.ts";

export interface AgentSessionOptions {
  workspace: string;
  model?: string;
  fixturePath?: string;
  engineProfile?: keyof typeof ENGINE_PROFILES;
  failOnContextOverflow?: boolean;
  policyPath?: string;
  mcpConfigPath?: string;
  autoWeb?: boolean;
  toolAllowlist?: string[];
  toolDenylist?: string[];
}

export interface AgentSession {
  context: ContextManager;
  llm: LLMFunction;
  policy: AgentPolicy | null;
  dispose: () => Promise<void>;
  profile: typeof ENGINE_PROFILES[keyof typeof ENGINE_PROFILES];
}

export async function createAgentSession(
  options: AgentSessionOptions,
): Promise<AgentSession> {
  const profile = ENGINE_PROFILES[options.engineProfile ?? "normal"];
  const policy = await loadAgentPolicy(options.workspace, options.policyPath);

  const platform = getPlatform();
  const extraServers: McpServerConfig[] = [];
  if (options.autoWeb) {
    const nodeScriptPath = platform.path.join(
      options.workspace,
      "scripts",
      "mcp",
      "playwright-server.mjs",
    );
    const denoScriptPath = platform.path.join(
      options.workspace,
      "scripts",
      "mcp",
      "playwright-server.ts",
    );
    if (await platform.fs.exists(nodeScriptPath)) {
      extraServers.push({
        name: "playwright",
        command: ["node", nodeScriptPath],
      });
    } else if (await platform.fs.exists(denoScriptPath)) {
      extraServers.push({
        name: "playwright",
        command: ["deno", "run", "--node-modules-dir=auto", "-A", denoScriptPath],
      });
    }
  }

  // Load MCP tools before generating system prompt
  const mcp = await loadMcpTools(
    options.workspace,
    options.mcpConfigPath,
    extraServers,
  );

  const contextConfig = { ...profile.context };
  if (options.failOnContextOverflow) {
    contextConfig.overflowStrategy = "fail";
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
      toolAllowlist: options.toolAllowlist,
      toolDenylist: options.toolDenylist,
    });

  return {
    context,
    llm,
    policy,
    dispose: mcp.dispose,
    profile,
  };
}
