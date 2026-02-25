/**
 * Companion Agent — Decision Engine
 *
 * Uses a richer model for nuanced SILENT/CHAT/SUGGEST/ACT/ASK_VISION responses.
 * No LLM configured or any error → always SILENT.
 */

import type { CompanionAction, CompanionDecision, CompanionDecisionType, Observation } from "./types.ts";
import type { CompanionContext } from "./context.ts";
import type { LLMFunction } from "../agent/orchestrator-llm.ts";
import type { Message } from "../agent/context.ts";
import { withRetry } from "../../common/retry.ts";
import { formatBatch } from "./gate.ts";
import { log } from "../api/log.ts";

const DECISION_SYSTEM_PROMPT =
  `You are a personal AI companion. You observe the user's activity and decide how to help.

Respond with a JSON object on a single line:
{"type": "<SILENT|CHAT|SUGGEST|ACT|ASK_VISION>", "message": "...", "actions": [...]}

- SILENT: No action needed. Use this by default.
- CHAT: Start a brief, helpful conversation (e.g., explain an error they copied).
- SUGGEST: Offer a specific, actionable suggestion (e.g., "Try running X to fix that error").
- ACT: Execute an action. Include an "actions" array with objects like {"id": "fix-1", "label": "Fix lint error", "description": "Run eslint --fix on the current file", "requiresApproval": true}. The "description" is the instruction given to the agent. Always set requiresApproval to true.
- ASK_VISION: Request a screenshot when visual context would significantly help understanding the user's situation.

Keep messages concise (1-2 sentences). Only speak when you have genuine value to add.`;

export async function makeDecision(
  batch: Observation[],
  context: CompanionContext,
  gateReason?: string,
  llm?: LLMFunction,
  memoryContext?: string,
  signal?: AbortSignal,
): Promise<CompanionDecision> {
  if (!llm) return { type: "SILENT" };

  try {
    const parts: string[] = [];
    if (memoryContext) parts.push(`## Memory\n${memoryContext}`);
    parts.push(context.buildPromptContext());
    if (gateReason) parts.push(`## Gate Reason\n${gateReason}`);
    parts.push(`## Recent Observations\n${formatBatch(batch)}`);

    const messages: Message[] = [
      { role: "system", content: DECISION_SYSTEM_PROMPT },
      { role: "user", content: parts.join("\n\n") },
    ];

    const response = await withRetry(
      () => llm(messages, signal),
      { maxAttempts: 2, initialDelayMs: 500 },
    );

    return parseDecisionResponse(response.content);
  } catch (err) {
    log.debug("[companion] decision error, defaulting to SILENT", err);
    return { type: "SILENT" };
  }
}

/** Parse LLM text into a CompanionDecision. Exported for testing. */
export function parseDecisionResponse(text: string): CompanionDecision {
  const trimmed = text.trim();

  // Try direct JSON parse
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Fallback: extract JSON from markdown fences or surrounding text
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch { /* fall through to SILENT */ }
    }
  }

  if (!parsed || typeof parsed.type !== "string") {
    return { type: "SILENT" };
  }

  return validateDecision({
    type: parsed.type as string,
    message: parsed.message as string | undefined,
    actions: Array.isArray(parsed.actions) ? parsed.actions as CompanionAction[] : undefined,
  });
}

const VALID_DECISION_TYPES = new Set<CompanionDecisionType>([
  "SILENT", "CHAT", "SUGGEST", "ACT", "ASK_VISION",
]);

/** Validate and normalize a parsed decision. Exported for testing. */
export function validateDecision(
  parsed: { type: string; message?: string; actions?: CompanionAction[] },
): CompanionDecision {
  const type = parsed.type.toUpperCase() as CompanionDecisionType;
  if (!VALID_DECISION_TYPES.has(type)) return { type: "SILENT" };

  if (type === "SILENT") return { type: "SILENT" };

  if (type === "ACT") {
    if (parsed.actions?.length) {
      return { type: "ACT", message: parsed.message, actions: parsed.actions };
    }
    // Fallback: no actions but has message → SUGGEST
    return parsed.message ? { type: "SUGGEST", message: parsed.message } : { type: "SILENT" };
  }

  if (type === "ASK_VISION") {
    return parsed.message ? { type: "ASK_VISION", message: parsed.message } : { type: "SILENT" };
  }

  // CHAT/SUGGEST require a message
  if (!parsed.message) return { type: "SILENT" };

  return { type, message: parsed.message };
}
