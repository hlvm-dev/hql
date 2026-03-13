/**
 * Activity Tools — LLM-routed chronology retrieval.
 *
 * The `recent_activity` tool lets the agent retrieve user activity
 * across sessions when the user asks chronology/recall questions.
 * Replaces hardcoded regex routing previously done in the REPL.
 */

import {
  buildPromptBlocks,
  type ChronologyEntry,
  type ChronologyGrouping,
  DAY_MS,
  DEFAULT_BLOCK_GAP_MS,
  getLocalDateKey,
  getLocalTimeLabel,
  getTimeZone,
  isGreetingOnlyPrompt,
  isLowSignalPrompt,
  isRecallMetaPrompt,
  normalizePrompt,
  type PromptBlock,
} from "../../../common/chronology.ts";
import { loadAllMessages } from "../../store/message-utils.ts";
import { listSessions } from "../../store/conversation-store.ts";
import { readJsonLines } from "../../../common/jsonl.ts";
import { getHistoryPath } from "../../../common/paths.ts";
import { isToolArgsObject } from "../validation.ts";
import { ValidationError } from "../../../common/error.ts";
import { throwIfAborted } from "../../../common/timeout-utils.ts";
import { safeStringify } from "../../../common/safe-stringify.ts";
import type {
  FormattedToolResult,
  ToolExecutionOptions,
  ToolMetadata,
} from "../registry.ts";

// ============================================================
// Types
// ============================================================

type ActivityReference =
  | "last_time"
  | "before_that"
  | "today"
  | "yesterday"
  | "recent"
  | "date";
type ActivitySubject = "activity" | "questions";

interface ActivityBlock {
  date: string;
  time_range: string;
  prompts: string[];
  source: string;
  startTs: number;
  endTs: number;
}

interface ActivityResult {
  reference: string;
  subject: ActivitySubject;
  resolved_label: string;
  blocks: ActivityBlock[];
  total_blocks: number;
  has_older: boolean;
  current_date: string;
  timezone: string;
}

// ============================================================
// History.jsonl reader
// ============================================================

interface HistoryJsonlEntry {
  ts: number;
  cmd: string;
}

function toHistoryEntry(value: unknown): HistoryJsonlEntry | undefined {
  if (
    value && typeof value === "object" &&
    typeof (value as HistoryJsonlEntry).ts === "number" &&
    typeof (value as HistoryJsonlEntry).cmd === "string"
  ) {
    return value as HistoryJsonlEntry;
  }
  return undefined;
}

// ============================================================
// Trailing recall-meta detection (for "before_that" reference)
// ============================================================

/**
 * Count trailing recall/meta prompts at the end of entries.
 * Used by "before_that" to skip past the user's recent recall questions.
 */
function countTrailingRecallMeta(
  entries: readonly ChronologyEntry[],
): number {
  let count = 0;
  let sawRecall = false;

  for (let i = entries.length - 1; i >= 0; i--) {
    const cmd = normalizePrompt(entries[i]?.cmd ?? "");
    if (!cmd) continue;

    if (isRecallMetaPrompt(cmd)) {
      sawRecall = true;
      count += 1;
      continue;
    }

    if (sawRecall && (isLowSignalPrompt(cmd) || isGreetingOnlyPrompt(cmd))) {
      continue;
    }

    break;
  }

  return count;
}

// ============================================================
// Core tool function
// ============================================================

const VALID_REFERENCES = new Set<ActivityReference>([
  "last_time",
  "before_that",
  "today",
  "yesterday",
  "recent",
  "date",
]);
const MAX_OTHER_SESSIONS = 10;
const DEFAULT_LIMIT_BLOCKS = 3;
const PROMPTS_PER_BLOCK = 20;
const DEDUP_WINDOW_MS = 2000;
const VALID_SUBJECTS = new Set<ActivitySubject>(["activity", "questions"]);

async function recentActivity(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<ActivityResult> {
  throwIfAborted(options?.signal);

  const parsed = isToolArgsObject(args) ? args : {};
  const reference = (
      typeof parsed.reference === "string" &&
      VALID_REFERENCES.has(parsed.reference as ActivityReference)
    )
    ? parsed.reference as ActivityReference
    : "recent";
  const offsetBlocks = typeof parsed.offset_blocks === "number"
    ? Math.max(0, Math.floor(parsed.offset_blocks))
    : 0;
  const limitBlocks = typeof parsed.limit_blocks === "number"
    ? Math.max(1, Math.min(20, Math.floor(parsed.limit_blocks)))
    : DEFAULT_LIMIT_BLOCKS;
  const dateArg = typeof parsed.date === "string" ? parsed.date : undefined;
  const subject = (
      typeof parsed.subject === "string" &&
      VALID_SUBJECTS.has(parsed.subject as ActivitySubject)
    )
    ? parsed.subject as ActivitySubject
    : "activity";

  if (reference === "date" && !dateArg) {
    throw new ValidationError(
      'reference="date" requires a "date" argument in YYYY-MM-DD format',
      "recent_activity",
    );
  }

  const sessionId = options?.sessionId;
  const currentUserRequest = normalizePrompt(options?.currentUserRequest ?? "");
  const timeZone = getTimeZone();
  const nowMs = Date.now();

  // 1. Load current session messages
  const currentSessionEntries: ChronologyEntry[] = [];
  if (sessionId) {
    const messages = loadAllMessages(sessionId);
    for (const msg of messages) {
      if (msg.role === "user" && msg.content) {
        const cmd = normalizePrompt(msg.content);
        if (cmd) {
          currentSessionEntries.push({
            ts: new Date(msg.created_at).getTime(),
            cmd,
            source: "current_session",
          });
        }
      }
    }
  }

  // 2. Load recent other sessions
  const otherSessionEntries: ChronologyEntry[] = [];
  const sessions = listSessions();
  let otherCount = 0;
  for (const session of sessions) {
    if (session.id === sessionId) continue;
    if (otherCount >= MAX_OTHER_SESSIONS) break;
    otherCount++;
    const messages = loadAllMessages(session.id);
    for (const msg of messages) {
      if (msg.role === "user" && msg.content) {
        const cmd = normalizePrompt(msg.content);
        if (cmd) {
          otherSessionEntries.push({
            ts: new Date(msg.created_at).getTime(),
            cmd,
            source: "other_session",
          });
        }
      }
    }
  }

  // 3. Load history.jsonl as fallback
  const historyRaw = await readJsonLines(getHistoryPath(), toHistoryEntry);
  const sessionTimestamps = new Set(
    [...currentSessionEntries, ...otherSessionEntries].map((e) => e.ts),
  );
  const historyEntries: ChronologyEntry[] = [];
  for (const entry of historyRaw) {
    const cmd = normalizePrompt(entry.cmd);
    if (!cmd) continue;
    // Dedup: skip history entries that overlap with session entries by timestamp proximity
    let isDuplicate = false;
    for (const sessionTs of sessionTimestamps) {
      if (Math.abs(entry.ts - sessionTs) < DEDUP_WINDOW_MS) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      historyEntries.push({ ts: entry.ts, cmd, source: "history" });
    }
  }

  // 4. Merge + sort ascending
  const allEntries = [
    ...currentSessionEntries,
    ...otherSessionEntries,
    ...historyEntries,
  ].sort((a, b) => a.ts - b.ts);
  const currentQueryEntry = currentUserRequest
    ? [...currentSessionEntries].reverse().find((entry) =>
      normalizePrompt(entry.cmd) === currentUserRequest
    )
    : undefined;
  const entriesForBlocks = currentQueryEntry
    ? allEntries.filter((entry) => entry !== currentQueryEntry)
    : allEntries;

  // 5. Build blocks (ascending input, returns ascending)
  const grouping: ChronologyGrouping = subject === "questions"
    ? "questions"
    : "activity";
  const blocksAscending = buildPromptBlocks(
    entriesForBlocks,
    timeZone,
    DEFAULT_BLOCK_GAP_MS,
    PROMPTS_PER_BLOCK,
    grouping,
  );
  // Newest-first for selection
  const blocksNewestFirst = [...blocksAscending].reverse();
  // 6. Count trailing recall-meta for "before_that"
  const trailingMetaCount = countTrailingRecallMeta(allEntries);

  // 7. Select blocks by reference
  const todayKey = getLocalDateKey(nowMs, timeZone);
  const yesterdayKey = getLocalDateKey(nowMs - DAY_MS, timeZone);

  let matchingBlocks: PromptBlock[];
  let selectedBlocks: PromptBlock[];
  let resolvedLabel: string;

  switch (reference) {
    case "last_time": {
      matchingBlocks = blocksNewestFirst;
      const target = matchingBlocks[offsetBlocks];
      selectedBlocks = target ? [target] : [];
      resolvedLabel = target
        ? `${
          subject === "questions" ? "Last question" : "Last activity"
        } (${target.dateKey} ${getLocalTimeLabel(target.startTs, timeZone)})`
        : subject === "questions"
        ? "No previous question found"
        : "No recent activity found";
      break;
    }
    case "before_that": {
      // trailingMetaCount includes the current "before that?" prompt which
      // hasn't been answered yet — subtract 1 for blocks already shown.
      // Math.max(1, ...) ensures we always skip past the most recent block.
      const baseSkip = Math.max(1, trailingMetaCount - 1);
      matchingBlocks = blocksNewestFirst.slice(baseSkip);
      const target = matchingBlocks[offsetBlocks];
      selectedBlocks = target ? [target] : [];
      resolvedLabel = target
        ? `${
          subject === "questions" ? "Earlier question" : "Earlier activity"
        } (${target.dateKey} ${getLocalTimeLabel(target.startTs, timeZone)})`
        : subject === "questions"
        ? "No earlier question found"
        : "No earlier activity found";
      break;
    }
    case "today": {
      matchingBlocks = blocksNewestFirst.filter((b) => b.dateKey === todayKey);
      selectedBlocks = matchingBlocks.slice(
        offsetBlocks,
        offsetBlocks + limitBlocks,
      );
      resolvedLabel = `${
        subject === "questions" ? "Questions" : "Activity"
      } today (${todayKey})`;
      break;
    }
    case "yesterday": {
      matchingBlocks = blocksNewestFirst.filter((b) =>
        b.dateKey === yesterdayKey
      );
      selectedBlocks = matchingBlocks.slice(
        offsetBlocks,
        offsetBlocks + limitBlocks,
      );
      resolvedLabel = `${
        subject === "questions" ? "Questions" : "Activity"
      } yesterday (${yesterdayKey})`;
      break;
    }
    case "date": {
      matchingBlocks = blocksNewestFirst.filter((b) => b.dateKey === dateArg);
      selectedBlocks = matchingBlocks.slice(
        offsetBlocks,
        offsetBlocks + limitBlocks,
      );
      resolvedLabel = `${
        subject === "questions" ? "Questions" : "Activity"
      } on ${dateArg!}`;
      break;
    }
    case "recent":
    default: {
      matchingBlocks = blocksNewestFirst;
      selectedBlocks = matchingBlocks.slice(
        offsetBlocks,
        offsetBlocks + limitBlocks,
      );
      resolvedLabel = subject === "questions"
        ? "Recent questions"
        : "Recent activity";
      break;
    }
  }

  // 8. Convert to output format
  const blocks: ActivityBlock[] = selectedBlocks.map((block) => ({
    date: block.dateKey,
    time_range: `${getLocalTimeLabel(block.startTs, timeZone)} – ${
      getLocalTimeLabel(block.endTs, timeZone)
    }`,
    prompts: block.prompts,
    source: block.source,
    startTs: block.startTs,
    endTs: block.endTs,
  }));

  const totalBlocks = matchingBlocks.length;

  return {
    reference,
    subject,
    resolved_label: resolvedLabel,
    blocks,
    total_blocks: totalBlocks,
    has_older: offsetBlocks + selectedBlocks.length < totalBlocks,
    current_date: todayKey,
    timezone: timeZone,
  };
}

// ============================================================
// Format result for display
// ============================================================

function formatRecentActivityResult(
  result: unknown,
): FormattedToolResult | null {
  if (!result || typeof result !== "object") return null;
  const data = result as ActivityResult;
  if (!Array.isArray(data.blocks)) return null;

  if (data.blocks.length === 0) {
    const resolvedLabel = data.resolved_label.trim();
    const summary = resolvedLabel
      ? /^no\b/i.test(resolvedLabel)
        ? resolvedLabel
        : `No ${
          resolvedLabel.charAt(0).toLowerCase() + resolvedLabel.slice(1)
        }`
      : data.subject === "questions"
      ? "No questions found"
      : "No activity found";
    return {
      summaryDisplay: summary,
      returnDisplay: summary,
    };
  }

  const lines: string[] = [
    `${data.resolved_label} (${data.blocks.length} block${
      data.blocks.length > 1 ? "s" : ""
    })`,
  ];
  for (const block of data.blocks) {
    lines.push(`  ${block.date} ${block.time_range} [${block.source}]`);
    for (const prompt of block.prompts.slice(0, 5)) {
      lines.push(`    - ${prompt}`);
    }
    if (block.prompts.length > 5) {
      lines.push(`    ... +${block.prompts.length - 5} more`);
    }
  }
  if (data.has_older) {
    lines.push(
      `  (${data.total_blocks - data.blocks.length} older blocks available)`,
    );
  }

  return {
    summaryDisplay: lines[0],
    returnDisplay: lines.join("\n"),
  };
}

// ============================================================
// Export
// ============================================================

export const ACTIVITY_TOOLS: Record<string, ToolMetadata> = {
  recent_activity: {
    fn: recentActivity,
    description: "Retrieve recent user activity across sessions. " +
      "Call this when the user asks about what they did previously, " +
      "last time, before that, recently, yesterday, today, or any " +
      'chronology/recall question. Use subject="questions" when the user ' +
      'is asking about literal prior prompts/questions (excluding chronology-navigation prompts), ' +
      'and subject="activity" when they are asking about what they worked on or did.',
    category: "meta",
    args: {
      reference:
        'string (optional) - "last_time" | "before_that" | "today" | "yesterday" | "recent" | "date". Default: "recent"',
      subject:
        'string (optional) - "activity" | "questions". Use "questions" for literal past prompts/questions, excluding chronology-navigation prompts. Default: "activity"',
      offset_blocks:
        "number (optional) - Skip N blocks from the most recent. Default: 0",
      date: 'string (optional) - YYYY-MM-DD. Only when reference="date"',
      limit_blocks: "number (optional) - Max blocks to return. Default: 3",
    },
    returns: {
      blocks: "array - { date, time_range, prompts[], source, startTs, endTs }",
      total_blocks: "number - Total blocks available",
      has_older: "boolean - Whether older blocks exist",
      current_date: "string - Today's date in local timezone",
    },
    safetyLevel: "L0",
    safety: "Read-only access to local conversation history",
    formatResult: formatRecentActivityResult,
  },
};
