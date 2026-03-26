import { appendJsonLine } from "../../../common/jsonl.ts";
import { getDebugLogPath } from "../../../common/paths.ts";
import type { ComposerLanguage } from "./composer-language.ts";
import type { HistoryEntrySource } from "./history-storage.ts";
import type { ReplState } from "./state.ts";

export type PromptHistorySource = HistoryEntrySource;

export interface PromptHistoryTraceEvent {
  readonly event:
    | "record"
    | "history-up"
    | "history-down"
    | "history-restore-draft"
    | "history-search-confirm";
  readonly text: string;
  readonly ts?: number;
  readonly source?: PromptHistorySource;
  readonly language?: ComposerLanguage;
  readonly historyIndex?: number;
}

function detectPromptHistoryLanguage(
  input: string,
  source: PromptHistorySource,
): ComposerLanguage {
  if (source === "conversation" || source === "interaction") {
    return "chat";
  }
  if (source === "command") {
    return "chat";
  }

  const trimmed = input.trimStart();
  if (/^(?:js|javascript)\b/.test(trimmed)) {
    return "js";
  }
  if (/^(?:ts|typescript)\b/.test(trimmed)) {
    return "ts";
  }

  return "hql";
}

export function shouldRecordPromptHistory(
  source: PromptHistorySource,
): boolean {
  return true;
}

export function tracePromptHistoryEvent(event: PromptHistoryTraceEvent): void {
  const record = {
    ...event,
    ts: event.ts ?? Date.now(),
  };
  void appendJsonLine(getDebugLogPath(), record).catch(() => {
    // Best effort debug tracing only.
  });
}

export function recordPromptHistory(
  replState: Pick<ReplState, "addHistory">,
  input: string,
  source: PromptHistorySource,
  language?: ComposerLanguage,
): void {
  if (!shouldRecordPromptHistory(source)) {
    return;
  }
  const resolvedLanguage = language ?? detectPromptHistoryLanguage(input, source);
  replState.addHistory(input, {
    source,
    language: resolvedLanguage,
  });
  tracePromptHistoryEvent({
    event: "record",
    text: input.trim(),
    source,
    language: resolvedLanguage,
  });
}
