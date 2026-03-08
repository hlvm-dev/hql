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
  delegatedIds: Set<string>;
}

interface PlanParseResult {
  plan: Plan | null;
  error?: string;
}

// ============================================================
// Planning prompt + parsing
// ============================================================

const PLAN_START = "PLAN";
const PLAN_END = "END_PLAN";
const STEP_DONE_PATTERN = /STEP_DONE\s*[:\-]?\s*([a-z0-9_-]+)/i;

export function shouldPlanRequest(
  request: string,
  mode: PlanningMode,
): boolean {
  if (mode === "always") return true;
  if (mode === "off") return false;

  const lower = request.toLowerCase();
  const hasMultiStepCue = lower.includes(" and ") || lower.includes(" then ") ||
    lower.includes(" steps") || lower.includes("first ") ||
    lower.includes("second ");
  const isLong = request.length >= 160;
  return hasMultiStepCue || isLong;
}

function buildPlanningPrompt(
  request: string,
  maxSteps?: number,
  availableAgents?: string[],
): string {
  const cap = typeof maxSteps === "number" && maxSteps > 0 ? maxSteps : 6;
  const agentLine = availableAgents && availableAgents.length > 0
    ? `Available agents: ${availableAgents.join(", ")}`
    : "";
  return [
    "Create a concise execution plan for the user's request.",
    "Do NOT call tools. Return ONLY a PLAN block with valid JSON.",
    "Use this exact envelope:",
    "PLAN",
    "{\"goal\":\"...\",\"steps\":[{\"id\":\"step-1\",\"title\":\"...\",\"tools\":[\"tool_a\"],\"successCriteria\":[\"...\"]}]}",
    "END_PLAN",
    "",
    `Constraints: ${cap} steps max.`,
    "Each step must have: id, title.",
    "Use tool names when relevant (e.g., search_code, read_file, list_files).",
    "Optional: add 'agent' for delegation (e.g., web, code, file, shell, memory).",
    agentLine,
    "",
    "User request:",
    request,
  ].join("\n");
}

export async function requestPlan(
  llm: LLMFunction,
  messages: AgentMessage[],
  request: string,
  config: PlanningConfig,
  availableAgents?: string[],
  signal?: AbortSignal,
): Promise<Plan | null> {
  const prompt = buildPlanningPrompt(request, config.maxSteps, availableAgents);
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
  const jsonText = extractPlanJson(response);
  if (!jsonText) return { plan: null, error: "missing_plan_json" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return { plan: null, error: `invalid_json: ${getErrorMessage(error)}` };
  }

  const plan = normalizePlan(parsed);
  if (!plan) return { plan: null, error: "invalid_plan_shape" };
  return { plan };
}

export function formatPlanForContext(plan: Plan, config?: PlanningConfig): string {
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
    lines.push('When a step is complete, end your response with: "STEP_DONE <id>"');
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
      ...(step.successCriteria ? { successCriteria: [...step.successCriteria] } : {}),
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
  return response.replace(/^.*STEP_DONE\s*[:\-]?\s*[a-z0-9_-]+.*$/gim, "").trim();
}

export function createPlanState(plan: Plan): PlanState {
  return { plan, currentIndex: 0, completedIds: new Set(), delegatedIds: new Set() };
}

export function restorePlanState(
  plan: Plan,
  completedIds: Iterable<string> = [],
  delegatedIds: Iterable<string> = [],
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
    delegatedIds: new Set(delegatedIds),
  };
}

/** Fix 23: Only advance if completedId matches the current step */
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

function extractPlanJson(response: string): string | null {
  const trimmed = response.trim();
  if (!trimmed) return null;

  const planBlock = extractBetween(trimmed, PLAN_START, PLAN_END);
  if (planBlock) return planBlock.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenceMatch = /```json\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  return null;
}

function extractBetween(input: string, start: string, end: string): string | null {
  const startIndex = input.indexOf(start);
  if (startIndex < 0) return null;
  const endIndex = input.indexOf(end, startIndex + start.length);
  if (endIndex < 0) return null;
  return input.slice(startIndex + start.length, endIndex);
}

function normalizePlan(input: unknown): Plan | null {
  if (!isObjectValue(input)) return null;

  const goal = typeof input.goal === "string" && input.goal.trim()
    ? input.goal.trim()
    : "";
  if (!goal) return null;

  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (rawSteps.length === 0) return null;

  const steps: PlanStep[] = rawSteps
    .map((entry, index) => {
      if (!isObjectValue(entry)) return null;
      const title = typeof entry.title === "string" ? entry.title.trim() : "";
      if (!title) return null;

      const id = typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : `step-${index + 1}`;
      const tools = Array.isArray(entry.tools)
        ? entry.tools.filter((t: unknown) => typeof t === "string" && (t as string).trim().length > 0)
        : undefined;
      const successCriteria = Array.isArray(entry.successCriteria)
        ? entry.successCriteria.filter((t: unknown) => typeof t === "string" && (t as string).trim().length > 0)
        : undefined;
      const stepGoal = typeof entry.goal === "string" ? entry.goal.trim() : undefined;
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
