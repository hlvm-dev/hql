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

// ---- Step 1: Planning Detection ----

export interface PlanNeedClassification { needsPlan: boolean; }

const CLASSIFY_PLAN_NEED_PROMPT = `Does this request need a multi-step plan? Reply ONLY with JSON.
{"plan":true/false}
- true: multiple distinct steps, sequential phases, complex enough for upfront planning
- false: single question, simple lookup, one-step task
Request: `;

export async function classifyPlanNeed(query: string): Promise<PlanNeedClassification> {
  const defaults: PlanNeedClassification = { needsPlan: false };
  if (!query.trim()) return defaults;
  try {
    const response = await collectChat(
      CLASSIFY_PLAN_NEED_PROMPT + query.slice(0, 500),
      { temperature: 0, maxTokens: 64 },
    );
    const parsed = JSON.parse(extractJson(response));
    return { needsPlan: parsed.plan === true };
  } catch { return defaults; }
}

// ---- Step 2: Delegation Detection ----

export interface DelegationClassification {
  shouldDelegate: boolean;
  pattern: "fan-out" | "batch" | "sequential" | "none";
}

const CLASSIFY_DELEGATION_PROMPT = `Should this task be split into subtasks for parallel agents? Reply ONLY with JSON.
{"delegate":true/false,"pattern":"fan-out"|"batch"|"sequential"|"none"}
- "delegate": true if task involves parallel work, batch operations, or multiple independent subtasks
- "pattern": "fan-out" parallel independent, "batch" same op across many targets, "sequential" ordered, "none" no delegation
Request: `;

export async function classifyDelegation(query: string): Promise<DelegationClassification> {
  const defaults: DelegationClassification = { shouldDelegate: false, pattern: "none" };
  if (!query.trim()) return defaults;
  try {
    const response = await collectChat(
      CLASSIFY_DELEGATION_PROMPT + query.slice(0, 500),
      { temperature: 0, maxTokens: 64 },
    );
    const parsed = JSON.parse(extractJson(response));
    const pattern = ["fan-out", "batch", "sequential", "none"].includes(parsed.pattern)
      ? parsed.pattern as DelegationClassification["pattern"]
      : "none";
    return { shouldDelegate: parsed.delegate === true, pattern };
  } catch { return defaults; }
}

// ---- Step 3: Tool Instruction Detection ----

export interface ToolInstructionClassification { isInstruction: boolean; }

const CLASSIFY_TOOL_INSTRUCTION_PROMPT = `Is this text instructing how to invoke a tool/function, rather than answering a question? Reply ONLY with JSON.
{"instruction":true/false}
- true: text is telling the reader to call a tool, make a function call, or use JSON to invoke something
- false: normal answer, explanation, code example, or conversation
Text: `;

export async function classifyToolInstruction(text: string): Promise<ToolInstructionClassification> {
  const defaults: ToolInstructionClassification = { isInstruction: false };
  if (!text.trim()) return defaults;
  try {
    const response = await collectChat(
      CLASSIFY_TOOL_INSTRUCTION_PROMPT + text.slice(0, 500),
      { temperature: 0, maxTokens: 64 },
    );
    const parsed = JSON.parse(extractJson(response));
    return { isInstruction: parsed.instruction === true };
  } catch { return defaults; }
}

// ---- Step 4: Memory Fact Conflict Scoring (Batch) ----

export interface FactConflictClassification {
  conflicts: Array<{ index: number; score: number }>;
}

const CLASSIFY_FACT_CONFLICTS_PROMPT = `Rate conflict between a NEW fact and EXISTING facts. Reply ONLY with JSON.
{"conflicts":[{"i":0,"s":0.8}]}
- "i": index, "s": 0.0 (unrelated) to 1.0 (contradicts/supersedes). Only include s > 0.3.
New: `;

export async function classifyFactConflicts(
  newFact: string,
  existingFacts: string[],
): Promise<FactConflictClassification> {
  const defaults: FactConflictClassification = { conflicts: [] };
  if (!newFact.trim() || existingFacts.length === 0) return defaults;
  try {
    const list = existingFacts.map((f, i) => `${i}. ${f.slice(0, 100)}`).join("\n");
    const prompt = CLASSIFY_FACT_CONFLICTS_PROMPT + newFact.slice(0, 200) + "\nExisting:\n" + list;
    const response = await collectChat(prompt, { temperature: 0, maxTokens: 256 });
    const parsed = JSON.parse(extractJson(response));
    const conflicts = Array.isArray(parsed.conflicts)
      ? parsed.conflicts
          .filter((c: { i?: number; s?: number }) => typeof c.i === "number" && typeof c.s === "number" && c.s > 0.3)
          .map((c: { i: number; s: number }) => ({ index: c.i, score: c.s }))
      : [];
    return { conflicts };
  } catch { return defaults; }
}

// ---- Step 5: Grounding Verification ----

export interface GroundednessClassification { incorporatesData: boolean; }

const CLASSIFY_GROUNDEDNESS_PROMPT = `Does this response use specific data from the tool results? Reply ONLY with JSON.
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
  try {
    const prompt = CLASSIFY_GROUNDEDNESS_PROMPT + responseTail.slice(-400) +
      "\nTool data (summary): " + toolSummaries.slice(0, 500);
    const response = await collectChat(prompt, { temperature: 0, maxTokens: 64 });
    const parsed = JSON.parse(extractJson(response));
    return { incorporatesData: parsed.grounded === true };
  } catch { return defaults; }
}

// ---- Step 6: Search Intent Classification ----

export interface SearchIntentClassification {
  officialDocs: boolean;
  comparison: boolean;
  recency: boolean;
  versionSpecific: boolean;
  releaseNotes: boolean;
  reference: boolean;
}

const CLASSIFY_SEARCH_INTENT_PROMPT = `Classify search query intent. Reply ONLY with JSON.
{"docs":true/false,"cmp":true/false,"recent":true/false,"ver":true/false,"rel":true/false,"ref":true/false}
- "docs": wants official documentation. "cmp": wants to compare alternatives. "recent": wants latest info.
- "ver": wants specific version info. "rel": wants release notes/changelog. "ref": wants API reference/spec.
Query: `;

export async function classifySearchIntent(query: string): Promise<SearchIntentClassification> {
  const defaults: SearchIntentClassification = {
    officialDocs: false, comparison: false, recency: false,
    versionSpecific: false, releaseNotes: false, reference: false,
  };
  if (!query.trim()) return defaults;
  try {
    const response = await collectChat(
      CLASSIFY_SEARCH_INTENT_PROMPT + query.slice(0, 300),
      { temperature: 0, maxTokens: 64 },
    );
    const parsed = JSON.parse(extractJson(response));
    return {
      officialDocs: parsed.docs === true,
      comparison: parsed.cmp === true,
      recency: parsed.recent === true,
      versionSpecific: parsed.ver === true,
      releaseNotes: parsed.rel === true,
      reference: parsed.ref === true,
    };
  } catch { return defaults; }
}

// ---- Step 7: Error Classification ----

export interface ErrorClassification {
  errorClass: "rate_limit" | "timeout" | "context_overflow" | "auth" | "transient" | "permanent" | "unknown";
}

const CLASSIFY_ERROR_PROMPT = `Classify this error message. Reply ONLY with JSON.
{"class":"rate_limit"|"timeout"|"context_overflow"|"auth"|"transient"|"permanent"|"unknown"}
- rate_limit: quota/request limits. timeout: time exceeded. context_overflow: token/prompt too long.
- auth: invalid key/credentials. transient: network/temporary. permanent: invalid request/params.
Error: `;

export async function classifyErrorMessage(message: string): Promise<ErrorClassification> {
  const defaults: ErrorClassification = { errorClass: "unknown" };
  if (!message.trim()) return defaults;
  try {
    const response = await collectChat(
      CLASSIFY_ERROR_PROMPT + message.slice(0, 400),
      { temperature: 0, maxTokens: 64 },
    );
    const parsed = JSON.parse(extractJson(response));
    const valid = ["rate_limit", "timeout", "context_overflow", "auth", "transient", "permanent", "unknown"];
    return { errorClass: valid.includes(parsed.class) ? parsed.class : "unknown" };
  } catch { return defaults; }
}

// ---- Step 8: Recovery Hint Generation ----

const SUGGEST_RECOVERY_PROMPT = `Given this tool error, suggest one short actionable recovery hint for an AI agent. Reply ONLY with JSON.
{"hint":"one sentence" or null}
- If clear fix: suggest it (check path, fix argument, use different tool, retry)
- If no clear fix: return null
Error: `;

export async function suggestRecoveryHint(errorMessage: string): Promise<string | null> {
  if (!errorMessage.trim()) return null;
  try {
    const response = await collectChat(
      SUGGEST_RECOVERY_PROMPT + errorMessage.slice(0, 400),
      { temperature: 0, maxTokens: 80 },
    );
    const parsed = JSON.parse(extractJson(response));
    return typeof parsed.hint === "string" ? parsed.hint : null;
  } catch { return null; }
}

// ---- Step 9: Sensitive Content Detection (Supplementary) ----

export interface SensitiveContentClassification {
  additionalPII: boolean;
  types: string[];
}

const CLASSIFY_SENSITIVE_PROMPT = `Does this text contain sensitive personal information NOT already [REDACTED]? Reply ONLY with JSON.
{"pii":true/false,"types":["phone","email","address"]}
- Look for: phone numbers, emails, physical addresses, DOB, medical info, financial data
- Ignore anything already marked [REDACTED:...]
- Return empty types array if nothing found
Text: `;

export async function classifySensitiveContent(text: string): Promise<SensitiveContentClassification> {
  const defaults: SensitiveContentClassification = { additionalPII: false, types: [] };
  if (!text.trim()) return defaults;
  try {
    const response = await collectChat(
      CLASSIFY_SENSITIVE_PROMPT + text.slice(0, 500),
      { temperature: 0, maxTokens: 64 },
    );
    const parsed = JSON.parse(extractJson(response));
    const types = Array.isArray(parsed.types) ? parsed.types.filter((t: unknown) => typeof t === "string") : [];
    return { additionalPII: parsed.pii === true, types };
  } catch { return defaults; }
}

// ---- Step 10: Source Authority Classification (Batch) ----

export interface BatchSourceClassification {
  results: Array<{ index: number; sourceClass: string }>;
}

const CLASSIFY_SOURCES_PROMPT = `Classify each search result by source type. Reply ONLY with JSON.
{"r":[{"i":0,"s":"official_docs"},{"i":1,"s":"forum"}]}
Types: official_docs, vendor_docs, repo_docs, technical_article, forum, other
Results:
`;

export async function classifySourceAuthorities(
  results: Array<{ url: string; title: string; snippet: string }>,
): Promise<BatchSourceClassification> {
  const defaults: BatchSourceClassification = { results: [] };
  if (results.length === 0) return defaults;
  try {
    const list = results.map((r, i) => `${i}. ${r.url} | ${r.title} | ${r.snippet?.slice(0, 80)}`).join("\n");
    const response = await collectChat(
      CLASSIFY_SOURCES_PROMPT + list,
      { temperature: 0, maxTokens: 256 },
    );
    const parsed = JSON.parse(extractJson(response));
    const validTypes = ["official_docs", "vendor_docs", "repo_docs", "technical_article", "forum", "other"];
    const classified = Array.isArray(parsed.r)
      ? parsed.r
          .filter((r: { i?: number; s?: string }) => typeof r.i === "number" && typeof r.s === "string")
          .map((r: { i: number; s: string }) => ({
            index: r.i,
            sourceClass: validTypes.includes(r.s) ? r.s : "other",
          }))
      : [];
    return { results: classified };
  } catch { return defaults; }
}

// ---- Helpers ----

/** Collect ai.chat() async generator into a single string. */
export async function collectChat(
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
