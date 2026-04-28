/**
 * Local LLM Utility — fast semantic classification using the guaranteed-local model.
 *
 * Uses ai.chat() SSOT entry point -> Ollama -> local model.
 *
 * Design:
 * - Prompt-based classification (no fine-tuning needed)
 * - JSON output parsing with fallback defaults
 * - ~50-200ms latency (Ollama caches hot models)
 * - Never throws — returns fallback on any error
 */

import { getErrorMessage } from "../../common/utils.ts";
import { TextAccumulator } from "../../common/stream-utils.ts";
import { log } from "../api/log.ts";
import {
  LOCAL_FALLBACK_MODEL_ID,
  resolveLocalFallbackModelId,
} from "./local-fallback.ts";

type LocalChatFailureKind =
  | "disabled"
  | "runtime_error"
  | "empty_response"
  | "parse_failure";

interface LocalChatSuccess {
  ok: true;
  text: string;
}

interface LocalChatFailure {
  ok: false;
  failureKind: LocalChatFailureKind;
  errorMessage: string | null;
}

type LocalChatResult = LocalChatSuccess | LocalChatFailure;

let localChatQueue: Promise<void> = Promise.resolve();

async function withSerializedLocalChat<T>(fn: () => Promise<T>): Promise<T> {
  const previous = localChatQueue;
  let release!: () => void;
  localChatQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

function logLocalChatFailure(
  context: string,
  failure: LocalChatFailure,
): void {
  const suffix = failure.errorMessage ? `: ${failure.errorMessage}` : "";
  const message =
    `[local-llm] ${context} failed (${failure.failureKind})${suffix}`;
  if (
    failure.failureKind === "disabled" ||
    failure.failureKind === "empty_response"
  ) {
    log.debug(message);
    return;
  }
  log.warn(message);
}

async function collectChatResult(
  prompt: string,
  opts: { temperature?: number; maxTokens?: number },
): Promise<LocalChatResult> {
  // The embedded local runtime is a single shared process. Parallel streaming
  // calls can race each other into empty or partial responses, so treat this
  // entry point as single-flight.
  return await withSerializedLocalChat(async () => {
    try {
      const { getPlatform } = await import("../../platform/platform.ts");
      if (getPlatform().env.get("HLVM_DISABLE_AI_AUTOSTART")) {
        return {
          ok: false,
          failureKind: "disabled",
          errorMessage: "HLVM_DISABLE_AI_AUTOSTART is set",
        };
      }
      const { ai } = await import("../api/ai.ts");
      const messages = [{ role: "user" as const, content: prompt }];
      const localFallbackModelId = await resolveLocalFallbackModelId();
      const result = new TextAccumulator();
      for await (
        const token of ai.chat(messages, {
          model: localFallbackModelId,
          temperature: opts.temperature ?? 0,
          maxTokens: opts.maxTokens ?? 64,
        })
      ) {
        result.append(token);
      }
      const text = result.text;
      if (!text.trim()) {
        return {
          ok: false,
          failureKind: "empty_response",
          errorMessage: "Local model returned no text",
        };
      }
      return { ok: true, text };
    } catch (error) {
      return {
        ok: false,
        failureKind: "runtime_error",
        errorMessage: getErrorMessage(error),
      };
    }
  });
}

async function collectClassificationJson(
  context: string,
  prompt: string,
  opts: { temperature?: number; maxTokens?: number },
): Promise<Record<string, unknown> | null> {
  const response = await collectChatResult(prompt, opts);
  if (!response.ok) {
    logLocalChatFailure(context, response);
    return null;
  }
  try {
    const parsed = JSON.parse(extractJson(response.text));
    return typeof parsed === "object" && parsed !== null
      ? parsed as Record<string, unknown>
      : {};
  } catch (error) {
    logLocalChatFailure(context, {
      ok: false,
      failureKind: "parse_failure",
      errorMessage: getErrorMessage(error),
    });
    return null;
  }
}

/** Display name for the local model (derived from SSOT, no hardcoded "Gemma 4"). */
export function getLocalModelDisplayName(): string {
  const rawName = LOCAL_FALLBACK_MODEL_ID.split("/").pop() ?? "local model";
  const baseName = rawName.split(":")[0];
  return baseName.charAt(0).toUpperCase() + baseName.slice(1);
}

/**
 * Public wrapper for the private collectClassificationJson helper. Use this
 * for new ad-hoc classifier-style local-LLM calls (e.g. memory selector)
 * instead of duplicating the prompt/queue/parse plumbing.
 *
 * Returns null on local classifier failure (timeout, runtime error, parse
 * error). Callers should provide a deterministic fallback.
 */
export function classifyJson(
  context: string,
  prompt: string,
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<Record<string, unknown> | null> {
  return collectClassificationJson(context, prompt, opts);
}

/** Classify a user query into task categories using the local LLM. */
export interface TaskClassification {
  isCodeTask: boolean;
  isReasoningTask: boolean;
  needsStructuredOutput: boolean;
}

const CLASSIFY_TASK_PROMPT =
  `Classify this user query. Reply ONLY with a JSON object, no other text.
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

  const parsed = await collectClassificationJson(
    "classifyTask",
    CLASSIFY_TASK_PROMPT + query.slice(0, 500),
    { temperature: 0, maxTokens: 64 },
  );
  if (!parsed) return defaults;
  return {
    isCodeTask: parsed.code === true,
    isReasoningTask: parsed.reasoning === true,
    needsStructuredOutput: parsed.structured === true,
  };
}

// ---- Step 1: Planning Detection ----

export interface PlanNeedClassification {
  needsPlan: boolean;
}

const CLASSIFY_PLAN_NEED_PROMPT =
  `Does this request need a multi-step plan? Reply ONLY with JSON.
{"plan":true/false}
- true: multiple distinct steps, sequential phases, complex enough for upfront planning
- false: single question, simple lookup, one-step task
Request: `;

export async function classifyPlanNeed(
  query: string,
): Promise<PlanNeedClassification> {
  const defaults: PlanNeedClassification = { needsPlan: false };
  if (!query.trim()) return defaults;
  const parsed = await collectClassificationJson(
    "classifyPlanNeed",
    CLASSIFY_PLAN_NEED_PROMPT + query.slice(0, 500),
    { temperature: 0, maxTokens: 64 },
  );
  if (!parsed) return defaults;
  return { needsPlan: parsed.plan === true };
}

export interface RequestPhaseClassification {
  phase: "editing" | "verifying" | "researching" | "completing";
}

const CLASSIFY_REQUEST_PHASE_PROMPT =
  `Classify the user's request by the agent's most likely first working phase. Reply ONLY with JSON.
{"phase":"editing"|"verifying"|"researching"|"completing"}
- "editing": modify or create files, code, config, docs, or content
- "verifying": test, validate, check, build, compile, or confirm results
- "researching": inspect, read, search, explain, browse, compare, or investigate
- "completing": operational wrap-up, shell/git execution, listing, status, or finalization
Pick exactly one phase.
Request: `;

function fallbackRequestPhase(
  query: string,
): RequestPhaseClassification["phase"] {
  if (
    /\b(fix|edit|write|change|implement|refactor|rename|update|patch|add|remove)\b/i
      .test(query)
  ) {
    return "editing";
  }
  if (
    /\b(test|verify|validation|validate|check|build|compile|run)\b/i.test(
      query,
    )
  ) {
    return "verifying";
  }
  return "researching";
}

export async function classifyRequestPhase(
  query: string,
): Promise<RequestPhaseClassification> {
  const defaults: RequestPhaseClassification = {
    phase: fallbackRequestPhase(query),
  };
  if (!query.trim()) return defaults;
  const parsed = await collectClassificationJson(
    "classifyRequestPhase",
    CLASSIFY_REQUEST_PHASE_PROMPT + query.slice(0, 500),
    { temperature: 0, maxTokens: 64 },
  );
  if (!parsed) return defaults;
  const phase = parsed.phase;
  return {
    phase:
      phase === "editing" || phase === "verifying" ||
        phase === "researching" || phase === "completing"
        ? phase
        : defaults.phase,
  };
}

// ---- Step 4: Memory Fact Conflict Scoring (Batch) ----

export interface FactConflictClassification {
  conflicts: Array<{ index: number; score: number }>;
}

const CLASSIFY_FACT_CONFLICTS_PROMPT =
  `Rate conflict between a NEW fact and EXISTING facts. Reply ONLY with JSON.
{"conflicts":[{"i":0,"s":0.8}]}
- "i": index, "s": 0.0 (unrelated) to 1.0 (contradicts/supersedes). Only include s > 0.3.
New: `;

export async function classifyFactConflicts(
  newFact: string,
  existingFacts: string[],
): Promise<FactConflictClassification> {
  const defaults: FactConflictClassification = { conflicts: [] };
  if (!newFact.trim() || existingFacts.length === 0) return defaults;
  const list = existingFacts.map((f, i) => `${i}. ${f.slice(0, 100)}`).join(
    "\n",
  );
  const prompt = CLASSIFY_FACT_CONFLICTS_PROMPT + newFact.slice(0, 200) +
    "\nExisting:\n" + list;
  const parsed = await collectClassificationJson(
    "classifyFactConflicts",
    prompt,
    { temperature: 0, maxTokens: 256 },
  );
  if (!parsed) return defaults;
  const conflicts = Array.isArray(parsed.conflicts)
    ? parsed.conflicts
      .filter((c: { i?: number; s?: number }) =>
        typeof c.i === "number" && typeof c.s === "number" && c.s > 0.3
      )
      .map((c: { i: number; s: number }) => ({ index: c.i, score: c.s }))
    : [];
  return { conflicts };
}

// ---- Step 5: Grounding Verification ----

export interface GroundednessClassification {
  incorporatesData: boolean;
}

const CLASSIFY_GROUNDEDNESS_PROMPT =
  `Does this response use specific data from the tool results? Reply ONLY with JSON.
{"grounded":true/false}
- true: response references numbers, names, paths, or facts from the tool output
- false: response is generic or fabricated, not based on tool data
Response (tail): `;

export async function classifyGroundedness(
  responseTail: string,
  toolSummaries: string,
): Promise<GroundednessClassification> {
  const defaults: GroundednessClassification = { incorporatesData: false };
  if (!responseTail.trim()) return defaults;
  const prompt = CLASSIFY_GROUNDEDNESS_PROMPT + responseTail.slice(-400) +
    "\nTool data (summary): " + toolSummaries.slice(0, 500);
  const parsed = await collectClassificationJson(
    "classifyGroundedness",
    prompt,
    { temperature: 0, maxTokens: 64 },
  );
  if (!parsed) return defaults;
  return { incorporatesData: parsed.grounded === true };
}

// ---- Step 10: Source Authority Classification (Batch) ----

export interface BatchSourceClassification {
  results: Array<{ index: number; sourceClass: string }>;
}

const CLASSIFY_SOURCES_PROMPT =
  `Classify each search result by source type. Reply ONLY with JSON.
{"r":[{"i":0,"s":"official_docs"},{"i":1,"s":"forum"}]}
Types: official_docs, vendor_docs, repo_docs, technical_article, forum, other
Results:
`;

export async function classifySourceAuthorities(
  results: Array<{ url: string; title: string; snippet: string }>,
): Promise<BatchSourceClassification> {
  const defaults: BatchSourceClassification = { results: [] };
  if (results.length === 0) return defaults;
  const list = results.map((r, i) =>
    `${i}. ${r.url} | ${r.title} | ${r.snippet?.slice(0, 80)}`
  ).join("\n");
  const parsed = await collectClassificationJson(
    "classifySourceAuthorities",
    CLASSIFY_SOURCES_PROMPT + list,
    { temperature: 0, maxTokens: 256 },
  );
  if (!parsed) return defaults;
  const validTypes = [
    "official_docs",
    "vendor_docs",
    "repo_docs",
    "technical_article",
    "forum",
    "other",
  ];
  const classified = Array.isArray(parsed.r)
    ? parsed.r
      .filter((r: { i?: number; s?: string }) =>
        typeof r.i === "number" && typeof r.s === "string"
      )
      .map((r: { i: number; s: string }) => ({
        index: r.i,
        sourceClass: validTypes.includes(r.s) ? r.s : "other",
      }))
    : [];
  return { results: classified };
}

// ---- Step 18: Browser Final Answer Adequacy ----

export interface BrowserFinalAnswerClassification {
  isComplete: boolean;
  missing: string | null;
}

const CLASSIFY_BROWSER_FINAL_ANSWER_PROMPT =
  `Does the assistant response fully answer the user's browser task? Reply ONLY with JSON, no other text.
{"complete":true/false,"missing":"short missing piece" or null}

- true: directly answers the user's request with the requested facts/artifacts
- false: still process chatter, partial answer, or missing requested outputs

User request:
`;

export async function classifyBrowserFinalAnswer(
  userRequest: string,
  response: string,
): Promise<BrowserFinalAnswerClassification> {
  if (!response.trim()) {
    return { isComplete: false, missing: "No final browser answer provided." };
  }
  const defaults: BrowserFinalAnswerClassification = {
    isComplete: false,
    missing: null,
  };
  const prompt = `${CLASSIFY_BROWSER_FINAL_ANSWER_PROMPT}${
    userRequest.slice(0, 500)
  }

Assistant response:
${response.slice(0, 1_200)}`;
  const parsed = await collectClassificationJson(
    "classifyBrowserFinalAnswer",
    prompt,
    { temperature: 0, maxTokens: 96 },
  );
  if (!parsed) return defaults;
  return {
    isComplete: parsed.complete !== false,
    missing: typeof parsed.missing === "string" && parsed.missing.trim()
      ? parsed.missing.trim()
      : null,
  };
}

// ---- Helpers ----

/** Collect ai.chat() async generator into a single string. Fail closed on any error.
 *  Returns "" immediately when HLVM_DISABLE_AI_AUTOSTART is set (unit test mode). */
export async function collectChat(
  prompt: string,
  opts: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const result = await collectChatResult(prompt, opts);
  if (!result.ok) {
    logLocalChatFailure("collectChat", result);
    return "";
  }
  return result.text;
}

/** Extract the first JSON object from a string (handles nested braces, markdown fences, preamble). */
export function extractJson(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) return "{}";
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "{}";
}

/** Classify whether a tool call is safe to auto-approve via local LLM.
 *  Returns { safe: false } on any failure — caller falls through to user prompt. */
export async function classifyToolSafety(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ safe: boolean; reason: string }> {
  let argsPreview = "[unserializable args]";
  try {
    argsPreview = JSON.stringify(args).slice(0, 500);
  } catch {
    // Keep fail-closed behavior for non-serializable arguments.
  }
  const parsed = await collectClassificationJson(
    "classifyToolSafety",
    `Tool: ${toolName}\nArgs: ${argsPreview}\n` +
      `Is this safe to auto-approve? Consider: file mutations, destructive shell commands, ` +
      `network access to unknown hosts, credential exposure.\n` +
      `JSON: { "safe": true/false, "reason": "brief" }`,
    { temperature: 0, maxTokens: 128 },
  );
  if (!parsed) {
    return { safe: false, reason: "classification failed" };
  }
  return { safe: !!parsed.safe, reason: String(parsed.reason ?? "") };
}
