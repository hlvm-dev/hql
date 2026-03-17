/**
 * useSessionPicker — Manages conversation session init, resume, and picker.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  SessionInitOptions,
  SessionMeta,
} from "../../repl/session/types.ts";
import { clearCurrentSession } from "../../../api/session.ts";
import type { UseConversationResult } from "./useConversation.ts";
import type { EvalResult } from "../types.ts";
import type { Dispatch, SetStateAction } from "react";

interface UseSessionPickerInput {
  sessionOptions?: SessionInitOptions;
  conversation: UseConversationResult;
  addHistoryEntry: (input: string, result: EvalResult) => void;
  setSurfacePanel: Dispatch<SetStateAction<
    "none" | "picker" | "models" | "model-setup" | "conversation"
  >>;
  setFooterContextUsageLabel: (label: string) => void;
}

export interface UseSessionPickerResult {
  currentSession: SessionMeta | null;
  setCurrentSession: Dispatch<SetStateAction<SessionMeta | null>>;
  pickerSessions: SessionMeta[];
  setPickerSessions: Dispatch<SetStateAction<SessionMeta[]>>;
  pendingResumeInput: string | null;
  setPendingResumeInput: Dispatch<SetStateAction<string | null>>;
  resumeConversationSession: (
    sessionId: string,
    commandInput: string,
    sessionTitle?: string,
  ) => Promise<boolean>;
  handlePickerSelect: (session: SessionMeta) => Promise<void>;
  handlePickerCancel: () => void;
}

export function useSessionPicker(
  {
    sessionOptions,
    conversation,
    addHistoryEntry,
    setSurfacePanel,
    setFooterContextUsageLabel,
  }: UseSessionPickerInput,
): UseSessionPickerResult {
  void conversation;
  void addHistoryEntry;
  const [currentSession, setCurrentSession] = useState<SessionMeta | null>(
    null,
  );
  const [pickerSessions, setPickerSessions] = useState<SessionMeta[]>([]);
  const [pendingResumeInput, setPendingResumeInput] = useState<string | null>(
    null,
  );

  // Session initialization effect
  useEffect(() => {
    let cancelled = false;

    const initConversationSession = async () => {
      try {
        const resolution = await resolveSessionStart(sessionOptions, {
          listSessions: (options) => sessionApi.list(options),
          hasSession: (sessionId) => sessionApi.has(sessionId),
        }, {
          defaultBehavior: "new",
        });

        switch (resolution.kind) {
          case "picker":
            clearCurrentSession();
            if (!cancelled) {
              setCurrentSession(null);
              setPickerSessions(resolution.sessions);
              if (resolution.sessions.length > 0) {
                setSurfacePanel("picker");
              }
            }
            return;
          case "resume": {
            const resumed = await sessionApi.resume(resolution.sessionId);
            if (!cancelled) {
              setCurrentSession(resumed?.meta ?? null);
            }
            return;
          }
          case "missing":
            clearCurrentSession();
            log.error(
              `Conversation session not found: ${resolution.sessionId}`,
            );
            if (!cancelled) {
              setCurrentSession(null);
            }
            return;
          case "new":
            clearCurrentSession();
            if (!cancelled) {
              setCurrentSession(null);
            }
            return;
          case "latest": {
            const active = resolution.sessionId
              ? await syncCurrentSession(resolution.sessionId)
              : null;
            if (!cancelled) {
              setCurrentSession(active);
            }
            return;
          }
        }
      } catch (error) {
        log.error(`Conversation session init failed: ${error}`);
      }
    };

    void initConversationSession();

    return () => {
      cancelled = true;
    };
  }, [sessionOptions]);

  const resumeConversationSession = useCallback(async (
    sessionId: string,
    commandInput: string,
    sessionTitle?: string,
  ): Promise<boolean> => {
    const loaded = await sessionApi.resume(sessionId);

    if (!loaded) {
      addHistoryEntry(commandInput, {
        success: false,
        error: new Error(`Session not found: ${sessionTitle ?? sessionId}`),
      });
      setSurfacePanel("none");
      return false;
    }

    const transcriptState = buildTranscriptStateFromSession(loaded);
    conversation.hydrateState(transcriptState);
    conversation.addInfo(
      `Resumed: ${loaded.meta.title} (${loaded.meta.messageCount} messages)`,
    );
    conversation.resetStatus();
    setCurrentSession(loaded.meta);
    setFooterContextUsageLabel("");
    setSurfacePanel("conversation");
    return true;
  }, [setSurfacePanel, setFooterContextUsageLabel]);

  const handlePickerSelect = useCallback(async (session: SessionMeta) => {
    await resumeConversationSession(
      session.id,
      pendingResumeInput || "/resume",
      session.title,
    );
    setPendingResumeInput(null);
  }, [pendingResumeInput, resumeConversationSession]);

  const handlePickerCancel = useCallback(() => {
    if (pendingResumeInput) {
      addHistoryEntry(pendingResumeInput, {
        success: true,
        value: "Cancelled",
      });
      setPendingResumeInput(null);
    }
    setSurfacePanel("none");
  }, [pendingResumeInput, setSurfacePanel]);

  return {
    currentSession,
    setCurrentSession,
    pickerSessions,
    setPickerSessions,
    pendingResumeInput,
    setPendingResumeInput,
    resumeConversationSession,
    handlePickerSelect,
    handlePickerCancel,
  };
}
