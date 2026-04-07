/**
 * Model Compatibility Heuristics
 *
 * Detection functions for handling model misbehavior:
 * - Text-based tool call detection
 * - Tool instruction detection
 * - Response suppression logic
 *
 * Extracted from orchestrator.ts to keep the ReAct loop focused.
 */

import { PLAN_END, PLAN_START } from "./planning.ts";

// Pre-compiled regexes — hoisted to module level to avoid recompilation per call
const RE_TOOL_CALL_JSON =
  /\{[\s\S]*?"(toolName|tool_name|function_name|name)"\s*:\s*"[^"]+"[\s\S]*?"(args|parameters|arguments)"\s*:\s*[\s\S]*?\}/m;
const RE_TOOL_CALL_TEXT_ENVELOPE =
  /^\s*[a-z_][\w.]*\s*\(\s*\{[\s\S]*\}\s*\)\s*$/i;
const RE_TOOL_CALL_TEXT_ENVELOPE_CAPTURE =
  /^\s*([a-z_][\w.]*)\s*\(\s*(\{[\s\S]*\})\s*\)\s*$/i;
const RE_PLAN_ENVELOPE = /^PLAN\s*(?:\r?\n)[\s\S]*?(?:\r?\n)END_PLAN\s*$/;
const RE_PLAN_BLOCK = /PLAN\s*(?:\r?\n)[\s\S]*?(?:\r?\n)END_PLAN\s*/g;

/**
 * Detect JSON-like tool call structures anywhere in text.
 * Used to identify when a model outputs tool calls as text instead of using
 * native function calling.
 */
export function looksLikeToolCallJsonAnywhere(text: string): boolean {
  return RE_TOOL_CALL_JSON.test(text);
}

/**
 * Detect raw function-style tool calls rendered as plain text instead of
 * structured tool calls, e.g. `search_web({query: "..."})`.
 */
export function looksLikeToolCallTextEnvelope(text: string): boolean {
  return RE_TOOL_CALL_TEXT_ENVELOPE.test(text.trim());
}

export function parseToolCallTextEnvelope(
  text: string,
): { toolName: string; args: Record<string, unknown> } | null {
  const match = RE_TOOL_CALL_TEXT_ENVELOPE_CAPTURE.exec(text.trim());
  if (!match) {
    return null;
  }
  const toolName = match[1]?.trim();
  const rawArgs = match[2]?.trim();
  if (!toolName || !rawArgs) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawArgs);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return {
      toolName,
      args: parsed as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/**
 * Detect planning envelopes emitted by the planner request.
 */
function looksLikePlanEnvelope(text: string): boolean {
  return RE_PLAN_ENVELOPE.test(text.trim());
}

export function stripPlanEnvelopeBlocks(text: string): string {
  return text.replace(RE_PLAN_BLOCK, "").trim();
}

/**
 * Detect explicit instructional patterns about tool calling in text
 * using LLM classification. Falls back to false on error.
 */
async function looksLikeToolInstruction(text: string): Promise<boolean> {
  if (!text.trim()) return false;
  const { classifyToolInstruction } = await import("../runtime/local-llm.ts");
  const result = await classifyToolInstruction(text);
  return result.isInstruction;
}

/**
 * Check if a response asks the user a question using LLM classification.
 * Falls back to false on LLM failure (safe default — won't trigger follow-up interaction).
 */
export async function responseAsksQuestion(response: string): Promise<boolean> {
  if (!response) return false;
  const { classifyResponseIntent } = await import("../runtime/local-llm.ts");
  const intent = await classifyResponseIntent(response);
  return intent.asksQuestion;
}

/**
 * Determine if a final response should be suppressed (not shown to user).
 * Suppresses empty responses, raw tool call JSON, and tool instructions.
 */
export async function shouldSuppressFinalResponse(response: string): Promise<boolean> {
  if (!response.trim()) return true;
  if (looksLikeToolCallJsonAnywhere(response)) return true;
  if (looksLikeToolCallTextEnvelope(response)) return true;
  if (looksLikePlanEnvelope(response)) return true;
  if (await looksLikeToolInstruction(response)) return true;
  return false;
}

export interface StreamingResponseSanitizer {
  push(chunk: string): string;
  flush(): string;
}

/**
 * Suppress leading PLAN...END_PLAN envelopes from streamed CLI output.
 * This keeps the ask CLI from leaking planner JSON while preserving normal answers.
 */
export function createStreamingResponseSanitizer(): StreamingResponseSanitizer {
  let buffer = "";
  let insidePlanEnvelope = false;
  let emittedVisibleText = false;

  const planPrefixState = (text: string): "prefix" | "plan" | "other" => {
    const trimmed = text.trimStart();
    if (!trimmed) return "prefix";
    if (
      trimmed === PLAN_START ||
      trimmed.startsWith(`${PLAN_START}\n`) ||
      trimmed.startsWith(`${PLAN_START}\r\n`)
    ) {
      return "plan";
    }
    if (PLAN_START.startsWith(trimmed)) return "prefix";
    return "other";
  };

  return {
    push(chunk: string): string {
      if (!chunk) return "";
      if (emittedVisibleText && !insidePlanEnvelope) return chunk;

      buffer += chunk;
      let visible = "";

      while (buffer.length > 0) {
        if (insidePlanEnvelope) {
          const endIndex = buffer.indexOf(PLAN_END);
          if (endIndex < 0) {
            buffer = buffer.slice(Math.max(0, buffer.length - (PLAN_END.length - 1)));
            return visible;
          }
          buffer = buffer.slice(endIndex + PLAN_END.length)
            .replace(/^\s*\r?\n?/, "");
          insidePlanEnvelope = false;
          continue;
        }

        const state = planPrefixState(buffer);
        if (state === "prefix") return visible;
        if (state === "plan") {
          const trimmed = buffer.trimStart();
          const leadingWhitespaceLength = buffer.length - trimmed.length;
          buffer = buffer.slice(leadingWhitespaceLength + PLAN_START.length);
          if (buffer.startsWith("\r\n")) buffer = buffer.slice(2);
          else if (buffer.startsWith("\n")) buffer = buffer.slice(1);
          insidePlanEnvelope = true;
          continue;
        }

        emittedVisibleText = true;
        visible += buffer;
        buffer = "";
      }

      return visible;
    },

    flush(): string {
      if (insidePlanEnvelope) {
        buffer = "";
        return "";
      }
      const state = planPrefixState(buffer);
      if (!emittedVisibleText && state !== "other") {
        buffer = "";
        return "";
      }
      const remaining = buffer;
      if (remaining) emittedVisibleText = true;
      buffer = "";
      return remaining;
    },
  };
}

export const AGENT_ORCHESTRATOR_FAILURE_MESSAGES = {
  nativeToolCallingRequired:
    "Native tool calling required. Tool call JSON in text is not accepted.",
  toolCallRequired: "Tool call required but none provided. Task incomplete.",
  toolCallJsonRejected:
    "Tool-call JSON in text is not accepted. Provide a final answer based on available tool results.",
  emptyResponse: "The model returned an empty response. Please try again.",
} as const;

export type AgentOrchestratorFailureCode =
  keyof typeof AGENT_ORCHESTRATOR_FAILURE_MESSAGES;

const ORCHESTRATOR_FAILURE_ENTRIES = Object.entries(
  AGENT_ORCHESTRATOR_FAILURE_MESSAGES,
) as Array<[AgentOrchestratorFailureCode, string]>;

interface AgentFinalResponseClassification {
  suppressFinalResponse: boolean;
  orchestratorFailureCode: AgentOrchestratorFailureCode | null;
}

/**
 * Classify final agent output using canonical orchestrator messages (SSOT).
 * This avoids prefix/string-guess based routing decisions in higher layers.
 */
export async function classifyAgentFinalResponse(
  response: string,
): Promise<AgentFinalResponseClassification> {
  const trimmed = response.trim();
  const failureMatch = ORCHESTRATOR_FAILURE_ENTRIES.find(([, message]) =>
    message === trimmed
  );
  return {
    suppressFinalResponse: await shouldSuppressFinalResponse(trimmed),
    orchestratorFailureCode: failureMatch?.[0] ?? null,
  };
}
