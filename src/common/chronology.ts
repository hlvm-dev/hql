/**
 * Chronology Primitives — shared pure functions for activity/history analysis.
 *
 * Used by the `recent_activity` tool and its tests.
 *
 * Zero side effects. Zero REPL dependencies.
 */

// ============================================================
// Types
// ============================================================

/** Where a chronology entry originated. */
export type ChronologySource = "current_session" | "other_session" | "history";
export type ChronologyGrouping = "activity" | "questions";

/** A single user prompt with timestamp and origin. */
export interface ChronologyEntry {
  ts: number;
  cmd: string;
  source: ChronologySource;
}

/** A group of related prompts within a time window. */
export interface PromptBlock {
  dateKey: string;
  startTs: number;
  endTs: number;
  prompts: string[];
  source: ChronologySource;
}

// ============================================================
// Constants
// ============================================================

export const DEFAULT_BLOCK_GAP_MS = 30 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const LOW_SIGNAL_PROMPTS = new Set([
  "y",
  "yes",
  "n",
  "no",
  "ok",
  "okay",
  "k",
  "kk",
  "sure",
  "thanks",
  "thank you",
  "done",
  "continue",
]);

export const GREETING_ONLY_PATTERN =
  /^(?:hi|hello|hey)(?:\s+(?:man|there|hlvm|bot|assistant))?[!.?]*$/i;
export const SLASH_COMMAND_PATTERN = /^[/.][a-z][\w-]*(?:\s|$)/i;

const RECALL_META_PATTERNS = [
  /\blast time\b/i,
  /\bmost recent\b/i,
  /\bprevious\b/i,
  /\blast command\b/i,
  /\bwhat did i do\b/i,
  /\bwhat did i ask\b/i,
  /\bwhat was the last\b/i,
  /\brecently\b/i,
  /\bbefore that\b/i,
  /\bbefore then\b/i,
  /\bearlier than that\b/i,
  /\bfurther back\b/i,
  /\bfarther back\b/i,
  /\byesterday\b/i,
  /\btoday\b/i,
];

// ============================================================
// Normalization
// ============================================================

export function normalizePrompt(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

// ============================================================
// Prompt classification helpers
// ============================================================

export function isLowSignalPrompt(input: string): boolean {
  return LOW_SIGNAL_PROMPTS.has(normalizePrompt(input).toLowerCase());
}

export function isGreetingOnlyPrompt(input: string): boolean {
  return GREETING_ONLY_PATTERN.test(normalizePrompt(input));
}

export function isSlashCommandPrompt(input: string): boolean {
  return SLASH_COMMAND_PATTERN.test(normalizePrompt(input));
}

/** Does the input match chronology/recall patterns (last time, yesterday, etc.)? */
export function isRecallMetaPrompt(input: string): boolean {
  const normalized = normalizePrompt(input);
  return RECALL_META_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Returns true for prompts worth including in activity blocks.
 * Filters: low-signal, greetings, slash commands, and recall-meta prompts.
 */
export function isMeaningfulPrompt(input: string): boolean {
  const normalized = normalizePrompt(input);
  return !!normalized &&
    !isLowSignalPrompt(normalized) &&
    !isGreetingOnlyPrompt(normalized) &&
    !isSlashCommandPrompt(normalized) &&
    !isRecallMetaPrompt(normalized);
}

// ============================================================
// Date/time helpers
// ============================================================

function getDateParts(
  ts: number,
  timeZone: string,
): { year: string; month: string; day: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts));
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: map.get("year") ?? "0000",
    month: map.get("month") ?? "00",
    day: map.get("day") ?? "00",
    hour: map.get("hour") ?? "00",
    minute: map.get("minute") ?? "00",
  };
}

export function getLocalDateKey(ts: number, timeZone: string): string {
  const { year, month, day } = getDateParts(ts, timeZone);
  return `${year}-${month}-${day}`;
}

export function getLocalTimeLabel(ts: number, timeZone: string): string {
  const { hour, minute } = getDateParts(ts, timeZone);
  return `${hour}:${minute}`;
}

export function getTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

// ============================================================
// Block building
// ============================================================

export function dedupePrompts(prompts: string[], limit: number): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const prompt of prompts) {
    const normalized = normalizePrompt(prompt).toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(prompt);
    if (unique.length >= limit) break;
  }
  return unique;
}

/**
 * Group chronology entries into prompt blocks by date + time gap.
 * Input MUST be sorted ascending by timestamp.
 */
export function buildPromptBlocks(
  entries: readonly ChronologyEntry[],
  timeZone: string,
  blockGapMs: number,
  limitPromptsPerBlock: number,
  grouping: ChronologyGrouping = "activity",
): PromptBlock[] {
  const meaningfulEntries = entries
    .filter((entry) => entry.cmd && isMeaningfulPrompt(entry.cmd));

  if (grouping === "questions") {
    return meaningfulEntries.map((entry) => ({
      dateKey: getLocalDateKey(entry.ts, timeZone),
      startTs: entry.ts,
      endTs: entry.ts,
      prompts: [entry.cmd],
      source: entry.source,
    }));
  }

  const blocks: PromptBlock[] = [];
  for (const entry of meaningfulEntries) {
    const dateKey = getLocalDateKey(entry.ts, timeZone);
    const previous = blocks.at(-1);
    if (
      !previous ||
      previous.dateKey !== dateKey ||
      entry.ts - previous.endTs > blockGapMs ||
      previous.source !== entry.source
    ) {
      blocks.push({
        dateKey,
        startTs: entry.ts,
        endTs: entry.ts,
        prompts: [entry.cmd],
        source: entry.source,
      });
      continue;
    }

    previous.endTs = entry.ts;
    previous.prompts = dedupePrompts(
      [...previous.prompts, entry.cmd],
      limitPromptsPerBlock,
    );
  }
  return blocks;
}
