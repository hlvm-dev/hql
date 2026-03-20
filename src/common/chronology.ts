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
const QUESTION_DUP_WINDOW_MS = 2000;

const LOW_SIGNAL_PROMPTS = new Set([
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

const GREETING_ONLY_PATTERN =
  /^(?:hi|hello|hey)(?:\s+(?:man|there|hlvm|bot|assistant))?[!.?]*$/i;
const SLASH_COMMAND_PATTERN = /^[/.][a-z][\w-]*(?:\s|$)/i;

/** Single pre-compiled alternation regex — replaces 15 separate .some() tests with 1 regex exec. */
const RECALL_META_RE =
  /\b(?:last time|most recent|previous|last command|what did i do|what did i ask|what was the last|recently|before that|before then|earlier than that|further back|farther back|yesterday|today)\b/i;

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

/** Does the input match chronology/recall patterns (last time, yesterday, etc.)? */
export function isRecallMetaPrompt(input: string): boolean {
  return RECALL_META_RE.test(normalizePrompt(input));
}

/**
 * Returns true for prompts worth including in activity blocks.
 * Filters: low-signal, greetings, slash commands, and recall-meta prompts.
 *
 * Normalizes once and tests inline to avoid 5x redundant normalizePrompt calls.
 */
function isMeaningfulPrompt(input: string): boolean {
  const normalized = normalizePrompt(input);
  if (!normalized) return false;
  if (LOW_SIGNAL_PROMPTS.has(normalized.toLowerCase())) return false;
  if (GREETING_ONLY_PATTERN.test(normalized)) return false;
  if (SLASH_COMMAND_PATTERN.test(normalized)) return false;
  if (RECALL_META_RE.test(normalized)) return false;
  return true;
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

function buildQuestionHistoryEntries(
  entries: readonly ChronologyEntry[],
): ChronologyEntry[] {
  const questionEntries: ChronologyEntry[] = [];

  for (const entry of entries) {
    const cmd = normalizePrompt(entry.cmd);
    if (!cmd || isRecallMetaPrompt(cmd)) continue;

    const previous = questionEntries.at(-1);
    if (
      previous &&
      previous.source === entry.source &&
      normalizePrompt(previous.cmd).toLowerCase() === cmd.toLowerCase() &&
      entry.ts - previous.ts <= QUESTION_DUP_WINDOW_MS
    ) {
      continue;
    }

    questionEntries.push({
      ts: entry.ts,
      cmd,
      source: entry.source,
    });
  }

  return questionEntries;
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
  if (grouping === "questions") {
    return buildQuestionHistoryEntries(entries).map((entry) => ({
      dateKey: getLocalDateKey(entry.ts, timeZone),
      startTs: entry.ts,
      endTs: entry.ts,
      prompts: [entry.cmd],
      source: entry.source,
    }));
  }

  const meaningfulEntries = entries
    .filter((entry) => entry.cmd && isMeaningfulPrompt(entry.cmd));

  const blocks: PromptBlock[] = [];
  // Track seen prompts per block to avoid O(n^2) re-deduplication
  const blockSeenSets: Set<string>[] = [];

  for (const entry of meaningfulEntries) {
    const dateKey = getLocalDateKey(entry.ts, timeZone);
    const previous = blocks.at(-1);
    if (
      !previous ||
      previous.dateKey !== dateKey ||
      entry.ts - previous.endTs > blockGapMs ||
      previous.source !== entry.source
    ) {
      const normalized = normalizePrompt(entry.cmd).toLowerCase();
      const seen = new Set<string>();
      if (normalized) seen.add(normalized);
      blockSeenSets.push(seen);
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

    // O(1) dedup check instead of rebuilding from scratch
    if (previous.prompts.length >= limitPromptsPerBlock) continue;
    const normalized = normalizePrompt(entry.cmd).toLowerCase();
    if (!normalized) continue;
    const seen = blockSeenSets[blockSeenSets.length - 1];
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    previous.prompts.push(entry.cmd);
  }
  return blocks;
}
