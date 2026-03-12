/**
 * LLM Fixtures - Deterministic LLM responses for testing
 *
 * Provides a simple, local-only fixture format to make CLI/E2E
 * tests deterministic without a live model. Each fixture can
 * contain multiple cases selected by user query substrings.
 *
 * SSOT-compliant: uses platform abstraction for file I/O.
 */

import { getPlatform } from "../../platform/platform.ts";
import { ValidationError } from "../../common/error.ts";
import { getErrorMessage, isObjectValue } from "../../common/utils.ts";
import { throwIfAborted } from "../../common/timeout-utils.ts";
import type { Message as AgentMessage } from "./context.ts";
import type { LLMResponse, ToolCall } from "./tool-call.ts";

// ============================================================
// Types
// ============================================================

interface FixtureStepExpect {
  /** Substrings that must appear in the concatenated message content */
  contains?: string[];
  /** Exact message count expected for this step */
  messageCount?: number;
}

interface FixtureStep {
  /** LLM response content to return for this step */
  response?: string;
  /** Alias for response */
  content?: string;
  /** Optional reasoning/thinking text to return for this step */
  reasoning?: string;
  /** Optional structured tool calls */
  toolCalls?: ToolCall[];
  /** Optional expectations against input messages */
  expect?: FixtureStepExpect;
}

interface FixtureCaseMatch {
  /** Substrings required in the last user message */
  contains?: string[];
}

interface FixtureCase {
  name: string;
  match?: FixtureCaseMatch;
  steps: FixtureStep[];
}

export interface LlmFixture {
  version: 1;
  name?: string;
  cases: FixtureCase[];
}

// ============================================================
// Loading + Validation
// ============================================================

export async function loadLlmFixture(path: string): Promise<LlmFixture> {
  const platform = getPlatform();
  let raw: string;
  try {
    raw = await platform.fs.readTextFile(path);
  } catch (error) {
    throw new ValidationError(
      `Failed to read LLM fixture at ${path}: ${getErrorMessage(error)}`,
      "llm_fixture",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ValidationError(
      `Invalid JSON in LLM fixture (${path}): ${getErrorMessage(error)}`,
      "llm_fixture",
    );
  }

  const normalized = normalizeFixture(parsed);
  if (!normalized) {
    throw new ValidationError(
      `Invalid LLM fixture format (${path}). Expected { version: 1, cases: [...] }`,
      "llm_fixture",
    );
  }

  return normalized;
}

function normalizeFixture(input: unknown): LlmFixture | null {
  if (!isObjectValue(input)) return null;

  const version = input.version ?? 1;
  if (version !== 1) return null;

  const cases = normalizeCases(input.cases);
  if (!cases || cases.length === 0) return null;

  return {
    version: 1,
    name: typeof input.name === "string" ? input.name : undefined,
    cases,
  };
}

function normalizeCases(input: unknown): FixtureCase[] | null {
  if (!Array.isArray(input)) return null;
  const cases: FixtureCase[] = [];

  for (const entry of input) {
    if (!isObjectValue(entry)) continue;
    if (typeof entry.name !== "string" || entry.name.trim() === "") continue;

    const steps = normalizeSteps(entry.steps);
    if (!steps || steps.length === 0) continue;

    const match = normalizeMatch(entry.match);

    cases.push({
      name: entry.name,
      match,
      steps,
    });
  }

  return cases.length > 0 ? cases : null;
}

function normalizeSteps(input: unknown): FixtureStep[] | null {
  if (!Array.isArray(input)) return null;
  const steps: FixtureStep[] = [];

  for (const entry of input) {
    if (!isObjectValue(entry)) continue;
    const response = typeof entry.response === "string"
      ? entry.response
      : undefined;
    const content = typeof entry.content === "string"
      ? entry.content
      : undefined;
    const reasoning = typeof entry.reasoning === "string"
      ? entry.reasoning
      : undefined;
    const toolCalls = Array.isArray(entry.toolCalls)
      ? entry.toolCalls.filter((call) =>
        isObjectValue(call) && typeof call.toolName === "string"
      ) as ToolCall[]
      : undefined;
    if (
      !response && !content && !reasoning &&
      (!toolCalls || toolCalls.length === 0)
    ) {
      continue;
    }

    const expect = normalizeExpect(entry.expect);
    steps.push({ response, content, reasoning, toolCalls, expect });
  }

  return steps.length > 0 ? steps : null;
}

function normalizeMatch(input: unknown): FixtureCaseMatch | undefined {
  if (!isObjectValue(input)) return undefined;
  const contains = Array.isArray(input.contains)
    ? input.contains.filter((s) => typeof s === "string" && s.length > 0)
    : undefined;
  return contains && contains.length > 0 ? { contains } : undefined;
}

function normalizeExpect(input: unknown): FixtureStepExpect | undefined {
  if (!isObjectValue(input)) return undefined;
  const contains = Array.isArray(input.contains)
    ? input.contains.filter((s) => typeof s === "string" && s.length > 0)
    : undefined;
  const messageCount = typeof input.messageCount === "number"
    ? input.messageCount
    : undefined;
  if (!contains && messageCount === undefined) return undefined;
  return { contains, messageCount };
}

// ============================================================
// Fixture LLM
// ============================================================

export function createFixtureLLM(
  fixture: LlmFixture,
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<LLMResponse> {
  let currentCase: FixtureCase | null = null;
  let stepIndex = 0;

  return (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ): Promise<LLMResponse> => {
    throwIfAborted(signal);

    if (!currentCase) {
      currentCase = selectCase(fixture, messages);
      stepIndex = 0;
    }

    const step = currentCase.steps[stepIndex];
    if (!step) {
      throw new ValidationError(
        `LLM fixture exhausted for case "${currentCase.name}" after ${stepIndex} steps`,
        "llm_fixture",
      );
    }
    stepIndex += 1;

    if (step.expect) {
      assertStepExpect(step.expect, messages, currentCase.name, stepIndex);
    }

    return Promise.resolve({
      content: step.content ?? step.response ?? "",
      toolCalls: step.toolCalls ?? [],
      reasoning: step.reasoning,
    });
  };
}

function selectCase(
  fixture: LlmFixture,
  messages: AgentMessage[],
): FixtureCase {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const haystack = lastUser?.content ?? "";

  // First, try to match cases with explicit contains
  for (const candidate of fixture.cases) {
    const match = candidate.match?.contains;
    if (!match || match.length === 0) continue;
    const ok = match.every((token) => haystack.includes(token));
    if (ok) return candidate;
  }

  // Fallback to first case without match
  const fallback = fixture.cases.find((c) => !c.match);
  if (fallback) return fallback;

  const available = fixture.cases.map((c) => c.name).join(", ");
  throw new ValidationError(
    `No LLM fixture case matched the request. Available cases: ${available}`,
    "llm_fixture",
  );
}

function assertStepExpect(
  expect: FixtureStepExpect,
  messages: AgentMessage[],
  caseName: string,
  stepNumber: number,
): void {
  if (
    expect.messageCount !== undefined && messages.length !== expect.messageCount
  ) {
    throw new ValidationError(
      `LLM fixture expect mismatch (case "${caseName}" step ${stepNumber}): ` +
        `messageCount expected ${expect.messageCount}, got ${messages.length}`,
      "llm_fixture",
    );
  }

  if (expect.contains && expect.contains.length > 0) {
    const text = messages.map((m) => m.content).join("\n");
    for (const token of expect.contains) {
      if (!text.includes(token)) {
        throw new ValidationError(
          `LLM fixture expect mismatch (case "${caseName}" step ${stepNumber}): ` +
            `missing "${token}" in messages`,
          "llm_fixture",
        );
      }
    }
  }
}
