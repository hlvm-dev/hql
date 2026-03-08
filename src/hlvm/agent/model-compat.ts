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

// Pre-compiled regexes — hoisted to module level to avoid recompilation per call
const RE_TOOL_CALL_JSON =
  /\{[\s\S]*?"(toolName|tool_name|function_name|name)"\s*:\s*"[^"]+"[\s\S]*?"(args|parameters|arguments)"\s*:\s*[\s\S]*?\}/m;
const RE_JSON_OBJECT_TOOL = /\bjson object\b/;
const RE_TOOL_WORD = /\btool\b/;
const RE_FUNCTION_TOOL_CALL = /\b(function|tool)\s+call(ing)?\s*[:\(]/i;
const RE_INVOKE_TOOL = /\b(invoke|execute)\s+the\s+\w+\s+tool\b/;
const RE_PLAN_ENVELOPE = /^PLAN\s*(?:\r?\n)[\s\S]*?(?:\r?\n)END_PLAN\s*$/;
const RE_PLAN_BLOCK = /PLAN\s*(?:\r?\n)[\s\S]*?(?:\r?\n)END_PLAN\s*/g;
const PLAN_START_MARKER = "PLAN";
const PLAN_END_MARKER = "END_PLAN";

/**
 * Detect JSON-like tool call structures anywhere in text.
 * Used to identify when a model outputs tool calls as text instead of using
 * native function calling.
 */
export function looksLikeToolCallJsonAnywhere(text: string): boolean {
  return RE_TOOL_CALL_JSON.test(text);
}

/**
 * Detect planning envelopes emitted by the planner request.
 */
export function looksLikePlanEnvelope(text: string): boolean {
  return RE_PLAN_ENVELOPE.test(text.trim());
}

export function stripPlanEnvelopeBlocks(text: string): string {
  return text.replace(RE_PLAN_BLOCK, "").trim();
}

/**
 * Detect explicit instructional patterns about tool calling in text.
 * Matches patterns like "json object ... tool", "function call:", "invoke the X tool".
 */
function looksLikeToolInstruction(text: string): boolean {
  const lower = text.toLowerCase();
  // Only match explicit instructional patterns, not natural language
  if (RE_JSON_OBJECT_TOOL.test(lower) && RE_TOOL_WORD.test(lower)) return true;
  if (RE_FUNCTION_TOOL_CALL.test(lower)) return true;
  if (RE_INVOKE_TOOL.test(lower)) return true;
  return false;
}

/**
 * Check if a response ends with a question mark (likely asking the user).
 */
export function responseAsksQuestion(response: string): boolean {
  if (!response) return false;
  // Only trigger if the last sentence is a question (avoid false positives from "?" in data)
  const trimmed = response.trim();
  return trimmed.endsWith("?");
}

/**
 * Determine if a final response should be suppressed (not shown to user).
 * Suppresses empty responses, raw tool call JSON, and tool instructions.
 */
export function shouldSuppressFinalResponse(response: string): boolean {
  if (!response.trim()) return true;
  if (looksLikeToolCallJsonAnywhere(response)) return true;
  if (looksLikePlanEnvelope(response)) return true;
  if (looksLikeToolInstruction(response)) return true;
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
      trimmed === PLAN_START_MARKER ||
      trimmed.startsWith(`${PLAN_START_MARKER}\n`) ||
      trimmed.startsWith(`${PLAN_START_MARKER}\r\n`)
    ) {
      return "plan";
    }
    if (PLAN_START_MARKER.startsWith(trimmed)) return "prefix";
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
          const endIndex = buffer.indexOf(PLAN_END_MARKER);
          if (endIndex < 0) {
            buffer = buffer.slice(Math.max(0, buffer.length - (PLAN_END_MARKER.length - 1)));
            return visible;
          }
          buffer = buffer.slice(endIndex + PLAN_END_MARKER.length)
            .replace(/^\s*\r?\n?/, "");
          insidePlanEnvelope = false;
          continue;
        }

        const state = planPrefixState(buffer);
        if (state === "prefix") return visible;
        if (state === "plan") {
          const trimmed = buffer.trimStart();
          const leadingWhitespaceLength = buffer.length - trimmed.length;
          buffer = buffer.slice(leadingWhitespaceLength + PLAN_START_MARKER.length);
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

export interface AgentFinalResponseClassification {
  suppressFinalResponse: boolean;
  orchestratorFailureCode: AgentOrchestratorFailureCode | null;
}

/**
 * Classify final agent output using canonical orchestrator messages (SSOT).
 * This avoids prefix/string-guess based routing decisions in higher layers.
 */
export function classifyAgentFinalResponse(
  response: string,
): AgentFinalResponseClassification {
  const trimmed = response.trim();
  const failureMatch = ORCHESTRATOR_FAILURE_ENTRIES.find(([, message]) =>
    message === trimmed
  );
  return {
    suppressFinalResponse: shouldSuppressFinalResponse(trimmed),
    orchestratorFailureCode: failureMatch?.[0] ?? null,
  };
}
