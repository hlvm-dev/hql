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
function looksLikeToolInstruction(text: string): boolean {
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

/**
 * Parse tool calls from text when native tool calling fails.
 * Last-resort fallback for models that output valid JSON but not via the API.
 */
export function tryParseToolCallsFromText(
  text: string,
): Array<{ toolName: string; args: Record<string, unknown> }> {
  if (!text.trim()) return [];

  // Strip markdown code fences
  const stripped = text
    .replace(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g, "$1")
    .trim();

  const single = tryParseOneToolCall(stripped);
  if (single) return [single];

  // Extract top-level JSON objects via brace matching
  const results: Array<{ toolName: string; args: Record<string, unknown> }> =
    [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const parsed = tryParseOneToolCall(text.slice(start, i + 1));
        if (parsed) results.push(parsed);
        start = -1;
      }
    }
  }
  return results;
}

function tryParseOneToolCall(
  json: string,
): { toolName: string; args: Record<string, unknown> } | null {
  try {
    const obj = JSON.parse(json);
    if (typeof obj !== "object" || obj === null || Array.isArray(obj))
      return null;
    const name =
      obj.name ?? obj.toolName ?? obj.tool_name ?? obj.function_name;
    if (typeof name !== "string" || !name.trim()) return null;
    const args = obj.arguments ?? obj.parameters ?? obj.args ?? {};
    if (typeof args !== "object" || args === null || Array.isArray(args))
      return null;
    return { toolName: name.trim(), args: args as Record<string, unknown> };
  } catch {
    return null;
  }
}
