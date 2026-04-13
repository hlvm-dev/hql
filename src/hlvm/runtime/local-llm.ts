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
  try {
    const response = await collectChat(
      CLASSIFY_PLAN_NEED_PROMPT + query.slice(0, 500),
      { temperature: 0, maxTokens: 64 },
    );
    const parsed = JSON.parse(extractJson(response));
    return { needsPlan: parsed.plan === true };
  } catch {
    return defaults;
  }
}

// ---- Step 2: Delegation Detection ----

export interface DelegationClassification {
  shouldDelegate: boolean;
  pattern: "fan-out" | "batch" | "sequential" | "none";
}

const CLASSIFY_DELEGATION_PROMPT =
  `Should this task be split into subtasks for parallel agents? Reply ONLY with JSON.
{"delegate":true/false,"pattern":"fan-out"|"batch"|"sequential"|"none"}
- "delegate": true if task involves parallel work, batch operations, or multiple independent subtasks
- "pattern": "fan-out" parallel independent, "batch" same op across many targets, "sequential" ordered, "none" no delegation
Request: `;

export async function classifyDelegation(
  query: string,
): Promise<DelegationClassification> {
  const defaults: DelegationClassification = {
    shouldDelegate: false,
    pattern: "none",
  };
  if (!query.trim()) return defaults;
  try {
    const response = await collectChat(
      CLASSIFY_DELEGATION_PROMPT + query.slice(0, 500),
      { temperature: 0, maxTokens: 64 },
    );
    const parsed = JSON.parse(extractJson(response));
    const pattern =
      ["fan-out", "batch", "sequential", "none"].includes(parsed.pattern)
        ? parsed.pattern as DelegationClassification["pattern"]
        : "none";
    return { shouldDelegate: parsed.delegate === true, pattern };
  } catch {
    return defaults;
  }
}

export interface AllClassification {
  isBrowser: boolean;
  shouldDelegate: boolean;
  delegatePattern: "fan-out" | "batch" | "sequential" | "none";
  needsPlan: boolean;
  taskClassification: TaskClassification;
}

const CLASSIFY_ALL_PROMPT =
  `Classify this user request. Reply ONLY with JSON, no other text.
{"browser":true/false,"delegate":true/false,"pattern":"fan-out"|"batch"|"sequential"|"none","plan":true/false,"code":true/false,"reasoning":true/false,"structured":true/false}

- "browser": request involves interacting with a web browser, website, or web page
- "delegate": task should be split into parallel subtasks for multiple agents
- "pattern": "fan-out" parallel independent, "batch" same op across targets, "sequential" ordered, "none"
- "plan": request needs multi-step planning (sequential phases, complex enough for upfront plan)
- "code": about writing, debugging, reviewing, or understanding code
- "reasoning": requires math, logic, analysis, or step-by-step thinking
- "structured": asks for specific output format (JSON, CSV, table, YAML, XML, schema)

Request: `;

export async function classifyAll(query: string): Promise<AllClassification> {
  const defaults: AllClassification = {
    isBrowser: false,
    shouldDelegate: false,
    delegatePattern: "none",
    needsPlan: false,
    taskClassification: {
      isCodeTask: false,
      isReasoningTask: false,
      needsStructuredOutput: false,
    },
  };
  if (!query.trim()) return defaults;

  try {
    const response = await collectChat(
      CLASSIFY_ALL_PROMPT + query.slice(0, 500),
      { temperature: 0, maxTokens: 128 },
    );
    const parsed = JSON.parse(extractJson(response));
    const delegatePattern =
      ["fan-out", "batch", "sequential", "none"].includes(parsed.pattern)
        ? parsed.pattern as AllClassification["delegatePattern"]
        : "none";
    return {
      isBrowser: parsed.browser === true,
      shouldDelegate: parsed.delegate === true,
      delegatePattern,
      needsPlan: parsed.plan === true,
      taskClassification: {
        isCodeTask: parsed.code === true,
        isReasoningTask: parsed.reasoning === true,
        needsStructuredOutput: parsed.structured === true,
      },
    };
  } catch {
    return defaults;
  }
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
  try {
    const list = existingFacts.map((f, i) => `${i}. ${f.slice(0, 100)}`).join(
      "\n",
    );
    const prompt = CLASSIFY_FACT_CONFLICTS_PROMPT + newFact.slice(0, 200) +
      "\nExisting:\n" + list;
    const response = await collectChat(prompt, {
      temperature: 0,
      maxTokens: 256,
    });
    const parsed = JSON.parse(extractJson(response));
    const conflicts = Array.isArray(parsed.conflicts)
      ? parsed.conflicts
        .filter((c: { i?: number; s?: number }) =>
          typeof c.i === "number" && typeof c.s === "number" && c.s > 0.3
        )
        .map((c: { i: number; s: number }) => ({ index: c.i, score: c.s }))
      : [];
    return { conflicts };
  } catch {
    return defaults;
  }
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
  try {
    const prompt = CLASSIFY_GROUNDEDNESS_PROMPT + responseTail.slice(-400) +
      "\nTool data (summary): " + toolSummaries.slice(0, 500);
    const response = await collectChat(prompt, {
      temperature: 0,
      maxTokens: 64,
    });
    const parsed = JSON.parse(extractJson(response));
    return { incorporatesData: parsed.grounded === true };
  } catch {
    return defaults;
  }
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
  try {
    const list = results.map((r, i) =>
      `${i}. ${r.url} | ${r.title} | ${r.snippet?.slice(0, 80)}`
    ).join("\n");
    const response = await collectChat(
      CLASSIFY_SOURCES_PROMPT + list,
      { temperature: 0, maxTokens: 256 },
    );
    const parsed = JSON.parse(extractJson(response));
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
  } catch {
    return defaults;
  }
}

// ---- Step 17: Browser Automation Classification ----

export interface BrowserAutomationClassification {
  isBrowserTask: boolean;
}

const CLASSIFY_BROWSER_AUTOMATION_PROMPT =
  `Is this user request asking to interact with a web browser, website, or web page? Reply ONLY with JSON, no other text.
{"browser":true/false}

- true: wants to navigate, click, fill forms, scrape, download from a site, visit a URL, use a browser
- false: code task, file task, general question, system task not involving a browser

Request: `;

export async function classifyBrowserAutomation(
  request: string,
): Promise<BrowserAutomationClassification> {
  const defaults: BrowserAutomationClassification = { isBrowserTask: false };
  if (!request.trim()) return defaults;
  try {
    const response = await collectChat(
      CLASSIFY_BROWSER_AUTOMATION_PROMPT + request.slice(0, 500),
      { temperature: 0, maxTokens: 64 },
    );
    const parsed = JSON.parse(extractJson(response));
    return { isBrowserTask: parsed.browser === true };
  } catch {
    return defaults;
  }
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
  try {
    const prompt = `${CLASSIFY_BROWSER_FINAL_ANSWER_PROMPT}${
      userRequest.slice(0, 500)
    }

Assistant response:
${response.slice(0, 1_200)}`;
    const raw = await collectChat(prompt, {
      temperature: 0,
      maxTokens: 96,
    });
    const parsed = JSON.parse(extractJson(raw));
    return {
      isComplete: parsed.complete !== false,
      missing: typeof parsed.missing === "string" && parsed.missing.trim()
        ? parsed.missing.trim()
        : null,
    };
  } catch {
    return defaults;
  }
}

// ---- Helpers ----

/** Collect ai.chat() async generator into a single string. Fail closed on any error.
 *  Returns "" immediately when HLVM_DISABLE_AI_AUTOSTART is set (unit test mode). */
export async function collectChat(
  prompt: string,
  opts: { temperature?: number; maxTokens?: number },
): Promise<string> {
  try {
    const { getPlatform } = await import("../../platform/platform.ts");
    if (getPlatform().env.get("HLVM_DISABLE_AI_AUTOSTART")) return "";
    const { ai } = await import("../api/ai.ts");
    const messages = [{ role: "user" as const, content: prompt }];
    let result = "";
    for await (
      const token of ai.chat(messages, {
        model: LOCAL_FALLBACK_MODEL_ID,
        temperature: opts.temperature ?? 0,
        maxTokens: opts.maxTokens ?? 64,
      })
    ) {
      result += token;
    }
    return result;
  } catch {
    return "";
  }
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
  const argsPreview = JSON.stringify(args).slice(0, 500);
  const response = await collectChat(
    `Tool: ${toolName}\nArgs: ${argsPreview}\n` +
      `Is this safe to auto-approve? Consider: file mutations, destructive shell commands, ` +
      `network access to unknown hosts, credential exposure.\n` +
      `JSON: { "safe": true/false, "reason": "brief" }`,
    { temperature: 0, maxTokens: 128 },
  );
  try {
    const raw = extractJson(response);
    const parsed = JSON.parse(raw);
    return { safe: !!parsed?.safe, reason: String(parsed?.reason ?? "") };
  } catch {
    return { safe: false, reason: "classification failed" };
  }
}
