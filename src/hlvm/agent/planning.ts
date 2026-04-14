/**
 * Planning - Structured plan generation and step tracking
 *
 * Provides a minimal, deterministic planning layer for the agent loop:
 * - Request a JSON plan from the LLM (no tools)
 * - Parse/validate plan structure
 * - Track step completion via STEP_DONE markers
 */

import { ValidationError } from "../../common/error.ts";
import { getErrorMessage, isObjectValue } from "../../common/utils.ts";
import type { Message as AgentMessage } from "./context.ts";
import type { LLMFunction } from "./orchestrator.ts";

// ============================================================
// Types
// ============================================================

export type PlanningMode = "off" | "auto" | "always";
export type PlanningPhase =
  | "researching"
  | "drafting"
  | "reviewing"
  | "executing"
  | "done";

export interface PlanningConfig {
  mode?: PlanningMode;
  maxSteps?: number;
  requireStepMarkers?: boolean;
}

export interface PlanStep {
  id: string;
  title: string;
  goal?: string;
  tools?: string[];
  successCriteria?: string[];
  agent?: string;
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
}

export interface PlanState {
  plan: Plan;
  currentIndex: number;
  completedIds: Set<string>;
}

interface PlanParseResult {
  plan: Plan | null;
  error?: string;
}

// ============================================================
// Planning prompt + parsing
// ============================================================

export const PLAN_START = "PLAN";
export const PLAN_END = "END_PLAN";
const STEP_DONE_PATTERN = /STEP_DONE\s*[:\-]?\s*([a-z0-9_-]+)/i;
const EXPLICIT_PLAN_CUE_PATTERNS = [
  /\bfirst\b[\s\S]{0,120}\bthen\b/i,
  /\b(?:step\s*1|1\.)\b[\s\S]{0,120}\b(?:step\s*2|2\.)\b/i,
  /\bphase\s*1\b[\s\S]{0,120}\bphase\s*2\b/i,
] as const;

export function hasDeterministicPlanningCue(request: string): boolean {
  return EXPLICIT_PLAN_CUE_PATTERNS.some((pattern) => pattern.test(request));
}

export async function shouldPlanRequest(
  request: string,
  mode: PlanningMode,
  preComputedNeedsPlan?: boolean,
): Promise<boolean> {
  if (mode === "always") return true;
  if (mode === "off") return false;
  if (hasDeterministicPlanningCue(request)) return true;
  if (preComputedNeedsPlan !== undefined) return preComputedNeedsPlan;

  const { classifyPlanNeed } = await import("../runtime/local-llm.ts");
  const result = await classifyPlanNeed(request);
  return result.needsPlan;
}

export function buildPlanModeReminder(
  availableTools?: readonly string[],
  directFileTargets?: readonly string[],
): string {
  const toolLine = availableTools?.length
    ? `Planning tools: ${availableTools.join(", ")}`
    : "Planning tools are restricted to read-only and coordination actions.";
  const directFileLine = directFileTargets?.length === 1
    ? `The user already named the target file: ${
      directFileTargets[0]
    }. Read that file before any broader search.`
    : undefined;
  return [
    "Plan mode is active.",
    "Stay in read-only planning until the user approves a plan.",
    "For a concrete task, start by writing a short checklist with todo_write so the user can see the plan taking shape.",
    "When you call todo_write, only use these statuses: pending, in_progress, completed.",
    "Explore the workspace, inspect files, run safe read-only commands, ask clarifying questions with ask_user, and keep progress current with todo_write.",
    "Keep research tight. After 1-3 targeted inspections, stop researching and draft the plan unless the task is still ambiguous.",
    "If the user already named an exact file path, read that file before calling search_code. Only search if read_file fails or the target is still unclear.",
    "If the user named a directory, inspect that directory first instead of doing broad repo-wide searches.",
    "Prefer dedicated tools like read_file, search_code, list_files, and edit_file over shell_exec whenever possible.",
    "If the task depends on moving, renaming, deleting, or reorganizing files or folders, surface that during planning instead of discovering it mid-execution.",
    "For directory management, file moves, or binary file handling, make the plan explicitly include shell_exec in the relevant step tools when no dedicated file tool can perform the action.",
    "Surface operational blockers and user choices during planning, not after approval. If shell access, binary-safe moves, rename strategy, or folder naming could matter, inspect that now and ask now.",
    "Do not answer general tutorial questions directly while planning.",
    "If the request is ambiguous or not concrete enough, ask one concise clarification with ask_user instead of writing a long conversational reply.",
    "When the clarification can be expressed as 2-4 concrete choices, call ask_user with options so the REPL can show a picker instead of a free-text prompt.",
    "Keep clarifications task-oriented. Ask what concrete change, file, or goal the user wants planned. Do not switch into biographical, memory, or small-talk follow-ups.",
    "Do not call complete_task while planning.",
    ...(directFileLine ? [directFileLine] : []),
    toolLine,
    "When the plan is ready, return ONLY a PLAN ... END_PLAN block with valid JSON matching the existing plan schema.",
    "Once the plan is approved, execution should proceed without reopening clarification unless an unexpected blocker makes progress impossible.",
    "If the user asks for revisions, keep planning in the same session and emit a replacement PLAN block.",
  ].join("\n");
}

function buildPlanningPrompt(
  request: string,
  maxSteps?: number,
  availableAgents?: string[],
  directFileTargets?: readonly string[],
): string {
  const cap = typeof maxSteps === "number" && maxSteps > 0 ? maxSteps : 6;
  const agentLine = availableAgents && availableAgents.length > 0
    ? `Available agents: ${availableAgents.join(", ")}`
    : "";
  const directFileLine = directFileTargets?.length === 1
    ? `The user already named the exact target file: ${
      directFileTargets[0]
    }. Do not add repo-wide search steps unless that file read fails.`
    : "";
  return [
    "Create a concise execution plan for the user's request using the prior conversation and any research already gathered.",
    "This is the drafting step. Do NOT ask follow-up questions, do NOT call tools, and do NOT continue exploring.",
    "Return ONLY a PLAN block with valid JSON.",
    "Use this exact envelope:",
    "PLAN",
    '{"goal":"...","steps":[{"id":"step-1","title":"...","tools":["tool_a"],"successCriteria":["..."]}]}',
    "END_PLAN",
    "",
    `Constraints: ${cap} steps max.`,
    "Each step must have: id, title.",
    "Write short, goal-oriented steps for the review card. The title must describe the user-visible action, not just a tool name. Put tool names in tools, not in title.",
    "Do not mention omitted lines, truncation, byte limits, failed searches, or other temporary tool-output quirks.",
    "For small single-file edits, prefer 2-3 concise steps: locate the target, make the edit, verify the result.",
    "If the user already named the file, reference that file directly instead of adding repo-search steps.",
    "Include concrete tool names for each step whenever possible (e.g., search_code, read_file, list_files, edit_file).",
    "If a step requires directory creation, file moves, renames, or binary-safe file handling, include shell_exec in that step's tools.",
    "Optional: add 'agent' to label a step with a specialist profile (e.g., web, code, file, shell, memory).",
    agentLine,
    directFileLine,
    "",
    "User request:",
    request,
  ].join("\n");
}

export function getPlanResearchIterationBudget(maxIterations: number): number {
  return Math.max(1, Math.min(3, maxIterations - 1));
}

const PLAN_EXECUTION_BASELINE_TOOLS = [
  "complete_task",
  "edit_file",
  "list_files",
  "read_file",
  "search_code",
  "shell_exec",
  "todo_read",
  "todo_write",
  "undo_edit",
  "write_file",
] as const;

export function derivePlanExecutionAllowlist(
  plan: Plan,
  baseAllowlist?: readonly string[],
  options?: { directFileTargets?: readonly string[] },
): string[] | undefined {
  const directFileTargets = options?.directFileTargets;
  const preferDirectFileWork = directFileTargets?.length === 1;
  const planTools = plan.steps.flatMap((step) => step.tools ?? []);
  const requestedTools = [
    ...PLAN_EXECUTION_BASELINE_TOOLS,
    ...planTools,
  ];
  const dedupedTools = [...new Set(requestedTools)].filter((toolName) =>
    !(
      preferDirectFileWork &&
      (toolName === "search_code" || toolName === "shell_exec")
    )
  );

  if (baseAllowlist && baseAllowlist.length > 0) {
    const allowed = new Set(baseAllowlist);
    const filtered = dedupedTools.filter((toolName) => allowed.has(toolName));
    return filtered.length > 0 ? filtered : [...baseAllowlist];
  }

  return planTools.length > 0 ? dedupedTools : undefined;
}

export async function requestPlan(
  llm: LLMFunction,
  messages: AgentMessage[],
  request: string,
  config: PlanningConfig,
  availableAgents?: string[],
  directFileTargets?: readonly string[],
  signal?: AbortSignal,
): Promise<Plan | null> {
  const prompt = buildPlanningPrompt(
    request,
    config.maxSteps,
    availableAgents,
    directFileTargets,
  );
  const planningMessages: AgentMessage[] = [
    ...messages,
    { role: "system", content: prompt },
  ];

  let response: string;
  try {
    const result = await llm(planningMessages, signal);
    response = result.content ?? "";
  } catch (error) {
    throw new ValidationError(
      `Planning failed: ${getErrorMessage(error)}`,
      "planning",
    );
  }

  const parsed = parsePlanResponse(response);
  if (!parsed.plan) {
    return null;
  }
  return parsed.plan;
}

export function parsePlanResponse(response: string): PlanParseResult {
  const extracted = extractPlanContent(response);
  if (!extracted) return { plan: null, error: "missing_plan_json" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.content);
  } catch (error) {
    if (extracted.kind === "plan_block") {
      const fallbackPlan = parseTextPlanBlock(extracted.content);
      if (fallbackPlan) return { plan: fallbackPlan };
    }
    return { plan: null, error: `invalid_json: ${getErrorMessage(error)}` };
  }

  const plan = normalizePlan(parsed);
  if (!plan) return { plan: null, error: "invalid_plan_shape" };
  return { plan };
}

export function formatPlanForContext(
  plan: Plan,
  config?: PlanningConfig,
): string {
  const requireMarkers = config?.requireStepMarkers ?? false;
  const mode = config?.mode ?? "auto";
  const lines = ["Plan:", `Goal: ${plan.goal}`, ""];
  plan.steps.forEach((step, index) => {
    lines.push(
      `${index + 1}. [${step.id}] ${step.title}${
        step.tools?.length ? ` (tools: ${step.tools.join(", ")})` : ""
      }`,
    );
    if (step.goal) lines.push(`   - goal: ${step.goal}`);
    if (step.successCriteria?.length) {
      lines.push(`   - success: ${step.successCriteria.join("; ")}`);
    }
  });
  lines.push("");
  if (mode === "always") {
    lines.push("Rules: Follow steps in order. Do not finish early.");
  } else {
    lines.push("Guidance: Use this plan as a rough outline. Adjust if needed.");
  }
  if (requireMarkers) {
    lines.push(
      'When a step is complete, end your response with: "STEP_DONE <id>"',
    );
  }
  return lines.join("\n");
}

export function getPlanSignature(plan: Plan): string {
  return JSON.stringify({
    goal: plan.goal,
    steps: plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      ...(step.goal ? { goal: step.goal } : {}),
      ...(step.tools ? { tools: [...step.tools] } : {}),
      ...(step.successCriteria
        ? { successCriteria: [...step.successCriteria] }
        : {}),
      ...(step.agent ? { agent: step.agent } : {}),
    })),
  });
}

export function extractStepDoneId(response: string): string | null {
  const match = STEP_DONE_PATTERN.exec(response);
  if (!match) return null;
  return match[1] ?? null;
}

export function stripStepMarkers(response: string): string {
  return response.replace(/^.*STEP_DONE\s*[:\-]?\s*[a-z0-9_-]+.*$/gim, "")
    .trim();
}

export function createPlanState(plan: Plan): PlanState {
  return {
    plan,
    currentIndex: 0,
    completedIds: new Set(),
  };
}

export function restorePlanState(
  plan: Plan,
  completedIds: Iterable<string> = [],
): PlanState {
  const completed = new Set(completedIds);
  let currentIndex = 0;
  while (
    currentIndex < plan.steps.length &&
    completed.has(plan.steps[currentIndex]?.id ?? "")
  ) {
    currentIndex += 1;
  }
  return {
    plan,
    currentIndex,
    completedIds: completed,
  };
}

/** Only advance if completedId matches the current step */
export function advancePlanState(
  state: PlanState,
  completedId?: string | null,
): { state: PlanState; finished: boolean; nextStep?: PlanStep } {
  const current = state.plan.steps[state.currentIndex];
  if (!current) {
    return { state, finished: true };
  }

  const id = completedId ?? current.id;

  // If model completed a different step than current, record it but don't advance
  if (id !== current.id) {
    state.completedIds.add(id);
    return { state, finished: false, nextStep: current };
  }

  state.completedIds.add(id);
  state.currentIndex += 1;
  const next = state.plan.steps[state.currentIndex];
  return { state, finished: !next, nextStep: next };
}

// ============================================================
// Internal helpers
// ============================================================

function extractPlanContent(
  response: string,
): { content: string; kind: "plan_block" | "json" } | null {
  const trimmed = response.trim();
  if (!trimmed) return null;

  const planBlock = extractBetween(trimmed, PLAN_START, PLAN_END);
  if (planBlock) {
    const normalized = unwrapJsonFence(planBlock.trim());
    return normalized ? { content: normalized, kind: "plan_block" } : null;
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return { content: trimmed, kind: "json" };
  }

  const fenceMatch = /```json\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch?.[1]) {
    return { content: fenceMatch[1].trim(), kind: "json" };
  }

  return null;
}

function unwrapJsonFence(input: string): string {
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(input);
  return fencedMatch?.[1]?.trim() || input;
}

function extractBetween(
  input: string,
  start: string,
  end: string,
): string | null {
  const startIndex = input.indexOf(start);
  if (startIndex < 0) return null;
  const endIndex = input.indexOf(end, startIndex + start.length);
  if (endIndex < 0) return null;
  return input.slice(startIndex + start.length, endIndex);
}

function normalizePlan(input: unknown): Plan | null {
  if (!isObjectValue(input)) return null;

  const goal = firstNonEmptyString(
    input.goal,
    input.description,
    input.title,
    input.objective,
    input.summary,
  );
  if (!goal) return null;

  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (rawSteps.length === 0) return null;

  const usedIds = new Set<string>();
  const steps: PlanStep[] = rawSteps
    .map((entry, index) => {
      if (!isObjectValue(entry)) return null;
      const title = derivePlanStepTitle(entry);
      if (!title) return null;

      const id = makeUniquePlanStepId(
        usedIds,
        typeof entry.id === "string" && entry.id.trim()
          ? entry.id.trim()
          : `step-${index + 1}`,
      );
      const toolsFromArray = Array.isArray(entry.tools)
        ? entry.tools.filter((t: unknown) =>
          typeof t === "string" && (t as string).trim().length > 0
        )
        : undefined;
      const actionTool = typeof entry.action === "string" &&
          entry.action.trim().includes("_")
        ? entry.action.trim()
        : undefined;
      const tools = toolsFromArray?.length
        ? toolsFromArray
        : typeof entry.tool === "string" && entry.tool.trim()
        ? [entry.tool.trim()]
        : actionTool
        ? [actionTool]
        : undefined;
      const successCriteria = Array.isArray(entry.successCriteria)
        ? entry.successCriteria.filter((t: unknown) =>
          typeof t === "string" && (t as string).trim().length > 0
        )
        : undefined;
      const stepGoal = firstNonEmptyString(entry.goal, entry.summary);
      const agent = typeof entry.agent === "string" && entry.agent.trim()
        ? entry.agent.trim()
        : undefined;

      return {
        id,
        title,
        goal: stepGoal,
        tools: tools && tools.length > 0 ? tools : undefined,
        successCriteria: successCriteria && successCriteria.length > 0
          ? successCriteria
          : undefined,
        agent,
      } as PlanStep;
    })
    .filter((step): step is PlanStep => step !== null);

  return steps.length > 0 ? { goal, steps } : null;
}

const RAW_PLAN_TOOL_TITLES = new Set([
  "ask_user",
  "complete_task",
  "edit_file",
  "find_symbol",
  "list_files",
  "read_file",
  "search_code",
  "shell_exec",
  "todo_read",
  "todo_write",
  "undo_edit",
  "verify",
  "write_file",
]);

function derivePlanStepTitle(entry: Record<string, unknown>): string {
  const titleCandidate = firstNonEmptyString(
    entry.title,
    entry.description,
    entry.detail,
    entry.goal,
    entry.summary,
    entry.action,
  );
  const fileTarget = firstNonEmptyString(
    entry.file,
    entry.path,
    entry.target,
    entry.targetFile,
  );
  if (titleCandidate && !isRawPlanToolTitle(titleCandidate)) {
    return normalizePlanStepTitle(titleCandidate, fileTarget);
  }

  const toolName = firstNonEmptyString(entry.tool, entry.action);
  const rawToolLikeTitle = titleCandidate && isRawPlanToolTitle(titleCandidate)
    ? titleCandidate
    : "";
  const detailCandidate = firstNonEmptyString(
    entry.detail,
    entry.description,
    entry.goal,
    entry.summary,
  );

  if (detailCandidate && !isRawPlanToolTitle(detailCandidate)) {
    return normalizePlanStepTitle(detailCandidate, fileTarget);
  }

  return humanizePlanToolTitle(toolName || rawToolLikeTitle, fileTarget);
}

function normalizePlanStepTitle(title: string, fileTarget?: string): string {
  let cleaned = title.trim().replace(/\s+/g, " ");
  if (fileTarget) {
    cleaned = cleaned.replaceAll(fileTarget, formatPlanTarget(fileTarget));
  }
  cleaned = cleaned.replace(
    /\.\s+(?:The|This|Resulting|After|Once|Then)\b[\s\S]*$/i,
    "",
  );
  cleaned = cleaned.replace(
    /\s+(?:using|via|with)\s+(?:the\s+)?(?:ask_user|complete_task|edit_file|find_symbol|list_files|read_file|search_code|shell_exec|todo_read|todo_write|undo_edit|verify|write_file)\b.*$/i,
    "",
  );
  cleaned = cleaned.replace(/\s+on line \d+\b.*$/i, "");
  cleaned = cleaned.replace(/\s*\([^)]*\bline \d+[^)]*\)/gi, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned || humanizePlanToolTitle("", fileTarget);
}

function isRawPlanToolTitle(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return RAW_PLAN_TOOL_TITLES.has(normalized);
}

function humanizePlanToolTitle(toolName: string, fileTarget?: string): string {
  const targetLabel = fileTarget ? formatPlanTarget(fileTarget) : "the target";
  switch (toolName.trim().toLowerCase()) {
    case "read_file":
      return `Inspect ${targetLabel}`;
    case "edit_file":
      return fileTarget
        ? `Make the requested edit in ${formatPlanTarget(fileTarget)}`
        : "Make the requested edit";
    case "write_file":
      return fileTarget
        ? `Create ${formatPlanTarget(fileTarget)}`
        : "Create the requested file";
    case "search_code":
      return "Find the relevant code section";
    case "list_files":
      return fileTarget
        ? `Inspect ${formatPlanTarget(fileTarget)}`
        : "Inspect the relevant directory";
    case "find_symbol":
      return "Locate the relevant symbol";
    case "shell_exec":
      return "Run the targeted verification command";
    case "verify":
      return "Verify the requested change";
    case "todo_write":
      return "Update the visible checklist";
    case "ask_user":
      return "Clarify the request";
    case "complete_task":
      return "Summarize the completed work";
    case "undo_edit":
      return "Revert the last edit if needed";
    case "todo_read":
      return "Review the current checklist";
    default:
      return "Complete the next planned step";
  }
}

function formatPlanTarget(target: string): string {
  const trimmed = target.replace(/^\.?\//, "").trim();
  if (!trimmed) return "the target file";
  if (trimmed.startsWith("/")) {
    const segments = trimmed.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "the target file";
  }
  return trimmed;
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function makeUniquePlanStepId(
  usedIds: Set<string>,
  candidate: string,
): string {
  const base = candidate.trim() || `step-${usedIds.size + 1}`;
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }

  let suffix = 2;
  while (usedIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  const uniqueId = `${base}-${suffix}`;
  usedIds.add(uniqueId);
  return uniqueId;
}

function parseTextPlanBlock(input: string): Plan | null {
  const lines = input
    .split(/\r?\n/)
    .map((line) => normalizePlanLine(line))
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  let goal = "";
  const steps: PlanStep[] = [];
  let inSteps = false;

  for (const line of lines) {
    if (/^(plan|steps?)\s*:?\s*$/i.test(line)) {
      inSteps = true;
      continue;
    }

    const goalMatch = /^(goal|objective|summary)\s*[:\-]\s*(.+)$/i.exec(line);
    if (goalMatch?.[2]) {
      goal = goalMatch[2].trim();
      continue;
    }

    const numberedStepMatch = /^(?:step\s*)?(\d+)\s*[\.\):-]\s*(.+)$/i.exec(
      line,
    );
    if (numberedStepMatch?.[2]) {
      inSteps = true;
      const parsedStep = createLoosePlanStep(
        Number(numberedStepMatch[1]),
        numberedStepMatch[2],
      );
      if (parsedStep) steps.push(parsedStep);
      continue;
    }

    const bulletStepMatch = /^[-*]\s+(.+)$/.exec(line);
    if (bulletStepMatch?.[1] && (inSteps || steps.length > 0)) {
      const parsedStep = createLoosePlanStep(
        steps.length + 1,
        bulletStepMatch[1],
      );
      if (parsedStep) steps.push(parsedStep);
      continue;
    }

    if (!goal && steps.length === 0) {
      goal = line;
      continue;
    }

    if (inSteps || steps.length > 0) {
      const parsedStep = createLoosePlanStep(steps.length + 1, line);
      if (parsedStep) steps.push(parsedStep);
    }
  }

  if (!goal || steps.length === 0) return null;
  return { goal, steps };
}

function normalizePlanLine(line: string): string {
  return line
    .replace(/\r/g, "")
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/^\s*>+\s*/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function createLoosePlanStep(index: number, rawTitle: string): PlanStep | null {
  const { title, tools } = extractInlineStepTools(rawTitle);
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return null;
  return {
    id: `step-${index}`,
    title: normalizedTitle,
    ...(tools.length > 0 ? { tools } : {}),
  };
}

function extractInlineStepTools(
  rawTitle: string,
): { title: string; tools: string[] } {
  const toolMatch = /(?:^|[\s(])tools?\s*:\s*([a-z0-9_,\s-]+)\)?$/i.exec(
    rawTitle,
  );
  if (!toolMatch?.[1]) {
    return { title: rawTitle, tools: [] };
  }

  const tools = toolMatch[1]
    .split(",")
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  const title = rawTitle.slice(0, toolMatch.index).trim().replace(
    /[(-]\s*$/,
    "",
  )
    .trim();
  return { title, tools };
}
