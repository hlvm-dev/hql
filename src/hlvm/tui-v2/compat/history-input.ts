// Compat domain: history / input adapter.
//
// Purpose: prompt history, Ctrl+R reverse history search, and the queue of
// drafts that land when the runtime is busy all need one owning adapter so
// that the v2 composer and any transplanted CC history UX share a single
// source of truth.
//
// STATUS: scaffold. v2 currently uses v1's `useHistorySearch` hook and the
// `conversation-queue` utility directly from `src/hlvm/cli/repl-ink/`.

export interface HistoryEntry {
  readonly id: string;
  readonly text: string;
  readonly submittedAt: number;
}

export interface HistoryInputAdapter {
  readEntries(): readonly HistoryEntry[];
  append(text: string): void;
  searchReverse(query: string): readonly HistoryEntry[];
  readonly queueLength: number;
}
