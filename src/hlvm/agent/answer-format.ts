/**
 * Answer formatting helpers (SSOT).
 *
 * Provides consistent post-processing for agent answers across CLI entry points.
 */

import { ai } from "../api/ai.ts";
import { collectStream } from "./llm-integration.ts";
import { isObjectValue } from "../../common/utils.ts";

export type OutputFormat = "text" | "raw" | "json" | "tool";

export interface AnswerFormatOptions {
  format: OutputFormat;
  model?: string;
  attempts?: number;
  useModel?: boolean;
}

export function getFormatInstruction(format: OutputFormat): string | null {
  if (format === "raw") {
    return [
      "OUTPUT MODE: raw",
      "Return ONLY the final answer as plain text.",
      "No preamble, no explanation, no citations, no labels.",
      "If the answer is numeric, output digits only.",
    ].join("\n");
  }
  if (format === "json") {
    return [
      "OUTPUT MODE: json",
      "Return ONLY strict JSON with the schema:",
      "{\"answer\": \"<string>\"}",
      "No extra keys, no code fences, no surrounding text.",
    ].join("\n");
  }
  if (format === "tool") {
    return null;
  }
  return null;
}

export async function formatAnswer(
  answer: string,
  options: AnswerFormatOptions,
): Promise<string> {
  if (options.format === "text" || options.format === "tool") {
    return answer;
  }

  const useModel = options.useModel ?? true;
  if (useModel && options.model) {
    const normalized = await formatAnswerWithModel(
      answer,
      options.model,
      options.attempts ?? 2,
    );
    if (normalized !== null) {
      return options.format === "json"
        ? JSON.stringify({ answer: normalized }, null, 2)
        : normalized;
    }
  }

  return formatAnswerFallback(answer, options.format);
}

function formatAnswerFallback(answer: string, format: OutputFormat): string {
  const trimmed = answer.trim();
  if (format === "json") {
    return JSON.stringify({ answer: trimmed }, null, 2);
  }
  return trimmed;
}

async function formatAnswerWithModel(
  answer: string,
  model: string,
  attempts: number,
): Promise<string | null> {
  const systemPrompt = [
    "You are a strict formatter.",
    "Return ONLY valid JSON with schema: {\"answer\": \"<string>\"}.",
    "No extra keys, no prose, no code fences, no surrounding text.",
  ].join("\n");

  let lastOutput = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const userPrompt = attempt === 0
      ? `Format this answer:\n${answer}`
      : [
        "Your previous output was invalid JSON.",
        "Return ONLY valid JSON with schema: {\"answer\": \"<string>\"}.",
        `Answer to format:\n${answer}`,
        `Invalid output:\n${lastOutput}`,
      ].join("\n");

    const stream = ai.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { model, format: "json" },
    );

    lastOutput = await collectStream(stream);
    const parsed = parseAnswerJson(lastOutput);
    if (parsed !== null) {
      return parsed.trim();
    }
  }

  return null;
}

function parseAnswerJson(text: string): string | null {
  const trimmed = text.trim();
  const direct = tryParseAnswerJson(trimmed);
  if (direct !== null) return direct;

  const extracted = extractJsonObject(trimmed);
  if (!extracted) return null;

  return tryParseAnswerJson(extracted);
}

function tryParseAnswerJson(text: string): string | null {
  try {
    const parsed = JSON.parse(text);
    if (isObjectValue(parsed) && "answer" in parsed) {
      return String((parsed as Record<string, unknown>).answer ?? "");
    }
    return null;
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
