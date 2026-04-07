/**
 * Local LLM Utility — fast classification using the guaranteed-local model.
 *
 * Replaces regex heuristics with semantic LLM classification.
 * Uses ai.chat() SSOT entry point -> Ollama -> local model.
 *
 * Design:
 * - Prompt-based classification (no fine-tuning needed)
 * - JSON output parsing with fallback defaults
 * - ~50-200ms latency (Ollama caches hot models)
 * - Never throws — returns fallback on any error
 */

import { LOCAL_FALLBACK_MODEL_ID } from "./local-fallback.ts";

/** Display name for the local model (derived from SSOT, no hardcoded "Gemma 4"). */
export function getLocalModelDisplayName(): string {
  const rawName = LOCAL_FALLBACK_MODEL_ID.split("/").pop() ?? "local model";
  const baseName = rawName.split(":")[0];
  return baseName.charAt(0).toUpperCase() + baseName.slice(1);
}

/** Classify a user query into task categories using the local LLM. */
export interface TaskClassification {
  isCodeTask: boolean;
  isReasoningTask: boolean;
  needsStructuredOutput: boolean;
}

const CLASSIFY_TASK_PROMPT = `Classify this user query. Reply ONLY with a JSON object, no other text.
{"code":true/false,"reasoning":true/false,"structured":true/false}

- "code": query is about writing, debugging, reviewing, or understanding code
- "reasoning": query requires math, logic, analysis, step-by-step thinking, or complex comparison
- "structured": query asks for output in a specific format (JSON, CSV, table, YAML, XML, schema)

Query: `;

export async function classifyTask(query: string): Promise<TaskClassification> {
  const defaults: TaskClassification = {
    isCodeTask: false,
    isReasoningTask: false,
    needsStructuredOutput: false,
  };
  if (!query.trim()) return defaults;

  try {
    const response = await collectChat(
      CLASSIFY_TASK_PROMPT + query.slice(0, 500),
      { temperature: 0, maxTokens: 64 },
    );
    const parsed = JSON.parse(extractJson(response));
    return {
      isCodeTask: parsed.code === true,
      isReasoningTask: parsed.reasoning === true,
      needsStructuredOutput: parsed.structured === true,
    };
  } catch {
    return defaults;
  }
}

/** Classify whether a response asks a follow-up question. */
export interface FollowUpClassification {
  asksFollowUp: boolean;
  isBinaryQuestion: boolean;
  isGenericConversational: boolean;
}

const CLASSIFY_FOLLOWUP_PROMPT = `Does this assistant response end by asking the user a question? Reply ONLY with JSON, no other text.
{"asks":true/false,"binary":true/false,"generic":true/false}

- "asks": response ends with a question directed at the user
- "binary": the question is a yes/no question (e.g. "would you like me to...", "should I...")
- "generic": the question is generic filler (e.g. "anything else I can help with?")

Response: `;

export async function classifyFollowUp(response: string): Promise<FollowUpClassification> {
  const defaults: FollowUpClassification = {
    asksFollowUp: false,
    isBinaryQuestion: false,
    isGenericConversational: false,
  };
  if (!response.trim()) return defaults;

  try {
    const result = await collectChat(
      CLASSIFY_FOLLOWUP_PROMPT + response.slice(-800),
      { temperature: 0, maxTokens: 64 },
    );
    const parsed = JSON.parse(extractJson(result));
    return {
      asksFollowUp: parsed.asks === true,
      isBinaryQuestion: parsed.binary === true,
      isGenericConversational: parsed.generic === true,
    };
  } catch {
    return defaults;
  }
}

/** Classify whether an assistant response asks a question or needs a concrete task. */
export interface ResponseIntentClassification {
  asksQuestion: boolean;
  needsConcreteTask: boolean;
}

const CLASSIFY_RESPONSE_INTENT_PROMPT = `Analyze this assistant response. Reply ONLY with JSON, no other text.
{"asks":true/false,"needs_task":true/false}

- "asks": response ends by asking the user a question (not rhetorical, not in code)
- "needs_task": response says it needs a concrete task, more specific instructions, or cannot act on the current request

Response: `;

export async function classifyResponseIntent(response: string): Promise<ResponseIntentClassification> {
  const defaults: ResponseIntentClassification = {
    asksQuestion: false,
    needsConcreteTask: false,
  };
  if (!response.trim()) return defaults;

  try {
    const result = await collectChat(
      CLASSIFY_RESPONSE_INTENT_PROMPT + response.slice(-800),
      { temperature: 0, maxTokens: 64 },
    );
    const parsed = JSON.parse(extractJson(result));
    return {
      asksQuestion: parsed.asks === true,
      needsConcreteTask: parsed.needs_task === true,
    };
  } catch {
    return defaults;
  }
}

// ---- Internal helpers ----

/** Collect ai.chat() async generator into a single string. */
async function collectChat(
  prompt: string,
  opts: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const { ai } = await import("../api/ai.ts");
  const messages = [{ role: "user" as const, content: prompt }];
  let result = "";
  for await (const token of ai.chat(messages, {
    model: LOCAL_FALLBACK_MODEL_ID,
    temperature: opts.temperature ?? 0,
    maxTokens: opts.maxTokens ?? 64,
  })) {
    result += token;
  }
  return result;
}

/** Extract the first JSON object from a string (handles markdown fences, preamble). */
export function extractJson(text: string): string {
  const match = text.match(/\{[^}]+\}/);
  return match ? match[0] : "{}";
}
