/**
 * Canonical human-facing summaries for tool results.
 *
 * Default UI surfaces should show these summaries first and reveal
 * full payloads only when expanded or in verbose modes.
 */

import { isObjectValue, truncate } from "../../common/utils.ts";

const MAX_SUMMARY_CHARS = 100;

function cleanSummaryText(text: string): string {
  return truncate(text.replace(/\s+/g, " ").trim(), MAX_SUMMARY_CHARS);
}

function firstNonEmptyLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

export function pluralize(noun: string, count: number): string {
  if (count === 1) return noun;
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  return `${noun}s`;
}

function countFromRecord(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function conciseDisplayText(text: string | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const line = cleanSummaryText(firstNonEmptyLine(trimmed));
  return line || null;
}

function summarizeArrayCount(
  count: number,
  noun: string,
  verb: string = "Found",
): string {
  return `${verb} ${count} ${pluralize(noun, count)}`;
}

function summarizeStructuredRecord(
  toolName: string,
  record: Record<string, unknown>,
): string | null {
  if (record.success === false && typeof record.error === "string") {
    return cleanSummaryText(record.error);
  }

  if (typeof record.message === "string" && record.message.trim()) {
    return cleanSummaryText(record.message);
  }

  if (Array.isArray(record.matches)) {
    const count = countFromRecord(record, "count") ?? record.matches.length;
    return summarizeArrayCount(count, "match");
  }

  if (Array.isArray(record.symbols)) {
    const count = countFromRecord(record, "count") ?? record.symbols.length;
    return summarizeArrayCount(count, "symbol");
  }

  if (Array.isArray(record.entries)) {
    const count = countFromRecord(record, "count") ?? record.entries.length;
    return summarizeArrayCount(count, "entry", "Listed");
  }

  if (Array.isArray(record.results)) {
    const count = countFromRecord(record, "count") ?? record.results.length;
    if (toolName === "memory_search") {
      return count > 0
        ? `Found ${count} memory ${pluralize("result", count)}`
        : "No memory results found";
    }
    return summarizeArrayCount(count, "result");
  }

  if (Array.isArray(record.items)) {
    const count = countFromRecord(record, "count") ?? record.items.length;
    return summarizeArrayCount(count, "item", "Returned");
  }

  if (typeof record.path === "string" && typeof record.content === "string") {
    return cleanSummaryText(`Read ${record.path}`);
  }

  if (typeof record.url === "string" && typeof record.status === "number") {
    return cleanSummaryText(`Fetched ${record.url}`);
  }

  if (typeof record.openedPath === "string") {
    return cleanSummaryText(`Opened ${record.openedPath}`);
  }

  if (record.written === true) {
    return "Saved to memory";
  }

  if (record.edited === true) {
    return "Updated memory";
  }

  if (typeof record.outputPath === "string" && typeof record.inputCount === "number") {
    return cleanSummaryText(
      `Archived ${record.inputCount} ${pluralize("path", record.inputCount)} to ${record.outputPath}`,
    );
  }

  const keys = Object.keys(record).slice(0, 3);
  if (keys.length > 0) {
    return cleanSummaryText(`Returned structured result (${keys.join(", ")})`);
  }
  return null;
}

export function summarizeToolResult(
  toolName: string,
  result: unknown,
  preferredText?: string,
): string {
  const concisePreferred = conciseDisplayText(preferredText);
  if (concisePreferred) return concisePreferred;

  if (isObjectValue(result)) {
    const structuredSummary = summarizeStructuredRecord(toolName, result);
    if (structuredSummary) return structuredSummary;
  }

  if (typeof result === "string") {
    const line = conciseDisplayText(result);
    if (line) return line;
  }

  if (typeof result === "number" || typeof result === "boolean") {
    return `Result: ${String(result)}`;
  }

  return `${toolName} completed.`;
}
