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
  generateSystemPrompt,
} from "./llm-integration.ts";
import { createFixtureLLM, loadLlmFixture } from "./llm-fixtures.ts";
import { type AgentPolicy, loadAgentPolicy } from "./policy.ts";
import {
  classifyModelTier,
  computeTierToolFilter,
  ENGINE_PROFILES,
  isFrontierProvider,
  type ModelTier,
} from "./constants.ts";
import type { LLMFunction } from "./orchestrator.ts";
import {
  loadMcpTools,
  type McpHandlers,
  resolveBuiltinMcpServers,
} from "./mcp/mod.ts";
import { getAgentLogger } from "./logger.ts";
import { ValidationError } from "../../common/error.ts";
import { generateUUID } from "../../common/utils.ts";
import { resolveContextBudget, type ResolvedBudget } from "./context-resolver.ts";
import type { ModelInfo } from "../providers/types.ts";
import { getPlatform } from "../../platform/platform.ts";
import { type AgentEngine, getAgentEngine } from "./engine.ts";
import { loadMemoryContext } from "../memory/mod.ts";

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
  /** User-specified context window override (in tokens) */
  contextWindow?: number;
  /** Pre-fetched model info to avoid duplicate provider API calls */
  modelInfo?: ModelInfo | null;
  /** Custom instructions from ~/.hlvm/prompt.md */
  customInstructions?: string;
  /** Override the LLM engine (defaults to getAgentEngine()) */
  engine?: AgentEngine;
}

export interface AgentSession {
  context: ContextManager;
  llm: LLMFunction;
  policy: AgentPolicy | null;
  l1Confirmations: Map<string, boolean>;
  toolOwnerId: string;
  dispose: () => Promise<void>;
  profile: typeof ENGINE_PROFILES[keyof typeof ENGINE_PROFILES];
  /** True if the model is a frontier model (API provider, not local) */
  isFrontierModel: boolean;
  /** Classified model tier for prompt depth control */
  modelTier: ModelTier;
  /** Resolved context budget (budget, rawLimit, source) */
  resolvedContextBudget: ResolvedBudget;
  /** LLM config for rebuilding with different onToken (GUI streaming) */
  llmConfig?: {
    model: string;
    contextBudget: number;
    toolAllowlist?: string[];
    toolDenylist?: string[];
    toolOwnerId?: string;
    temperature?: number;
  };
  /** The engine used for LLM creation (for rebuilding in reuseSession) */
  engine?: AgentEngine;
  /** Deferred MCP handler registration (sampling, elicitation, roots) */
  mcpSetHandlers?: (handlers: McpHandlers) => void;
  /** Wire an AbortSignal to cancel all pending MCP requests */
  mcpSetSignal?: (signal: AbortSignal) => void;
}


/** Extract provider prefix from "provider/model" string */
function extractProviderName(model?: string): string {
  if (!model) return "unknown";
  const slashIdx = model.indexOf("/");
  return slashIdx > 0 ? model.slice(0, slashIdx).toLowerCase() : "ollama";
}

/** Extract model name from "provider/model" string */
function extractModelSuffix(model?: string): string {
  if (!model) return "unknown";
  const slashIdx = model.indexOf("/");
  return slashIdx > 0 ? model.slice(slashIdx + 1) : model;
}

/** Try to get ModelInfo from the provider (best-effort, non-blocking) */
async function tryGetModelInfo(
  providerName: string,
  modelName: string,
): Promise<ModelInfo | null> {
  try {
    const { ai } = await import("../api/ai.ts");
    if (ai?.models?.get) {
      return await ai.models.get(modelName, providerName) ?? null;
    }
  } catch {
    // Provider not available — fall through to defaults
  }
  return null;
}

/** Git context for system prompt */
export interface GitContext {
  branch: string;
  dirty: boolean;
}

/**
 * Detect git branch and dirty state with a 3-second timeout.
 * Returns null on any failure (not a git repo, git not installed, timeout).
 * @internal Exported for unit testing only.
 */
export async function detectGitContext(workspace: string): Promise<GitContext | null> {
  try {
    return await Promise.race([
      detectGitContextInner(workspace),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
  } catch {
    return null;
  }
}

async function detectGitContextInner(
  workspace: string,
): Promise<GitContext | null> {
  const platform = getPlatform();
  const run = (cmd: string[]) =>
    platform.command.output({
      cmd,
      cwd: workspace,
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    });

  const [branchResult, statusResult] = await Promise.all([
    run(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
    run(["git", "status", "--porcelain"]),
  ]);

  if (!branchResult.success) return null;

  const branch = new TextDecoder().decode(branchResult.stdout).trim();
  const statusOutput = new TextDecoder().decode(statusResult.stdout).trim();
  return { branch, dirty: statusOutput.length > 0 };
}

export async function createAgentSession(
  options: AgentSessionOptions,
): Promise<AgentSession> {
  const profile = ENGINE_PROFILES[options.engineProfile ?? "normal"];
  const toolOwnerId = `session:${generateUUID()}`;

  // Parallelize independent I/O: policy, MCP server discovery, and model info
  const providerName = extractProviderName(options.model);
  const modelName = extractModelSuffix(options.model);
  const [policy, builtinMcpServers, modelInfo, gitContext] = await Promise.all([
    loadAgentPolicy(options.workspace, options.policyPath),
    resolveBuiltinMcpServers(options.workspace),
    options.modelInfo !== undefined
      ? Promise.resolve(options.modelInfo)
      : (options.model && !options.fixturePath
        ? tryGetModelInfo(providerName, modelName)
        : Promise.resolve(null)),
    detectGitContext(options.workspace),
  ]);

  // Compute model tier BEFORE MCP loading (weak models skip MCP entirely)
  const isFrontier = isFrontierProvider(options.model);
  const modelTier = classifyModelTier(modelInfo, isFrontier);
  const tierFilter = computeTierToolFilter(modelTier, options.toolAllowlist, options.toolDenylist);

  // Load MCP tools (skip for weak-tier models to save context budget)
  let mcp: Awaited<ReturnType<typeof loadMcpTools>>;
  if (modelTier === "weak") {
    getAgentLogger().info("MCP: skipped (weak model tier)");
    mcp = {
      tools: [],
      ownerId: toolOwnerId,
      connectedServers: [],
      dispose: async () => {},
      setHandlers: () => {},
      setSignal: () => {},
    };
  } else {
    mcp = await loadMcpTools(
      options.workspace,
      options.mcpConfigPath,
      builtinMcpServers,
      toolOwnerId,
    );
  }

  // Log connected MCP servers at startup
  if (mcp.connectedServers.length > 0) {
    const logger = getAgentLogger();
    for (const s of mcp.connectedServers) {
      logger.info(`MCP: ${s.name} — ${s.toolCount} tools`);
    }
  }

  const resolved = resolveContextBudget({
    modelInfo: modelInfo ?? undefined,
    userOverride: options.contextWindow,
  });

  const contextConfig: Record<string, unknown> = { ...profile.context };
  contextConfig.maxTokens = resolved.budget;
  if (options.model) {
    contextConfig.modelKey = options.model;
  }
  if (options.failOnContextOverflow) {
    contextConfig.overflowStrategy = "fail";
  }
  // Wire LLM-powered summarization for context compaction (only for live models)
  const engine = options.engine ?? getAgentEngine();
  if (!options.fixturePath && options.model) {
    contextConfig.llmSummarize = engine.createSummarizer(options.model);
  }

  const context = new ContextManager(contextConfig);
  context.addMessage({
    role: "system",
    content: generateSystemPrompt({
      toolAllowlist: tierFilter.allowlist,
      toolDenylist: tierFilter.denylist,
      toolOwnerId: mcp.ownerId,
      customInstructions: options.customInstructions,
      modelTier,
      gitContext: gitContext ?? undefined,
    }),
  });

  // Inject memory as a SEPARATE system message (not embedded in main prompt).
  // This allows reuseSession() to refresh memory without duplicating it.
  try {
    const memoryContext = await loadMemoryContext(resolved.budget);
    if (memoryContext) {
      context.addMessage({
        role: "system",
        content: `# Your Memory\n${memoryContext}`,
      });
    }
  } catch {
    // Memory loading is best-effort — don't block session creation
  }

  const llm = options.fixturePath
    ? createFixtureLLM(await loadLlmFixture(options.fixturePath))
    : engine.createLLM({
      model: options.model ?? (() => {
        throw new ValidationError(
          "Model is required when no fixture is provided",
          "agent_session",
        );
      })(),
      options: { temperature: 0.0 },
      contextBudget: resolved.budget,
      toolAllowlist: tierFilter.allowlist,
      toolDenylist: tierFilter.denylist,
      toolOwnerId: mcp.ownerId,
      onToken: options.onToken,
    });

  const llmConfig = options.fixturePath ? undefined : {
    model: options.model!,
    contextBudget: resolved.budget,
    toolAllowlist: tierFilter.allowlist,
    toolDenylist: tierFilter.denylist,
    toolOwnerId: mcp.ownerId,
    temperature: 0.0,
  };

  return {
    context,
    llm,
    policy,
    l1Confirmations: new Map<string, boolean>(),
    toolOwnerId: mcp.ownerId,
    dispose: mcp.dispose,
    profile,
    isFrontierModel: isFrontier,
    modelTier,
    resolvedContextBudget: resolved,
    llmConfig,
    engine,
    mcpSetHandlers: mcp.setHandlers,
    mcpSetSignal: mcp.setSignal,
  };
}
