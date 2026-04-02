import type { PlatformEnv } from "../../../../platform/types.ts";
import {
  type AnyAttachment,
  type Attachment,
  cloneAttachment,
  getDisplayName,
  getPastedTextPreviewLabel,
  type TextAttachment,
} from "../../repl/attachment.ts";
import { isShellCommandText } from "./submit-routing.ts";

export type QueuedInputKind = "chat" | "eval" | "command";

export interface ConversationComposerDraft {
  text: string;
  attachments: AnyAttachment[];
  cursorOffset: number;
  queuedAt?: number;
  queuedKind?: QueuedInputKind;
}

export type ConversationQueueEditBinding = "alt-up" | "shift-left";

interface QueueShiftResult {
  draft?: ConversationComposerDraft;
  remaining: ConversationComposerDraft[];
}

interface RenumberDraftResult {
  draft: ConversationComposerDraft;
  nextAttachmentId: number;
}

function cloneDraft(
  draft: ConversationComposerDraft,
): ConversationComposerDraft {
  return {
    text: draft.text,
    attachments: draft.attachments.map(cloneAttachment),
    cursorOffset: clampCursorOffset(draft.text, draft.cursorOffset),
    queuedAt: draft.queuedAt,
    queuedKind: draft.queuedKind,
  };
}

function cloneQueue(
  drafts: ConversationComposerDraft[],
): ConversationComposerDraft[] {
  return drafts.map(cloneDraft);
}

function renameAttachment(
  attachment: AnyAttachment,
  id: number,
): AnyAttachment {
  if ("content" in attachment) {
    const textAttachment: TextAttachment = {
      ...attachment,
      id,
      displayName: getPastedTextPreviewLabel(
        id,
        attachment.content,
        attachment.lineCount,
      ),
    };
    return textAttachment;
  }
  const fileAttachment: Attachment = {
    ...attachment,
    id,
    displayName: getDisplayName(attachment.type, id),
    metadata: attachment.metadata ? { ...attachment.metadata } : undefined,
  };
  return fileAttachment;
}

function clampCursorOffset(text: string, cursorOffset = text.length): number {
  return Math.max(0, Math.min(cursorOffset, text.length));
}

function replaceAttachmentDisplayName(
  text: string,
  cursorOffset: number,
  currentDisplayName: string,
  nextDisplayName: string,
): { text: string; cursorOffset: number } {
  if (currentDisplayName === nextDisplayName) {
    return { text, cursorOffset };
  }

  let result = "";
  let searchStart = 0;
  let nextCursorOffset = cursorOffset;

  while (true) {
    const matchIndex = text.indexOf(currentDisplayName, searchStart);
    if (matchIndex < 0) {
      result += text.slice(searchStart);
      break;
    }

    result += text.slice(searchStart, matchIndex) + nextDisplayName;
    if (matchIndex < cursorOffset) {
      nextCursorOffset += nextDisplayName.length - currentDisplayName.length;
    }
    searchStart = matchIndex + currentDisplayName.length;
  }

  return {
    text: result,
    cursorOffset: clampCursorOffset(result, nextCursorOffset),
  };
}

// O(1) whitespace check via charCode (avoids regex engine per character)
function isWhitespace(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

export function trimConversationDraftText(
  text: string,
  cursorOffset = text.length,
): { text: string; cursorOffset: number } {
  let start = 0;
  let end = text.length;

  while (start < end && isWhitespace(text[start])) {
    start += 1;
  }
  while (end > start && isWhitespace(text[end - 1])) {
    end -= 1;
  }

  if (start === end) {
    return { text: "", cursorOffset: 0 };
  }

  return {
    text: text.slice(start, end),
    cursorOffset: clampCursorOffset(text, cursorOffset) - start,
  };
}

export function createConversationComposerDraft(
  text: string,
  attachments?: AnyAttachment[],
  cursorOffset = text.length,
  queuedAt?: number,
  queuedKind?: QueuedInputKind,
): ConversationComposerDraft {
  return {
    text,
    attachments: (attachments ?? []).map(cloneAttachment),
    cursorOffset: clampCursorOffset(text, cursorOffset),
    queuedAt,
    queuedKind,
  };
}

export function resolveQueuedInputKind(text: string): QueuedInputKind {
  const trimmed = text.trim();
  if (isShellCommandText(trimmed)) {
    return "command";
  }
  if (trimmed.startsWith("(")) {
    return "eval";
  }
  return "chat";
}

export function getQueuedDraftKind(
  draft: ConversationComposerDraft,
): QueuedInputKind {
  return draft.queuedKind ?? resolveQueuedInputKind(draft.text);
}

export function hasConversationDraftContent(
  draft: ConversationComposerDraft | null | undefined,
): boolean {
  if (!draft) return false;
  return draft.text.trim().length > 0 || draft.attachments.length > 0;
}

export function enqueueConversationDraft(
  queue: ConversationComposerDraft[],
  draft: ConversationComposerDraft,
): ConversationComposerDraft[] {
  if (!hasConversationDraftContent(draft)) {
    return cloneQueue(queue);
  }
  const queuedDraft = cloneDraft({
    ...draft,
    queuedAt: draft.queuedAt ?? Date.now(),
    queuedKind: draft.queuedKind ?? resolveQueuedInputKind(draft.text),
  });
  return [...cloneQueue(queue), queuedDraft];
}

export function shiftQueuedConversationDraft(
  queue: ConversationComposerDraft[],
): QueueShiftResult {
  if (queue.length === 0) {
    return { draft: undefined, remaining: [] };
  }
  const [draft, ...remaining] = queue;
  return {
    draft: cloneDraft(draft),
    remaining: cloneQueue(remaining),
  };
}

export function popLastQueuedConversationDraft(
  queue: ConversationComposerDraft[],
): QueueShiftResult {
  if (queue.length === 0) {
    return { draft: undefined, remaining: [] };
  }
  const remaining = queue.slice(0, -1);
  return {
    draft: cloneDraft(queue[queue.length - 1]),
    remaining: cloneQueue(remaining),
  };
}

export function renumberConversationDraftAttachments(
  draft: ConversationComposerDraft,
  startAttachmentId = 1,
): RenumberDraftResult {
  let text = draft.text;
  let cursorOffset = clampCursorOffset(draft.text, draft.cursorOffset);
  let nextAttachmentId = startAttachmentId;
  const attachments = draft.attachments.map((attachment) => {
    const renamed = renameAttachment(attachment, nextAttachmentId++);
    const replaced = replaceAttachmentDisplayName(
      text,
      cursorOffset,
      attachment.displayName,
      renamed.displayName,
    );
    text = replaced.text;
    cursorOffset = replaced.cursorOffset;
    return renamed;
  });
  return {
    draft: {
      text,
      attachments,
      cursorOffset,
    },
    nextAttachmentId,
  };
}

export function mergeConversationDraftsForInterrupt(
  queuedDrafts: ConversationComposerDraft[],
  currentDraft?: ConversationComposerDraft | null,
): ConversationComposerDraft | null {
  const drafts = cloneQueue(queuedDrafts);
  if (hasConversationDraftContent(currentDraft)) {
    drafts.push(cloneDraft(currentDraft!));
  }
  if (drafts.length === 0) {
    return null;
  }
  if (drafts.length === 1) {
    return cloneDraft(drafts[0]);
  }

  let nextAttachmentId = 1;
  const merged: ConversationComposerDraft = {
    text: "",
    attachments: [],
    cursorOffset: 0,
  };

  for (const draft of drafts) {
    const renumbered = renumberConversationDraftAttachments(
      draft,
      nextAttachmentId,
    );
    nextAttachmentId = renumbered.nextAttachmentId;
    if (merged.text.length > 0 && renumbered.draft.text.length > 0) {
      merged.text += "\n";
    }
    merged.text += renumbered.draft.text;
    merged.attachments.push(...renumbered.draft.attachments);
  }

  merged.cursorOffset = merged.text.length;

  return merged;
}

export function getConversationQueueEditBinding(
  env: Pick<PlatformEnv, "get">,
): ConversationQueueEditBinding {
  const termProgram = env.get("TERM_PROGRAM")?.trim().toLowerCase() ?? "";
  if (
    termProgram === "apple_terminal" ||
    termProgram === "warpterminal" ||
    termProgram === "vscode" ||
    env.get("VSCODE_INJECTION") ||
    env.get("VSCODE_GIT_IPC_HANDLE")
  ) {
    return "shift-left";
  }
  return "alt-up";
}

export function getConversationQueueEditBindingLabel(
  binding: ConversationQueueEditBinding,
): string {
  return binding === "shift-left" ? "Shift+\u2190" : "Alt+\u2191";
}

export function getConversationDraftPreview(
  draft: ConversationComposerDraft,
): string {
  const firstNonEmptyLine = draft.text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstNonEmptyLine) {
    return firstNonEmptyLine;
  }
  return draft.attachments.map((attachment) => attachment.displayName).join(
    " ",
  );
}
