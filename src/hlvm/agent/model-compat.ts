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

/**
 * Detect JSON-like tool call structures anywhere in text.
 * Used to identify when a model outputs tool calls as text instead of using
 * native function calling.
 */
export function looksLikeToolCallJsonAnywhere(text: string): boolean {
  return RE_TOOL_CALL_JSON.test(text);
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
  if (looksLikeToolInstruction(response)) return true;
  return false;
}

const AGENT_ORCHESTRATOR_FAILURE_PREFIXES = [
  "Native tool calling required.",
  "Tool call required but none provided.",
  "Tool-call JSON in text is not accepted.",
  "The model returned an empty response.",
] as const;

/**
 * Detect orchestrator-generated failure messages where falling back to plain chat
 * produces a better user-facing response.
 */
export function isAgentOrchestratorFailureResponse(response: string): boolean {
  const trimmed = response.trim();
  return AGENT_ORCHESTRATOR_FAILURE_PREFIXES.some((prefix) =>
    trimmed.startsWith(prefix)
  );
}
