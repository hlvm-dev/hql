/**
 * ComposerSurface
 *
 * Owns composer-local state so ordinary typing only rerenders the composer
 * subtree instead of the top-level REPL shell.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box } from "ink";
import type { ReplState } from "../../repl/state.ts";
import { recordPromptHistory } from "../../repl/prompt-history.ts";
import { Input } from "./Input.tsx";
import { QueuePreview, buildQueuePreviewLines } from "./QueuePreview.tsx";
import {
  type ConversationComposerDraft,
  type ConversationQueueEditBinding,
  createConversationComposerDraft,
  enqueueConversationDraft,
  getConversationQueueEditBinding,
  getConversationQueueEditBindingLabel,
  popLastQueuedConversationDraft,
} from "../utils/conversation-queue.ts";
import { useAttachments } from "../hooks/useAttachments.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import type { AnyAttachment } from "../hooks/useAttachments.ts";

export interface ComposerSurfaceUiState {
  hasDraftInput: boolean;
  queuedDraftCount: number;
  queuePreviewRows: number;
}

export interface ComposerSurfaceHandle {
  clearDraft: () => void;
  getAttachmentCount: () => number;
  getCurrentDraft: () => ConversationComposerDraft;
  getDraftText: () => string;
  getPendingQueue: () => ConversationComposerDraft[];
  restoreDraft: (draft: ConversationComposerDraft | null) => void;
  setPendingQueue: React.Dispatch<React.SetStateAction<ConversationComposerDraft[]>>;
}

interface ComposerSurfaceProps {
  replState: ReplState;
  onSubmit: (value: string, attachments?: AnyAttachment[]) => void;
  onForceSubmit?: (value: string, attachments?: AnyAttachment[]) => void;
  onInterruptRunningTask?: () => void;
  onCycleMode?: () => void;
  onUiStateChange?: (state: ComposerSurfaceUiState) => void;
  disabled?: boolean;
  highlightMode?: "code" | "chat";
  promptLabel?: string;
  isConversationContext?: boolean;
  isConversationTaskRunning?: boolean;
  queueEnabled?: boolean;
}

export const ComposerSurface = forwardRef<
  ComposerSurfaceHandle,
  ComposerSurfaceProps
>(function ComposerSurface(
  {
    replState,
    onSubmit,
    onForceSubmit,
    onInterruptRunningTask,
    onCycleMode,
    onUiStateChange,
    disabled = false,
    highlightMode = "code",
    promptLabel = "hlvm>",
    isConversationContext = false,
    isConversationTaskRunning = false,
    queueEnabled = false,
  }: ComposerSurfaceProps,
  ref: React.ForwardedRef<ComposerSurfaceHandle>,
): React.ReactElement {
  const [input, setInput] = useState("");
  const attachmentState = useAttachments();
  const [restoredComposerDraftRevision, setRestoredComposerDraftRevision] =
    useState(0);
  const [restoredComposerCursorOffset, setRestoredComposerCursorOffset] =
    useState(0);
  const [pendingConversationQueue, setPendingConversationQueue] = useState<
    ConversationComposerDraft[]
  >([]);

  const inputRef = useRef(input);
  inputRef.current = input;
  const pendingQueueRef = useRef(pendingConversationQueue);
  pendingQueueRef.current = pendingConversationQueue;
  const attachmentsRef = useRef(attachmentState.attachments);
  attachmentsRef.current = attachmentState.attachments;

  const queueEditBinding = useMemo<ConversationQueueEditBinding>(
    () => getConversationQueueEditBinding(getPlatform().env),
    [],
  );
  const queueEditBindingLabel = useMemo(
    () => getConversationQueueEditBindingLabel(queueEditBinding),
    [queueEditBinding],
  );
  const queuePreviewRows = useMemo(
    () =>
      buildQueuePreviewLines(
        pendingConversationQueue,
        queueEditBindingLabel,
      ).length,
    [pendingConversationQueue, queueEditBindingLabel],
  );

  const restoreDraft = useCallback(
    (draft: ConversationComposerDraft | null) => {
      if (!draft) {
        setInput("");
        attachmentState.clearAttachments();
        setRestoredComposerCursorOffset(0);
        setRestoredComposerDraftRevision((prev: number) => prev + 1);
        return;
      }

      setInput(draft.text);
      attachmentState.replaceAttachments(draft.attachments);
      setRestoredComposerCursorOffset(draft.cursorOffset);
      setRestoredComposerDraftRevision((prev: number) => prev + 1);
    },
    [attachmentState],
  );

  const clearDraft = useCallback(() => {
    restoreDraft(null);
  }, [restoreDraft]);

  const getCurrentDraft = useCallback((): ConversationComposerDraft => {
    return createConversationComposerDraft(
      inputRef.current,
      attachmentsRef.current,
    );
  }, []);

  const handleQueueDraft = useCallback((draft: ConversationComposerDraft) => {
    recordPromptHistory(replState, draft.text, "conversation");
    setPendingConversationQueue((prev: ConversationComposerDraft[]) =>
      enqueueConversationDraft(prev, draft)
    );
    attachmentState.clearAttachments();
  }, [attachmentState, replState]);

  const handleEditLastQueuedDraft = useCallback(() => {
    const { draft, remaining } = popLastQueuedConversationDraft(
      pendingQueueRef.current,
    );
    if (!draft) return;
    setPendingConversationQueue(remaining);
    restoreDraft(draft);
  }, [restoreDraft]);

  useImperativeHandle(ref, () => ({
    clearDraft,
    getAttachmentCount: () => attachmentsRef.current.length,
    getCurrentDraft,
    getDraftText: () => inputRef.current,
    getPendingQueue: () => pendingQueueRef.current,
    restoreDraft,
    setPendingQueue: setPendingConversationQueue,
  }), [clearDraft, getCurrentDraft, restoreDraft]);

  const uiState = useMemo<ComposerSurfaceUiState>(() => ({
    hasDraftInput: input.trim().length > 0 || attachmentState.attachments.length > 0,
    queuedDraftCount: pendingConversationQueue.length,
    queuePreviewRows,
  }), [
    attachmentState.attachments.length,
    input,
    pendingConversationQueue.length,
    queuePreviewRows,
  ]);

  const lastUiStateRef = useRef<ComposerSurfaceUiState | null>(null);
  useEffect(() => {
    if (!onUiStateChange) return;
    const lastState = lastUiStateRef.current;
    if (
      lastState &&
      lastState.hasDraftInput === uiState.hasDraftInput &&
      lastState.queuedDraftCount === uiState.queuedDraftCount &&
      lastState.queuePreviewRows === uiState.queuePreviewRows
    ) {
      return;
    }
    lastUiStateRef.current = uiState;
    onUiStateChange(uiState);
  }, [onUiStateChange, uiState]);

  return (
    <>
      {isConversationContext && pendingConversationQueue.length > 0 && (
        <QueuePreview
          items={pendingConversationQueue}
          editBindingLabel={queueEditBindingLabel}
        />
      )}

      <Box
        flexDirection="column"
      >
        <Input
          value={input}
          onChange={setInput}
          onSubmit={onSubmit}
          onForceSubmit={onForceSubmit}
          onInterruptRunningTask={onInterruptRunningTask}
          onQueueDraft={queueEnabled ? handleQueueDraft : undefined}
          onEditLastQueuedDraft={isConversationContext &&
              pendingConversationQueue.length > 0
            ? handleEditLastQueuedDraft
            : undefined}
          queueEditBinding={queueEditBinding}
          canEditQueuedDraft={isConversationContext &&
            pendingConversationQueue.length > 0}
          isConversationTaskRunning={isConversationTaskRunning}
          attachmentState={attachmentState}
          restoredCursorOffset={restoredComposerCursorOffset}
          restoredDraftRevision={restoredComposerDraftRevision}
          onCycleMode={onCycleMode}
          disabled={disabled}
          highlightMode={highlightMode}
          promptLabel={promptLabel}
        />
      </Box>
    </>
  );
});
