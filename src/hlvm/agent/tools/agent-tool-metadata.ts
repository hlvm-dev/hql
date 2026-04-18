/**
 * Agent Tool Metadata — separated from agent-tool.ts to break circular dependency.
 *
 * registry.ts imports this file; this file never imports registry.ts at runtime.
 * The ToolMetadata type is type-only (erased at compile time → no runtime cycle).
 *
 * The fn implementation delegates to agent-tool.ts via dynamic import at call time.
 */

import type { ToolFunction, ToolMetadata } from "../registry.ts";
import { AGENT_TOOL_NAME, ONE_SHOT_AGENT_TYPES } from "./agent-constants.ts";
import type { AgentAsyncResult, AgentToolResult } from "./agent-types.ts";
import { getAgentToolResultText } from "./agent-types.ts";
import {
  AGENT_TOOL_ARGS,
  getAgentToolFallbackDescription,
  resolveAgentToolDescription,
} from "./agent-tool-spec.ts";

const agentToolFn: ToolFunction = async (args, workspace, options) => {
  const { executeAgentTool } = await import("./agent-tool.ts");
  return executeAgentTool(args, workspace, options);
};

function formatCompletedAgentResult(result: AgentToolResult) {
  const rawText = getAgentToolResultText(result);
  const content = rawText.length > 0
    ? rawText
    : "(Subagent completed but returned no output.)";
  if (
    ONE_SHOT_AGENT_TYPES.has(result.agentType) &&
    !result.worktreePath
  ) {
    return {
      summaryDisplay: content,
      returnDisplay: content,
      llmContent: content,
    };
  }

  const worktreeInfo = result.worktreePath
    ? `\nworktreePath: ${result.worktreePath}\nworktreeBranch: ${
      result.worktreeBranch ?? ""
    }`.trimEnd()
    : "";
  const text =
    `${content}\n\nagentId: ${result.agentId}${worktreeInfo}\n<usage>total_tokens: ${result.totalTokens}\ntool_uses: ${result.totalToolUseCount}\nduration_ms: ${result.totalDurationMs}</usage>`;
  return {
    summaryDisplay: content,
    returnDisplay: text,
    llmContent: text,
  };
}

function formatAsyncAgentResult(result: AgentAsyncResult) {
  const text =
    `Async agent launched successfully.\nagentId: ${result.agentId}\noutput_file: ${result.outputFile}\nThe agent is working in the background. You will be notified automatically when it completes.`;
  return {
    summaryDisplay: `Async agent launched: ${result.agentId}`,
    returnDisplay: text,
    llmContent: text,
  };
}

function formatAgentToolResult(result: unknown) {
  if (typeof result !== "object" || result === null || !("status" in result)) {
    return null;
  }
  const status = (result as { status?: unknown }).status;
  if (status === "completed") {
    return formatCompletedAgentResult(result as AgentToolResult);
  }
  if (status === "async_launched") {
    return formatAsyncAgentResult(result as AgentAsyncResult);
  }
  return null;
}

export const AGENT_TOOL_METADATA: Record<string, ToolMetadata> = {
  [AGENT_TOOL_NAME]: {
    fn: agentToolFn,
    description: getAgentToolFallbackDescription(),
    resolveDescription: ({ workspace } = {}) =>
      resolveAgentToolDescription(workspace),
    args: AGENT_TOOL_ARGS,
    safetyLevel: "L0",
    category: "meta",
    formatResult: formatAgentToolResult,
    loading: { exposure: "eager" },
    presentation: { kind: "meta" },
  },
};
