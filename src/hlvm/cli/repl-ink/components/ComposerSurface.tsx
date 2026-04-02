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
import type { ComposerLanguage } from "../../repl/composer-language.ts";
import { filterReferencedAttachments } from "../../repl/attachment.ts";
import { isBalanced } from "../../repl/syntax.ts";
import type { ReplState } from "../../repl/state.ts";
import { recordPromptHistory } from "../../repl/prompt-history.ts";
import { Input } from "./Input.tsx";
import { buildQueuePreviewLines, QueuePreview } from "./QueuePreview.tsx";
import {
  type ConversationComposerDraft,
  type ConversationQueueEditBinding,
  createConversationComposerDraft,
  enqueueConversationDraft,
  getQueuedDraftKind,
  getConversationQueueEditBinding,
  getConversationQueueEditBindingLabel,
  popLastQueuedConversationDraft,
} from "../utils/conversation-queue.ts";
import { useAttachments } from "../hooks/useAttachments.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import type { AnyAttachment } from "../hooks/useAttachments.ts";
import {
  resolveSubmitAction,
  type SubmitAction,
} from "../utils/submit-routing.ts";

export interface ComposerSurfaceUiState {
  hasDraftInput: boolean;
  hasSubmitText: boolean;
  queuedDraftCount: number;
  queuePreviewRows: number;
  submitAction: SubmitAction;
}

export interface ComposerSurfaceHandle {
  clearDraft: () => void;
  getAttachmentCount: () => number;
  getCurrentDraft: () => ConversationComposerDraft;
  getDraftText: () => string;
  getPendingQueue: () => ConversationComposerDraft[];
  restoreDraft: (draft: ConversationComposerDraft | null) => void;
  setPendingQueue: React.Dispatch<
    React.SetStateAction<ConversationComposerDraft[]>
  >;
  shouldSuppressAppEscapeInterrupt: () => boolean;
}

interface ComposerSurfaceProps {
  replState: ReplState;
  onSubmit: (value: string, attachments?: AnyAttachment[]) => void;
  onEmptySubmit?: () => void;
  onFocusLocalAgents?: () => boolean;
  onLocalAgentsInput?: (
    input: string,
    key: {
      escape?: boolean;
      ctrl?: boolean;
      meta?: boolean;
      return?: boolean;
      tab?: boolean;
      backspace?: boolean;
      delete?: boolean;
      upArrow?: boolean;
      downArrow?: boolean;
      leftArrow?: boolean;
      rightArrow?: boolean;
    },
  ) => boolean;
  localAgentsFocused?: boolean;
  onForceSubmit?: (value: string, attachments?: AnyAttachment[]) => void;
  onInterruptRunningTask?: () => void;
  onCycleMode?: () => void;
  onUiStateChange?: (state: ComposerSurfaceUiState) => void;
  disabled?: boolean;
  composerLanguage?: ComposerLanguage;
  promptLabel?: string;
  isConversationContext?: boolean;
  isConversationTaskRunning?: boolean;
  queueEnabled?: boolean;
  interactionMode?: "permission" | "question";
}

const ESCAPE_CONSUMED_SUPPRESSION_MS = 32;

export const ComposerSurface = forwardRef<
  ComposerSurfaceHandle,
  ComposerSurfaceProps
>(function ComposerSurface(
  {
    replState,
    onSubmit,
    onEmptySubmit,
    onFocusLocalAgents,
    onLocalAgentsInput,
    localAgentsFocused = false,
    onForceSubmit,
    onInterruptRunningTask,
    onCycleMode,
    onUiStateChange,
    disabled = false,
    composerLanguage = "hql",
    promptLabel = "hlvm>",
    isConversationContext = false,
    isConversationTaskRunning = false,
    queueEnabled = false,
    interactionMode,
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
  const escapeSurfaceActiveRef = useRef(false);
  const lastEscapeConsumedAtRef = useRef(0);

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
  const submitAction = useMemo<SubmitAction>(() => {
    const trimmedInput = input.trim();
    return resolveSubmitAction({
      text: input,
      isBalanced: trimmedInput.length === 0 || isBalanced(trimmedInput),
      hasAttachments: attachmentState.attachments.length > 0,
      composerLanguage,
      routeHint: isConversationContext ? "conversation" : "mixed-shell",
    });
  }, [
    attachmentState.attachments.length,
    composerLanguage,
    input,
    isConversationContext,
  ]);

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

  const handleEscapeSurfaceChange = useCallback((active: boolean) => {
    escapeSurfaceActiveRef.current = active;
  }, []);

  const handleEscapeConsumed = useCallback(() => {
    lastEscapeConsumedAtRef.current = Date.now();
  }, []);

  const getCurrentDraft = useCallback((): ConversationComposerDraft => {
    return createConversationComposerDraft(
      inputRef.current,
      filterReferencedAttachments(inputRef.current, attachmentsRef.current),
    );
  }, []);

  const handleQueueDraft = useCallback((draft: ConversationComposerDraft) => {
    const queuedKind = getQueuedDraftKind(draft);
    const historyKind = queuedKind === "eval"
      ? "evaluate"
      : queuedKind === "command"
      ? "command"
      : "conversation";
    recordPromptHistory(
      replState,
      draft.text,
      historyKind,
      undefined,
      draft.attachments,
    );
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
    shouldSuppressAppEscapeInterrupt: () =>
      escapeSurfaceActiveRef.current ||
      Date.now() - lastEscapeConsumedAtRef.current <
        ESCAPE_CONSUMED_SUPPRESSION_MS,
  }), [clearDraft, getCurrentDraft, restoreDraft]);

  const uiState = useMemo<ComposerSurfaceUiState>(() => ({
    hasDraftInput: input.trim().length > 0 ||
      attachmentState.attachments.length > 0,
    hasSubmitText: input.trim().length > 0,
    queuedDraftCount: pendingConversationQueue.length,
    queuePreviewRows,
    submitAction,
  }), [
    attachmentState.attachments.length,
    input,
    pendingConversationQueue.length,
    queuePreviewRows,
    submitAction,
  ]);

  const lastUiStateRef = useRef<ComposerSurfaceUiState | null>(null);
  useEffect(() => {
    if (!onUiStateChange) return;
    const lastState = lastUiStateRef.current;
    if (
      lastState &&
      lastState.hasDraftInput === uiState.hasDraftInput &&
      lastState.hasSubmitText === uiState.hasSubmitText &&
      lastState.queuedDraftCount === uiState.queuedDraftCount &&
      lastState.queuePreviewRows === uiState.queuePreviewRows &&
      lastState.submitAction === uiState.submitAction
    ) {
      return;
    }
    lastUiStateRef.current = uiState;
    onUiStateChange(uiState);
  }, [onUiStateChange, uiState]);

  return (
    <>
      {pendingConversationQueue.length > 0 && (
        <QueuePreview
          items={pendingConversationQueue}
          editBindingLabel={queueEditBindingLabel}
        />
      )}

      <Box flexDirection="column">
        <Input
          value={input}
          onChange={setInput}
          onSubmit={onSubmit}
          onEmptySubmit={onEmptySubmit}
          onFocusLocalAgents={onFocusLocalAgents}
          onLocalAgentsInput={onLocalAgentsInput}
          localAgentsFocused={localAgentsFocused}
          onForceSubmit={onForceSubmit}
          onInterruptRunningTask={onInterruptRunningTask}
          onQueueDraft={queueEnabled ? handleQueueDraft : undefined}
          onEditLastQueuedDraft={pendingConversationQueue.length > 0
            ? handleEditLastQueuedDraft
            : undefined}
          queueEditBinding={queueEditBinding}
          canEditQueuedDraft={pendingConversationQueue.length > 0}
          isConversationTaskRunning={isConversationTaskRunning}
          attachmentState={attachmentState}
          restoredCursorOffset={restoredComposerCursorOffset}
          restoredDraftRevision={restoredComposerDraftRevision}
          onCycleMode={onCycleMode}
          disabled={disabled}
          composerLanguage={composerLanguage}
          promptLabel={promptLabel}
          interactionMode={interactionMode}
          onEscapeSurfaceChange={handleEscapeSurfaceChange}
          onEscapeConsumed={handleEscapeConsumed}
        />
      </Box>
    </>
  );
});
