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
import { jsonrepair as jsonrepairLib } from "jsonrepair";
import ajvModule from "ajv";

type PromptFallbackDeps = {
  createSdkLanguageModel: typeof import("./sdk-runtime.ts").createSdkLanguageModel;
  convertToSdkMessages: typeof import("./sdk-runtime.ts").convertToSdkMessages;
  generateText: typeof import("ai").generateText;
};

let promptFallbackDepsForTesting: Partial<PromptFallbackDeps> | null = null;

async function getPromptFallbackDeps(): Promise<PromptFallbackDeps> {
  const sdkRuntime = await import("./sdk-runtime.ts");
  const aiSdk = await import("ai");
  return {
    createSdkLanguageModel: promptFallbackDepsForTesting?.createSdkLanguageModel ??
      sdkRuntime.createSdkLanguageModel,
    convertToSdkMessages: promptFallbackDepsForTesting?.convertToSdkMessages ??
      sdkRuntime.convertToSdkMessages,
    generateText: promptFallbackDepsForTesting?.generateText ?? aiSdk.generateText,
  };
}

export function __setStructuredOutputFallbackDepsForTesting(
  overrides: Partial<PromptFallbackDeps> | null,
): void {
  promptFallbackDepsForTesting = overrides;
}

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
  try {
    return jsonrepairLib(raw);
  } catch {
    return raw; // Preserve never-throw contract
  }
}

// ============================================================================
// Schema validation (Ajv-backed)
// ============================================================================

// deno-lint-ignore no-explicit-any
const AjvConstructor = (ajvModule as any).default ?? ajvModule;
const ajv = new AjvConstructor({ allErrors: false, strict: false });

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Validate a parsed value against a JSON Schema using Ajv. */
export function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
): ValidationResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, error: "Expected a JSON object, got " + typeof value };
  }

  // Strip null/undefined values to preserve current lenient behavior
  const obj = value as Record<string, unknown>;
  const cleaned = Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v != null),
  );

  const validate = ajv.compile(schema);
  if (validate(cleaned)) return { valid: true };

  const err = validate.errors?.[0];
  if (!err) return { valid: false, error: "Validation failed" };

  if (err.keyword === "required") {
    return { valid: false, error: `Missing required key: "${err.params.missingProperty}"` };
  }
  if (err.keyword === "type") {
    const key = err.instancePath.replace(/^\//, "");
    const actualValue = obj[key];
    const actualType = Array.isArray(actualValue) ? "array" : typeof actualValue;
    return { valid: false, error: `Key "${key}": expected ${err.params.type}, got ${actualType}` };
  }

  return { valid: false, error: err.message ?? "Validation failed" };
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
  const deps = await getPromptFallbackDeps();

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
    const model = await deps.createSdkLanguageModel(spec);

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

    const sdkMessages = deps.convertToSdkMessages(retryMessages);
    const { text } = await deps.generateText({
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
