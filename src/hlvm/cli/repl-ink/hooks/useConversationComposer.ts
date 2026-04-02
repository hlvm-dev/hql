/**
 * useConversationComposer — Manages composer attachments, draft queue, and restore.
 */

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useAttachments, type UseAttachmentsReturn } from "./useAttachments.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import {
  type ConversationComposerDraft,
  type ConversationQueueEditBinding,
  createConversationComposerDraft,
  enqueueConversationDraft,
  getConversationQueueEditBinding,
  getConversationQueueEditBindingLabel,
  popLastQueuedConversationDraft,
} from "../utils/conversation-queue.ts";
import { buildQueuePreviewLines } from "../components/QueuePreview.tsx";
import { recordPromptHistory } from "../../repl/prompt-history.ts";
import { ReplState } from "../../repl/state.ts";

interface UseConversationComposerInput {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  replState: ReplState;
}

export interface UseConversationComposerResult {
  attachmentState: UseAttachmentsReturn;
  restoredComposerDraftRevision: number;
  restoredComposerCursorOffset: number;
  pendingConversationQueue: ConversationComposerDraft[];
  setPendingConversationQueue: Dispatch<
    SetStateAction<ConversationComposerDraft[]>
  >;
  currentComposerDraft: ConversationComposerDraft;
  queueEditBinding: ConversationQueueEditBinding;
  queueEditBindingLabel: string;
  queuePreviewRows: number;
  restoreComposerDraft: (draft: ConversationComposerDraft | null) => void;
  handleQueueDraft: (draft: ConversationComposerDraft) => void;
  handleEditLastQueuedDraft: () => void;
}

export function useConversationComposer(
  { input, setInput, replState }: UseConversationComposerInput,
): UseConversationComposerResult {
  const attachmentState = useAttachments();
  const [
    restoredComposerDraftRevision,
    setRestoredComposerDraftRevision,
  ] = useState(0);
  const [
    restoredComposerCursorOffset,
    setRestoredComposerCursorOffset,
  ] = useState(0);
  const [pendingConversationQueue, setPendingConversationQueue] = useState<
    ConversationComposerDraft[]
  >([]);

  const queueEditBinding = useMemo(
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

  const restoreComposerDraft = useCallback(
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
    [attachmentState, setInput],
  );

  const currentComposerDraft = useMemo(
    () => createConversationComposerDraft(input, attachmentState.attachments),
    [attachmentState.attachments, input],
  );

  const handleQueueDraft = useCallback((draft: ConversationComposerDraft) => {
    recordPromptHistory(
      replState,
      draft.text,
      "conversation",
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
      pendingConversationQueue,
    );
    if (!draft) return;
    setPendingConversationQueue(remaining);
    restoreComposerDraft(draft);
  }, [pendingConversationQueue, restoreComposerDraft]);

  return {
    attachmentState,
    restoredComposerDraftRevision,
    restoredComposerCursorOffset,
    pendingConversationQueue,
    setPendingConversationQueue,
    currentComposerDraft,
    queueEditBinding,
    queueEditBindingLabel,
    queuePreviewRows,
    restoreComposerDraft,
    handleQueueDraft,
    handleEditLastQueuedDraft,
  };
}
