import { truncate } from "../../common/utils.ts";
import type { DelegateTranscriptSnapshot } from "./delegate-transcript.ts";
import { runtimeUpdate } from "./runtime-messages.ts";

export interface BackgroundDelegateUpdate {
  threadId: string;
  nickname: string;
  agent: string;
  task: string;
  success: boolean;
  summary?: string;
  error?: string;
  snapshot?: DelegateTranscriptSnapshot;
  childSessionId?: string;
  attentionRequired?: boolean;
  attentionReason?: string;
}

export interface DelegateInbox {
  push(update: BackgroundDelegateUpdate): void;
  drain(): BackgroundDelegateUpdate[];
  size(): number;
}

export function createDelegateInbox(): DelegateInbox {
  const queue: BackgroundDelegateUpdate[] = [];
  return {
    push(update) {
      queue.push(update);
    },
    drain() {
      if (queue.length === 0) return [];
      const drained = queue.slice();
      queue.length = 0;
      return drained;
    },
    size() {
      return queue.length;
    },
  };
}

function resolveUpdateDetail(update: BackgroundDelegateUpdate): string {
  if (update.success) {
    return truncate(
      update.summary ?? update.snapshot?.finalResponse ??
        "Completed without a summarized result.",
      240,
    );
  }
  return truncate(
    update.error ?? update.snapshot?.error ?? "No error was provided.",
    240,
  );
}

export function formatDelegateInboxUpdateMessage(
  update: BackgroundDelegateUpdate,
): string {
  const attentionPrefix = update.attentionRequired
    ? "[ATTENTION REQUIRED] "
    : "";
  const prefix = `${attentionPrefix}${update.nickname} [${update.agent}]`;
  const task = `"${truncate(update.task, 120)}"`;
  const detail = resolveUpdateDetail(update);
  if (update.success) {
    return runtimeUpdate(`${prefix} completed ${task}. Result: ${detail}`);
  }
  return runtimeUpdate(`${prefix} failed ${task}. Error: ${detail}`);
}
