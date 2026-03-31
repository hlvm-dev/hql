/**
 * Structured Output Fallback — Prompt-Based JSON Extraction
 *
 * When provider-native constrained decoding is unavailable (e.g. Ollama models),
 * this module extracts structured output via prompt engineering:
 *   1. Instruct the model to return JSON matching a schema
 *   2. Extract JSON from the response text
 *   3. Validate against the schema (top-level checks)
 *   4. Retry with feedback if validation fails
 *
 * Every major AI framework (LangChain, Instructor, Outlines) uses this pattern.
 * Not as reliable as constrained decoding, but *executable*.
 */

import type { SdkModelSpec, SdkConvertibleMessage } from "./sdk-runtime.ts";
import { RuntimeError } from "../../common/error.ts";
import { ProviderErrorCode } from "../../common/error-codes.ts";

// ============================================================================
// JSON extraction from free-form text
// ============================================================================

/** Extract JSON from a model response that may contain markdown fences or prose. */
export function extractJsonFromResponse(text: string): string | null {
  // Try ```json fence
  const jsonFenceMatch = text.match(/```json\s*\n?([\s\S]*?)```/);
  if (jsonFenceMatch) return jsonFenceMatch[1].trim();

  // Try bare ``` fence
  const bareFenceMatch = text.match(/```\s*\n?([\s\S]*?)```/);
  if (bareFenceMatch) {
    const inner = bareFenceMatch[1].trim();
    if (inner.startsWith("{") || inner.startsWith("[")) return inner;
  }

  // Try first { to last }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

// ============================================================================
// JSON repair for common LLM mistakes
// ============================================================================

/** Attempt to repair common JSON issues from LLM output. */
export function repairJson(raw: string): string {
  let repaired = raw;
  // Remove trailing commas before } or ]
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");
  // Stack-based repair: remove mismatched closers, then append missing ones
  const stack: string[] = [];
  const chars: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of repaired) {
    if (escape) { escape = false; chars.push(ch); continue; }
    if (ch === "\\") { escape = true; chars.push(ch); continue; }
    if (ch === '"') { inString = !inString; chars.push(ch); continue; }
    if (inString) { chars.push(ch); continue; }
    if (ch === "{") { stack.push("}"); chars.push(ch); }
    else if (ch === "[") { stack.push("]"); chars.push(ch); }
    else if ((ch === "}" || ch === "]") && stack.length > 0 && stack[stack.length - 1] === ch) {
      stack.pop();
      chars.push(ch);
    } else if (ch === "}" || ch === "]") {
      // Mismatched closer — drop it from output
    } else {
      chars.push(ch);
    }
  }
  return chars.join("") + stack.reverse().join("");
}

// ============================================================================
// Schema validation (top-level checks, no Ajv)
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Top-level schema validation: is object? required keys? primitive types match? */
export function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
): ValidationResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, error: "Expected a JSON object, got " + typeof value };
  }

  const obj = value as Record<string, unknown>;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = schema.required as string[] | undefined;

  // Check required keys
  if (required) {
    for (const key of required) {
      if (!(key in obj)) {
        return { valid: false, error: `Missing required key: "${key}"` };
      }
    }
  }

  // Check primitive types for declared properties
  if (properties) {
    for (const [key, propSchema] of Object.entries(properties)) {
      if (!(key in obj)) continue;
      const expectedType = propSchema.type as string | undefined;
      if (!expectedType) continue;
      const actualValue = obj[key];
      if (actualValue === null || actualValue === undefined) continue;

      const actualType = Array.isArray(actualValue) ? "array" : typeof actualValue;
      if (expectedType === "integer" || expectedType === "number") {
        if (typeof actualValue !== "number") {
          return { valid: false, error: `Key "${key}": expected ${expectedType}, got ${actualType}` };
        }
      } else if (expectedType === "boolean") {
        if (typeof actualValue !== "boolean") {
          return { valid: false, error: `Key "${key}": expected boolean, got ${actualType}` };
        }
      } else if (expectedType === "string") {
        if (typeof actualValue !== "string") {
          return { valid: false, error: `Key "${key}": expected string, got ${actualType}` };
        }
      } else if (expectedType === "array") {
        if (!Array.isArray(actualValue)) {
          return { valid: false, error: `Key "${key}": expected array, got ${actualType}` };
        }
      } else if (expectedType === "object") {
        if (typeof actualValue !== "object" || Array.isArray(actualValue)) {
          return { valid: false, error: `Key "${key}": expected object, got ${actualType}` };
        }
      }
    }
  }

  return { valid: true };
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Generate structured output via prompt-based extraction.
 * Used as hlvm-local fallback when provider-native constrained decoding is unavailable.
 */
export async function generateStructuredWithPromptFallback(
  spec: SdkModelSpec,
  messages: SdkConvertibleMessage[],
  schema: Record<string, unknown>,
  options?: { signal?: AbortSignal; temperature?: number; maxRetries?: number },
): Promise<unknown> {
  const { createSdkLanguageModel, convertToSdkMessages } = await import("./sdk-runtime.ts");
  const { generateText } = await import("ai");

  const maxRetries = options?.maxRetries ?? 1;
  const schemaText = JSON.stringify(schema, null, 2);

  // Build messages with structured output instruction appended to the last user message
  const augmentedMessages = [...messages];
  const lastUserIdx = augmentedMessages.findLastIndex((m) => m.role === "user");
  if (lastUserIdx !== -1) {
    augmentedMessages[lastUserIdx] = {
      ...augmentedMessages[lastUserIdx],
      content: augmentedMessages[lastUserIdx].content +
        `\n\nIMPORTANT: Respond with ONLY a JSON object matching this schema, wrapped in a \`\`\`json code fence. No other text.\n\nSchema:\n\`\`\`json\n${schemaText}\n\`\`\``,
    };
  }

  let lastError: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const model = await createSdkLanguageModel(spec);

    // On retry, append the validation error as feedback
    const retryMessages = attempt === 0
      ? augmentedMessages
      : [
        ...augmentedMessages,
        {
          role: "user" as const,
          content: `Your previous response had a JSON validation error: ${lastError}\n\nPlease fix the error and respond with ONLY the corrected JSON object in a \`\`\`json code fence.`,
        },
      ];

    const sdkMessages = convertToSdkMessages(retryMessages);
    const { text } = await generateText({
      model,
      messages: sdkMessages,
      ...(options?.temperature != null && { temperature: options.temperature }),
      abortSignal: options?.signal,
    });

    // Extract JSON
    const jsonStr = extractJsonFromResponse(text);
    if (!jsonStr) {
      lastError = "No JSON object found in model response";
      continue;
    }

    // Parse (with repair fallback)
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      try {
        parsed = JSON.parse(repairJson(jsonStr));
      } catch {
        lastError = "Failed to parse JSON from model response";
        continue;
      }
    }

    // Validate
    const validation = validateAgainstSchema(parsed, schema);
    if (!validation.valid) {
      lastError = validation.error;
      continue;
    }

    return parsed;
  }

  throw new RuntimeError(
    `Structured output prompt-based extraction failed after ${maxRetries + 1} attempts: ${lastError}`,
    { code: ProviderErrorCode.REQUEST_FAILED },
  );
}
