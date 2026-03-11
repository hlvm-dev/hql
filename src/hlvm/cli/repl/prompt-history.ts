import type { HistoryEntry } from "./history-storage.ts";
import type { ReplState } from "./state.ts";
import type { SessionMessage } from "./session/types.ts";

export type PromptHistorySource =
  | "evaluate"
  | "command"
  | "conversation"
  | "interaction";

export function shouldRecordPromptHistory(
  source: PromptHistorySource,
): boolean {
  return source !== "evaluate";
}

export function recordPromptHistory(
  replState: Pick<ReplState, "addHistory">,
  input: string,
  source: PromptHistorySource,
): void {
  if (!shouldRecordPromptHistory(source)) {
    return;
  }
  replState.addHistory(input);
}

const DEFAULT_RECENT_PROMPT_LIMIT = 20;
const DEFAULT_BLOCK_GAP_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PromptHistoryContextOptions {
  nowMs?: number;
  timeZone?: string;
  limitBlocks?: number;
  limitPromptsPerBlock?: number;
  blockGapMs?: number;
  sessionMessages?: readonly SessionMessage[];
}

type RecencyQueryKind =
  | "last_time"
  | "before_that"
  | "yesterday"
  | "today"
  | "recent";

interface RecencyQueryDescriptor {
  kind: RecencyQueryKind;
}

type ChronologySource = "current_session" | "history_fallback";

interface ChronologyEntry {
  ts: number;
  cmd: string;
  source: ChronologySource;
}

interface PromptBlock {
  dateKey: string;
  startTs: number;
  endTs: number;
  prompts: string[];
  source: ChronologySource;
}

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

const RECENCY_QUERY_PATTERNS = [
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

function normalizePrompt(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function classifyPromptRecencyQuery(
  input: string,
): RecencyQueryDescriptor | null {
  const normalized = normalizePrompt(input);
  if (!normalized) return null;
  if (/\byesterday\b/i.test(normalized)) return { kind: "yesterday" };
  if (/\btoday\b/i.test(normalized)) return { kind: "today" };
  if (
    /\bbefore that\b/i.test(normalized) ||
    /\bbefore then\b/i.test(normalized) ||
    /\bearlier than that\b/i.test(normalized) ||
    /\bfurther back\b/i.test(normalized) ||
    /\bfarther back\b/i.test(normalized)
  ) {
    return { kind: "before_that" };
  }
  if (
    /\bmost recent\b/i.test(normalized) ||
    /\blast time\b/i.test(normalized) ||
    /\blast command\b/i.test(normalized) ||
    /\bwhat did i do\b/i.test(normalized) ||
    /\bwhat did i ask\b/i.test(normalized) ||
    /\bwhat was the last\b/i.test(normalized)
  ) {
    return { kind: "last_time" };
  }
  if (/\brecently\b/i.test(normalized) || /\bprevious\b/i.test(normalized)) {
    return { kind: "recent" };
  }
  return null;
}

export function isPromptRecencyQuery(input: string): boolean {
  const normalized = normalizePrompt(input);
  return RECENCY_QUERY_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    classifyPromptRecencyQuery(normalized) !== null;
}

function isLowSignalPrompt(input: string): boolean {
  const normalized = normalizePrompt(input).toLowerCase();
  return LOW_SIGNAL_PROMPTS.has(normalized);
}

function isGreetingOnlyPrompt(input: string): boolean {
  return GREETING_ONLY_PATTERN.test(normalizePrompt(input));
}

function isSlashCommandPrompt(input: string): boolean {
  return SLASH_COMMAND_PATTERN.test(normalizePrompt(input));
}

function isMeaningfulPrompt(input: string): boolean {
  const normalized = normalizePrompt(input);
  return !!normalized &&
    !isLowSignalPrompt(normalized) &&
    !isGreetingOnlyPrompt(normalized) &&
    !isSlashCommandPrompt(normalized) &&
    classifyPromptRecencyQuery(normalized) === null;
}

function getTimeZone(options?: PromptHistoryContextOptions): string {
  return options?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC";
}

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

function getLocalDateKey(ts: number, timeZone: string): string {
  const { year, month, day } = getDateParts(ts, timeZone);
  return `${year}-${month}-${day}`;
}

function getLocalTimeLabel(ts: number, timeZone: string): string {
  const { hour, minute } = getDateParts(ts, timeZone);
  return `${hour}:${minute}`;
}

function formatBlockLabel(block: PromptBlock, timeZone: string): string {
  return `${block.dateKey} ${getLocalTimeLabel(block.startTs, timeZone)}-${
    getLocalTimeLabel(block.endTs, timeZone)
  } [${getChronologySourceLabel(block.source)}]`;
}

function dedupePrompts(prompts: string[], limit: number): string[] {
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

function getChronologySourceLabel(source: ChronologySource): string {
  return source === "current_session"
    ? "current-session transcript"
    : "repl-history fallback";
}

function toHistoryChronologyEntries(
  entries: readonly HistoryEntry[],
): ChronologyEntry[] {
  return entries
    .map((entry) => ({
      ts: entry.ts,
      cmd: normalizePrompt(entry.cmd),
      source: "history_fallback" as const,
    }))
    .filter((entry) => entry.cmd);
}

function toSessionChronologyEntries(
  messages: readonly SessionMessage[],
): ChronologyEntry[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => ({
      ts: message.ts,
      cmd: normalizePrompt(message.content),
      source: "current_session" as const,
    }))
    .filter((entry) => entry.cmd);
}

function buildChronologyEntries(
  historyEntries: readonly HistoryEntry[],
  sessionMessages: readonly SessionMessage[],
): ChronologyEntry[] {
  const sessionEntries = toSessionChronologyEntries(sessionMessages);
  if (sessionEntries.length === 0) {
    return toHistoryChronologyEntries(historyEntries);
  }

  const sessionStartTs = Math.min(...sessionEntries.map((entry) => entry.ts));
  const fallbackHistoryEntries = historyEntries.filter((entry) =>
    entry.ts < sessionStartTs
  );

  return [
    ...toHistoryChronologyEntries(fallbackHistoryEntries),
    ...sessionEntries,
  ].sort((left, right) => left.ts - right.ts);
}

function buildPromptBlocks(
  entries: readonly ChronologyEntry[],
  timeZone: string,
  blockGapMs: number,
  limitPromptsPerBlock: number,
): PromptBlock[] {
  const meaningfulEntries = entries
    .filter((entry) => entry.cmd && isMeaningfulPrompt(entry.cmd));

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

function collectTrailingRecencyMeta(
  entries: readonly ChronologyEntry[],
): { count: number; ignoredPrompts: string[] } {
  const ignored: string[] = [];
  let count = 0;
  let sawRecency = false;

  for (let index = entries.length - 1; index >= 0; index--) {
    const prompt = normalizePrompt(entries[index]?.cmd ?? "");
    if (!prompt) continue;

    if (classifyPromptRecencyQuery(prompt)) {
      sawRecency = true;
      count += 1;
      ignored.unshift(prompt);
      continue;
    }

    if (
      sawRecency &&
      (isLowSignalPrompt(prompt) || isGreetingOnlyPrompt(prompt))
    ) {
      ignored.unshift(prompt);
      continue;
    }

    break;
  }

  return { count, ignoredPrompts: ignored };
}

function describeQuerySelection(
  query: RecencyQueryDescriptor,
  targetIndex: number,
  targetDateKey: string | null,
): string {
  switch (query.kind) {
    case "before_that":
      return `Question type: before_that. Use the task block at index ${
        targetIndex + 1
      } (newest-first) because the user is asking to go further back.`;
    case "yesterday":
      return `Question type: yesterday. Use only task blocks from ${targetDateKey}.`;
    case "today":
      return `Question type: today. Use only task blocks from ${targetDateKey}.`;
    case "recent":
      return "Question type: recent. Prefer the newest meaningful task block unless the user asks for a broader recap.";
    case "last_time":
    default:
      return "Question type: last_time. Use the newest meaningful task block and ignore trailing recall/meta prompts.";
  }
}

function selectRelevantBlocks(
  blocksRecentFirst: readonly PromptBlock[],
  query: RecencyQueryDescriptor,
  trailingMetaCount: number,
  targetDateKey: string | null,
  limitBlocks: number,
): { relevantBlocks: PromptBlock[]; targetBlock?: PromptBlock } {
  if (query.kind === "yesterday" || query.kind === "today") {
    const relevant = blocksRecentFirst
      .filter((block) => block.dateKey === targetDateKey)
      .slice(0, limitBlocks);
    return { relevantBlocks: relevant, targetBlock: relevant[0] };
  }

  const targetIndex = query.kind === "before_that"
    ? trailingMetaCount
    : 0;
  const targetBlock = blocksRecentFirst[targetIndex];
  return targetBlock
    ? { relevantBlocks: [targetBlock], targetBlock }
    : { relevantBlocks: [] };
}

export function buildRecentPromptHistoryContext(
  historyEntries: readonly HistoryEntry[],
  currentInput: string,
  options: PromptHistoryContextOptions = {},
): string | null {
  const query = classifyPromptRecencyQuery(currentInput);
  if (!query) return null;

  const timeZone = getTimeZone(options);
  const normalizedCurrent = normalizePrompt(currentInput);
  const limitBlocks = options.limitBlocks ?? 4;
  const limitPromptsPerBlock = options.limitPromptsPerBlock ??
    DEFAULT_RECENT_PROMPT_LIMIT;
  const blockGapMs = options.blockGapMs ?? DEFAULT_BLOCK_GAP_MS;
  const nowMs = options.nowMs ?? Date.now();
  const targetDateKey = query.kind === "yesterday"
    ? getLocalDateKey(nowMs - DAY_MS, timeZone)
    : query.kind === "today"
    ? getLocalDateKey(nowMs, timeZone)
    : null;

  const entries = buildChronologyEntries(
    historyEntries,
    options.sessionMessages ?? [],
  );

  if (entries.at(-1)?.cmd === normalizedCurrent) {
    entries.pop();
  }

  const trailingMeta = collectTrailingRecencyMeta(entries);
  const blocksRecentFirst = buildPromptBlocks(
    entries,
    timeZone,
    blockGapMs,
    limitPromptsPerBlock,
  ).reverse();

  const targetIndex = query.kind === "before_that" ? trailingMeta.count : 0;
  const { relevantBlocks, targetBlock } = selectRelevantBlocks(
    blocksRecentFirst,
    query,
    trailingMeta.count,
    targetDateKey,
    limitBlocks,
  );

  const lines = [
    "# Structured REPL Chronology",
    "Answer the user's chronology question from this structured REPL history only.",
    "Do not use durable memory, global memory facts, or unrelated older topics outside the selected task blocks below.",
    "Prefer current-session transcript blocks first. Use global REPL history only as fallback older than the active session.",
    describeQuerySelection(query, targetIndex, targetDateKey),
    `Current local date: ${getLocalDateKey(nowMs, timeZone)}`,
  ];

  if (trailingMeta.ignoredPrompts.length > 0) {
    lines.push(
      "Ignored trailing recall/meta prompts while selecting chronology:",
      ...trailingMeta.ignoredPrompts.map((prompt) => `- ${prompt}`),
    );
  }

  if (relevantBlocks.length === 0) {
    lines.push(
      targetDateKey
        ? `No meaningful task blocks were found for ${targetDateKey}.`
        : "No earlier meaningful task block was found beyond the available prompt history.",
      "If the user asks for something outside the available history, say that plainly.",
    );
    return lines.join("\n");
  }

  lines.push("Relevant task blocks (newest first):");
  for (const [index, block] of relevantBlocks.entries()) {
    lines.push(
      `${index + 1}. ${formatBlockLabel(block, timeZone)}${
        block === targetBlock ? " [TARGET]" : ""
      }`,
      ...block.prompts.map((prompt) => `- ${prompt}`),
    );
  }
  lines.push(
    "Answer at the task-block level, not as a raw line-by-line dump of every prompt.",
    "If the user asks for yesterday/today, be explicit about the date in the answer.",
    "If the available history is insufficient, say so plainly.",
  );

  return lines.join("\n");
}
