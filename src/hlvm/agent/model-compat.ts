/**
 * Model Compatibility Heuristics
 *
 * Detection and repair functions for handling model misbehavior:
 * - Text-based tool call detection
 * - Tool instruction detection
 * - Response suppression logic
 *
 * Extracted from orchestrator.ts to keep the ReAct loop focused.
 */

/**
 * Detect JSON-like tool call structures anywhere in text.
 * Used to identify when a model outputs tool calls as text instead of using
 * native function calling.
 */
export function looksLikeToolCallJsonAnywhere(text: string): boolean {
  const pattern =
    /\{[\s\S]*?"(toolName|tool_name|function_name|name)"\s*:\s*"[^"]+"[\s\S]*?"(args|parameters|arguments)"\s*:\s*[\s\S]*?\}/m;
  return pattern.test(text);
}

/**
 * Detect explicit instructional patterns about tool calling in text.
 * Matches patterns like "json object ... tool", "function call:", "invoke the X tool".
 */
export function looksLikeToolInstruction(text: string): boolean {
  const lower = text.toLowerCase();
  // Only match explicit instructional patterns, not natural language
  if (/\bjson object\b/.test(lower) && /\btool\b/.test(lower)) return true;
  if (/\b(function|tool)\s+call(ing)?\s*[:\(]/i.test(lower)) return true;
  if (/\b(invoke|execute)\s+the\s+\w+\s+tool\b/.test(lower)) return true;
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
