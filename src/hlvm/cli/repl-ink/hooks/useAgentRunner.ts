/**
 * useAgentRunner — Manages agent conversation execution, interaction queue,
 * force-interrupt, and queue draining.
 */

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AnyAttachment } from "./useAttachments.ts";
import type { AgentExecutionMode } from "../../../agent/execution-mode.ts";
import type {
  InteractionRequestEvent,
  InteractionResponse,
} from "../../../agent/registry.ts";
import type { AgentUIEvent, TraceEvent } from "../../../agent/orchestrator.ts";
import type {
  AssistantCitation,
  ConversationAttachmentRef,
  TurnCompletionStatus,
} from "../types.ts";
import { createConversationAttachmentRef } from "../types.ts";
import type { UseConversationResult } from "./useConversation.ts";
import type { SurfacePanel } from "./useOverlayPanel.ts";
import {
  type ConversationComposerDraft,
  createConversationComposerDraft,
  hasConversationDraftContent,
} from "../utils/conversation-queue.ts";
import { ensureError } from "../../../../common/utils.ts";

import { ConfigError } from "../../../../common/config/types.ts";
import {
  checkModelAttachmentIds,
  describeAttachmentFailure,
  describeConversationAttachmentMimeTypeError,
} from "../../attachment-policy.ts";
import {
  type Attachment,
  expandTextAttachmentReferences,
  filterReferencedAttachments,
} from "../../repl/attachment.ts";
import {
  type BackgroundAgentSnapshot,
} from "../../../agent/tools/agent-types.ts";
import {
  cancelRuntimeBackgroundAgent,
  ensureRuntimeHostAvailable,
  listRuntimeBackgroundAgents,
  runChatViaHost,
} from "../../../runtime/host-client.ts";
import { summarizeToolFailureForDisplay } from "../../../agent/tool-results.ts";
import { recordPromptHistory } from "../../repl/prompt-history.ts";
import type { ReplState } from "../../repl/state.ts";
import type { OverlayPanel } from "./useOverlayPanel.ts";
import { REPL_MAIN_THREAD_QUERY_SOURCE } from "../../../agent/query-tool-routing.ts";
import {
  buildTraceTextPreview,
  traceReplMainThread,
} from "../../../repl-main-thread-trace.ts";
import type { TracePresentationLine } from "../../../agent/trace-presentation.ts";
import { presentTraceEvent } from "../../../agent/trace-presentation.ts";
import type { LocalAgentEntry } from "../utils/local-agents.ts";

type ContextPressureLevel = Extract<
  TraceEvent,
  { type: "context_pressure" }
>["level"];

function formatContextPressureLabel(
  percent: number,
  level: ContextPressureLevel,
): string {
  if (level === "urgent") return `ctx ${percent}% !!`;
  if (level === "soft") return `ctx ${percent}% ↑`;
  return `ctx ${percent}%`;
}

function withParts(...parts: Array<string | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim()))
    .join(" · ");
}

function cleanPreviewLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function normalizeLocalAgentStatusText(text: string): string {
  return summarizeToolFailureForDisplay(cleanPreviewLine(text));
}

function isRuntimeHostStartingError(error: unknown): boolean {
  return ensureError(error).message.includes(
    "Local HLVM runtime host is not ready for AI requests",
  );
}

const RUNTIME_HOST_START_RETRY_ATTEMPTS = 5;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isFinishedLocalAgentStatus(status: LocalAgentEntry["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function countActiveLocalAgents(entries: readonly LocalAgentEntry[]): number {
  return entries.filter((entry) => !isFinishedLocalAgentStatus(entry.status))
    .length;
}

function formatLocalAgentCompletionSummary(
  entries: readonly LocalAgentEntry[],
): string {
  const total = entries.length;
  if (total === 0) return "Agents done";
  const completed = entries.filter((entry) => entry.status === "completed")
    .length;
  const failed = entries.filter((entry) => entry.status === "failed").length;
  const cancelled = entries.filter((entry) => entry.status === "cancelled")
    .length;
  const parts: string[] = [];
  if (completed > 0) {
    parts.push(`${completed} done`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  if (cancelled > 0) {
    parts.push(`${cancelled} cancelled`);
  }
  const label = `${total} agent${total === 1 ? "" : "s"} done`;
  return parts.length > 0
    ? `${label} · ${parts.join(" · ")} · ↓ to review`
    : `${label} · ↓ to review`;
}

function buildAgentPreviewLines(
  resultPreview?: string,
  transcript?: string,
): string[] {
  const lines = [
    ...(transcript?.split("\n") ?? []),
    ...(resultPreview?.split("\n") ?? []),
  ]
    .map(cleanPreviewLine)
    .filter((line) => line.length > 0);
  const uniqueLines: string[] = [];
  for (const line of lines) {
    if (!uniqueLines.includes(line)) {
      uniqueLines.push(line);
    }
    if (uniqueLines.length >= 3) break;
  }
  return uniqueLines;
}

function updateLocalAgentEntry(
  prev: LocalAgentEntry[],
  next: LocalAgentEntry,
): LocalAgentEntry[] {
  const index = prev.findIndex((entry) => entry.id === next.id);
  if (index < 0) return [...prev, next];
  const copy = [...prev];
  copy[index] = next;
  return copy;
}

function reduceLocalAgentEntries(
  prev: LocalAgentEntry[],
  event: AgentUIEvent,
): LocalAgentEntry[] {
  switch (event.type) {
    case "agent_spawn": {
      const existing = prev.find((entry) => entry.id === event.agentId);
      return updateLocalAgentEntry(prev, {
        id: event.agentId,
        kind: "agent",
        name: event.description.trim() || `Agent (${event.agentType})`,
        label: event.agentType,
        status: "running",
        statusLabel: "running",
        detail: "Starting...",
        interruptible: true,
        foregroundable: false,
        overlayTarget: "background-tasks",
        overlayItemId: event.agentId,
        progress: existing?.progress ?? {
          previewLines: [],
        },
      });
    }
    case "agent_progress": {
      const existing = prev.find((entry) => entry.id === event.agentId);
      if (!existing) return prev;
      const activityText = event.lastToolInfo?.trim()
        ? normalizeLocalAgentStatusText(event.lastToolInfo)
        : undefined;
      return updateLocalAgentEntry(prev, {
        ...existing,
        status: "running",
        statusLabel: "running",
        detail: activityText ||
          (event.toolUseCount > 0 ? "Working..." : "Starting..."),
        interruptible: true,
        progress: {
          previewLines: existing.progress?.previewLines ?? [],
          activityText,
          toolUseCount: event.toolUseCount,
          tokenCount: event.tokenCount ?? existing.progress?.tokenCount,
          durationMs: event.durationMs,
        },
      });
    }
    case "agent_complete": {
      const existing = prev.find((entry) => entry.id === event.agentId);
      if (!existing) return prev;
      const wasCancelled = event.cancelled === true;
      const status = wasCancelled
        ? "cancelled"
        : event.success
        ? "completed"
        : "failed";
      return updateLocalAgentEntry(prev, {
        ...existing,
        status,
        statusLabel: status === "completed"
          ? "done"
          : status === "cancelled"
          ? "cancelled"
          : "failed",
        interruptible: false,
        detail: wasCancelled
          ? "Cancelled"
          : event.success
          ? "Done"
          : cleanPreviewLine(event.resultPreview ?? "Failed"),
        progress: {
          previewLines: buildAgentPreviewLines(
            event.resultPreview,
            event.transcript,
          ),
          toolUseCount: event.toolUseCount,
          tokenCount: event.totalTokens,
          durationMs: event.durationMs,
        },
      });
    }
    default:
      return prev;
  }
}

function buildLocalAgentProgressFromBackgroundAgent(
  agent: BackgroundAgentSnapshot,
  existing?: LocalAgentEntry,
): LocalAgentEntry["progress"] {
  const existingProgress = existing?.progress;
  const previewLines = agent.previewLines.length > 0
    ? agent.previewLines
    : agent.error
    ? [normalizeLocalAgentStatusText(agent.error)]
    : existingProgress?.previewLines ?? [];
  const activityText = agent.status === "completed"
    ? "Done"
    : agent.cancelled === true
    ? normalizeLocalAgentStatusText(agent.error ?? "Cancelled by user")
    : agent.status === "errored"
    ? normalizeLocalAgentStatusText(agent.error ?? agent.resultPreview ?? "Failed")
    : agent.lastToolInfo?.trim()
    ? normalizeLocalAgentStatusText(agent.lastToolInfo)
    : existingProgress?.activityText;
  return {
    previewLines,
    activityText,
    toolUseCount: agent.toolUseCount ?? existingProgress?.toolUseCount,
    tokenCount: agent.tokenCount ?? existingProgress?.tokenCount,
    durationMs: agent.durationMs,
  };
}

function mapBackgroundAgentToLocalAgentEntry(
  agent: BackgroundAgentSnapshot,
  existing?: LocalAgentEntry,
): LocalAgentEntry {
  const status: LocalAgentEntry["status"] = agent.status === "completed"
    ? "completed"
    : agent.cancelled === true
    ? "cancelled"
    : agent.status === "errored"
    ? "failed"
    : "running";
  return {
    id: agent.agentId,
    kind: "agent",
    name: agent.description.trim() || `Agent (${agent.agentType})`,
    label: agent.agentType,
    status,
    statusLabel: status === "completed"
      ? "done"
      : status === "cancelled"
      ? "cancelled"
      : status === "failed"
      ? "failed"
      : "running",
    detail: status === "completed"
      ? "Done"
      : status === "cancelled"
      ? normalizeLocalAgentStatusText(agent.error ?? "Cancelled by user")
      : status === "failed"
      ? normalizeLocalAgentStatusText(agent.error ?? agent.resultPreview ?? "Failed")
      : existing?.detail ?? "Starting...",
    interruptible: status === "running",
    foregroundable: false,
    overlayTarget: "background-tasks",
    overlayItemId: agent.agentId,
    progress: buildLocalAgentProgressFromBackgroundAgent(agent, existing),
  };
}

function syncLocalAgentEntriesFromSnapshots(
  prev: LocalAgentEntry[],
  runtimeAgents: BackgroundAgentSnapshot[],
): LocalAgentEntry[] {
  if (prev.length === 0) return prev;
  const runtimeById = new Map(
    runtimeAgents.map((agent) => [agent.agentId, agent] as const),
  );
  return prev.map((entry) => {
    const runtimeAgent = runtimeById.get(entry.id);
    if (!runtimeAgent) return entry;
    return mapBackgroundAgentToLocalAgentEntry(runtimeAgent, entry);
  });
}

function tickLocalAgentDurations(
  prev: LocalAgentEntry[],
): LocalAgentEntry[] {
  let changed = false;
  const next = prev.map((entry) => {
    if (
      entry.status !== "running" && entry.status !== "waiting" &&
      entry.status !== "blocked" && entry.status !== "idle"
    ) {
      return entry;
    }
    const currentDuration = entry.progress?.durationMs;
    if (currentDuration == null) return entry;
    changed = true;
    return {
      ...entry,
      progress: {
        previewLines: entry.progress?.previewLines ?? [],
        ...entry.progress,
        durationMs: currentDuration + 1000,
      },
    };
  });
  return changed ? next : prev;
}

function cancelActiveLocalAgents(
  prev: LocalAgentEntry[],
): LocalAgentEntry[] {
  return prev.map((entry) =>
    entry.status === "running" || entry.status === "waiting" ||
        entry.status === "blocked" || entry.status === "idle"
      ? {
        ...entry,
        status: "cancelled",
        statusLabel: "cancelled",
        detail: "Cancelled",
        interruptible: false,
      }
      : entry
  );
}

function markLocalAgentCancelled(
  prev: LocalAgentEntry[],
  agentId: string,
): LocalAgentEntry[] {
  return prev.map((entry) =>
    entry.id === agentId
      ? {
        ...entry,
        status: "cancelled",
        statusLabel: "cancelled",
        detail: "Cancelled",
        interruptible: false,
      }
      : entry
  );
}

export function getConversationToolDenylist(
  agentExecutionMode: AgentExecutionMode,
): string[] {
  return ["complete_task"];
}

interface UseAgentRunnerInput {
  conversation: UseConversationResult;
  debugEnabled?: boolean;
  activeModelId: string | null;
  agentExecutionMode: AgentExecutionMode;
  configuredContextWindow: number | undefined;
  refreshRuntimeConfigState: () => Promise<
    { activeModelId: string | null }
  >;
  setIsEvaluating: Dispatch<SetStateAction<boolean>>;
  setFooterContextUsageLabel: (label: string) => void;
  setSurfacePanel: Dispatch<SetStateAction<SurfacePanel>>;
  setActiveOverlay: Dispatch<SetStateAction<OverlayPanel>>;
  clearComposerDraft: () => void;
  getCurrentComposerDraft: () => ConversationComposerDraft;
  getPendingConversationQueue: () => ConversationComposerDraft[];
  setPendingConversationQueue: Dispatch<
    SetStateAction<ConversationComposerDraft[]>
  >;
  restoreComposerDraft: (draft: ConversationComposerDraft | null) => void;
  replState: ReplState;
}

export interface UseAgentRunnerResult {
  interactionQueue: InteractionRequestEvent[];
  setInteractionQueue: Dispatch<SetStateAction<InteractionRequestEvent[]>>;
  pendingInteraction: InteractionRequestEvent | undefined;
  localAgentEntries: LocalAgentEntry[];
  interruptLocalAgentEntry: (agentId: string) => boolean;
  agentControllerRef: MutableRefObject<AbortController | null>;
  interactionResolversRef: MutableRefObject<
    Map<string, (response: InteractionResponse) => void>
  >;
  prepareConversationAttachmentPayload: (
    attachments?: AnyAttachment[],
    text?: string,
  ) => {
    attachments: ConversationAttachmentRef[] | undefined;
    unsupportedMimeType: string | undefined;
  };
  expandConversationDraftText: (
    text: string,
    attachments?: AnyAttachment[],
  ) => string;
  runConversation: (
    query: string,
    attachments?: ConversationAttachmentRef[],
    options?: {
      displayText?: string;
      skipTranscriptSeed?: boolean;
    },
  ) => Promise<void>;
  submitConversationDraft: (
    draft: ConversationComposerDraft,
  ) => { started: boolean; unsupportedMimeType?: string };
  handleInteractionResponse: (
    requestId: string,
    response: InteractionResponse,
  ) => void;
  closeConversationMode: (
    options?: { clearConversation?: boolean },
  ) => void;
  interruptConversationRun: (
    options?: {
      requestId?: string;
      clearPlanning?: boolean;
      restoreDraft?: boolean;
    },
  ) => void;
  handleForceInterrupt: (
    code: string,
    attachments?: AnyAttachment[],
  ) => void;
}

export function useAgentRunner(
  {
    conversation,
    debugEnabled = false,
    activeModelId,
    agentExecutionMode,
    configuredContextWindow,
    refreshRuntimeConfigState,
    setIsEvaluating,
    setFooterContextUsageLabel,
    setSurfacePanel,
    setActiveOverlay,
    clearComposerDraft,
    getCurrentComposerDraft,
    getPendingConversationQueue,
    setPendingConversationQueue,
    restoreComposerDraft,
    replState,
  }: UseAgentRunnerInput,
): UseAgentRunnerResult {
  const [interactionQueue, setInteractionQueue] = useState<
    InteractionRequestEvent[]
  >([]);
  const [localAgentEntries, setLocalAgentEntries] = useState<LocalAgentEntry[]>(
    [],
  );
  const previousLocalAgentEntriesRef = useRef<LocalAgentEntry[]>([]);
  const hasActiveLocalAgents = localAgentEntries.some((entry: LocalAgentEntry) =>
    entry.status === "running" || entry.status === "waiting" ||
      entry.status === "blocked" || entry.status === "idle"
  );
  const pendingInteraction = interactionQueue[0];

  // Stable ref for conversation — avoids recreating callbacks on every event
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  const agentControllerRef = useRef<AbortController | null>(null);
  const interactionResolversRef = useRef<
    Map<string, (response: InteractionResponse) => void>
  >(new Map());
  const pendingStreamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const activeRunTurnIdRef = useRef<string | undefined>(undefined);
  const contextPressureLevelRef = useRef<ContextPressureLevel>("normal");

  useEffect(() => {
    // Finished agent rows can stay visible for review without continuing the
    // 400ms runtime polling loop forever in every old REPL session.
    if (!hasActiveLocalAgents) return;
    let disposed = false;
    let syncInFlight = false;
    const sync = async () => {
      if (syncInFlight) return;
      syncInFlight = true;
      try {
        const runtimeAgents = await listRuntimeBackgroundAgents();
        if (disposed) return;
        setLocalAgentEntries((prev: LocalAgentEntry[]) =>
          syncLocalAgentEntriesFromSnapshots(prev, runtimeAgents)
        );
      } catch {
        // Best-effort sync only.
      } finally {
        syncInFlight = false;
      }
    };
    void sync();
    const syncInterval = setInterval(() => {
      void sync();
    }, 400);
    const tickInterval = setInterval(() => {
      if (disposed) return;
      setLocalAgentEntries((prev: LocalAgentEntry[]) =>
        tickLocalAgentDurations(prev)
      );
    }, 1000);
    return () => {
      disposed = true;
      clearInterval(syncInterval);
      clearInterval(tickInterval);
    };
  }, [hasActiveLocalAgents]);

  useEffect(() => {
    const previous = previousLocalAgentEntriesRef.current;
    const previousActiveCount = countActiveLocalAgents(previous);
    const nextActiveCount = countActiveLocalAgents(localAgentEntries);
    if (
      previousActiveCount > 0 &&
      nextActiveCount === 0 &&
      localAgentEntries.length > 0
    ) {
      conversationRef.current.addInfo(
        formatLocalAgentCompletionSummary(localAgentEntries),
        {
          turnId: activeRunTurnIdRef.current,
        },
      );
    }
    previousLocalAgentEntriesRef.current = localAgentEntries;
  }, [localAgentEntries]);

  const interruptLocalAgentEntry = useCallback((agentId: string) => {
    const hasEntry = localAgentEntries.some((entry: LocalAgentEntry) =>
      entry.id === agentId
    );
    if (!hasEntry) return false;
    setLocalAgentEntries((prev: LocalAgentEntry[]) =>
      markLocalAgentCancelled(prev, agentId)
    );
    void cancelRuntimeBackgroundAgent(agentId).then((cancelled) => {
      if (cancelled) return;
      void listRuntimeBackgroundAgents().then((runtimeAgents) => {
        setLocalAgentEntries((prev: LocalAgentEntry[]) =>
          syncLocalAgentEntriesFromSnapshots(prev, runtimeAgents)
        );
      }).catch(() => {});
    }).catch(() => {});
    return true;
  }, [localAgentEntries]);

  // Cleanup orphaned stream timer on unmount
  useEffect(() => () => {
    if (pendingStreamTimerRef.current) {
      clearTimeout(pendingStreamTimerRef.current);
      pendingStreamTimerRef.current = null;
    }
  }, []);

  const prepareConversationAttachmentPayload = useCallback(
    (attachments?: AnyAttachment[], text = "") => {
      const referencedAttachments = text.trim().length > 0
        ? filterReferencedAttachments(text, attachments ?? [])
        : attachments ?? [];
      const runtimeAttachments = referencedAttachments.filter(
        (attachment): attachment is Attachment =>
          "attachmentId" in attachment && !("content" in attachment),
      );

      return {
        attachments: runtimeAttachments.length > 0
          ? runtimeAttachments.map((attachment) =>
            createConversationAttachmentRef(
              attachment.displayName,
              attachment.attachmentId,
            )
          )
          : undefined,
        unsupportedMimeType: undefined,
      };
    },
    [],
  );

  const expandConversationDraftText = useCallback((
    text: string,
    attachments?: AnyAttachment[],
  ): string => {
    return expandTextAttachmentReferences(text, attachments ?? []);
  }, []);

  const appendDebugTrace = useCallback((
    lines: readonly TracePresentationLine[],
    turnId = activeRunTurnIdRef.current,
  ) => {
    if (!debugEnabled || lines.length === 0) return;
    conversationRef.current.addDebugTrace(lines, {
      turnId,
    });
  }, [debugEnabled]);

  const runConversation = useCallback(async (
    query: string,
    attachments?: ConversationAttachmentRef[],
    options?: {
      displayText?: string;
      skipTranscriptSeed?: boolean;
    },
  ) => {
    // Guard: prevent double agent start — set ref atomically before any async work
    if (agentControllerRef.current) return;
    const controller = new AbortController();
    agentControllerRef.current = controller;
    const isActiveConversationRun = () =>
      agentControllerRef.current === controller;
    setLocalAgentEntries([]);

    setSurfacePanel("conversation");
    setFooterContextUsageLabel("");
    contextPressureLevelRef.current = "normal";

    // Show user message and pending indicator immediately — before expensive
    // config/model init, unless the caller already seeded the transcript.
    const runTurnId = !options?.skipTranscriptSeed
      ? conversationRef.current.addUserMessage(
        options?.displayText ?? query,
        {
          submittedText: options?.displayText !== undefined &&
              options.displayText !== query
            ? query
            : undefined,
          attachments,
        },
      )
      : conversationRef.current.activeTurnId;
    activeRunTurnIdRef.current = runTurnId;
    if (!options?.skipTranscriptSeed) {
      conversationRef.current.addAssistantText("", true, undefined, {
        turnId: runTurnId,
      });
    }

    let finalizeStatus: TurnCompletionStatus = "completed";
    const requestId = crypto.randomUUID();
    const runStartedAt = Date.now();
    traceReplMainThread("ui.run_conversation.start", {
      requestId,
      agentExecutionMode,
      activeModelId: activeModelId ?? null,
      queryPreview: buildTraceTextPreview(query),
      attachmentCount: attachments?.length ?? 0,
    });
    appendDebugTrace([{
      depth: 0,
      text: `Run started (${agentExecutionMode})`,
      tone: "active",
    }, {
      depth: 1,
      text: withParts(
        activeModelId ? `requested model ${activeModelId}` : undefined,
        attachments?.length ? `${attachments.length} attachments` : undefined,
        buildTraceTextPreview(query, 84),
      ),
      tone: "muted",
    }]);

    try {
      const attachmentIds = attachments
        ?.flatMap((attachment) =>
          attachment.attachmentId ? [attachment.attachmentId] : []
        );
      const modelResolutionStartedAt = Date.now();
      const model = activeModelId ||
        (await refreshRuntimeConfigState()).activeModelId ||
        undefined;
      traceReplMainThread("ui.model_resolution.done", {
        requestId,
        durationMs: Date.now() - modelResolutionStartedAt,
        model: model ?? null,
        usedActiveModelId: !!activeModelId,
      });
      appendDebugTrace([{
        depth: 1,
        text: withParts(
          `Model resolved -> ${model ?? "none"}`,
          `in ${Date.now() - modelResolutionStartedAt}ms`,
        ),
        tone: model ? "muted" : "warning",
      }]);
      if (!model) {
        throw new ConfigError(
          "No configured model available for conversation mode.",
        );
      }
      if (attachmentIds?.length) {
        const attachmentSupport = await checkModelAttachmentIds(
          model,
          attachmentIds,
          null,
        );
        if (!attachmentSupport.supported) {
          if (attachmentSupport.catalogFailed) {
            throw new ConfigError(
              "Could not verify model attachment support. Check provider connection and try again.",
            );
          }
          throw new ConfigError(
            describeAttachmentFailure(attachmentSupport, model) ||
              `Selected model does not support these attachments: ${model}`,
          );
        }
      }

      let textBuffer = "";
      let finalCitations: AssistantCitation[] | undefined;
      // Plan mode should feel status-driven, not like a streaming chat reply.
      // Keep intermediate assistant tokens hidden and let events/tool progress
      // drive the UI; the final response is still rendered after the run ends.
      let suppressPlanningTokens = agentExecutionMode === "plan";
      // Throttle streaming renders to avoid Ink full-screen redraws on every token.
      // Tokens arrive every ~10-30ms; batching to 120ms gives smooth output at ~8 FPS.
      const STREAM_RENDER_INTERVAL = 120;
      let lastStreamRender = 0;
      const flushStreamBuffer = () => {
        pendingStreamTimerRef.current = null;
        if (!controller.signal.aborted && isActiveConversationRun()) {
          conversationRef.current.addAssistantText(
            textBuffer,
            true,
            undefined,
            {
              turnId: activeRunTurnIdRef.current,
            },
          );
          lastStreamRender = Date.now();
        }
      };
      let result;
      for (
        let hostAttempt = 0;
        hostAttempt < RUNTIME_HOST_START_RETRY_ATTEMPTS;
        hostAttempt++
      ) {
        try {
          await ensureRuntimeHostAvailable();
          result = await runChatViaHost({
            mode: "agent",
            querySource: REPL_MAIN_THREAD_QUERY_SOURCE,
            requestId,
            messages: [{
              role: "user",
              content: query,
              display_content: options?.displayText !== undefined &&
                  options.displayText !== query
                ? options.displayText
                : undefined,
              attachment_ids: attachmentIds,
              client_turn_id: crypto.randomUUID(),
            }],
            model,
            permissionMode: agentExecutionMode,
            toolDenylist: getConversationToolDenylist(agentExecutionMode),
            signal: controller.signal,
            callbacks: {
              onToken: (text: string) => {
                if (controller.signal.aborted || !isActiveConversationRun()) {
                  return;
                }
                if (suppressPlanningTokens) {
                  return;
                }
                textBuffer += text;
                const now = Date.now();
                if (now - lastStreamRender >= STREAM_RENDER_INTERVAL) {
                  if (pendingStreamTimerRef.current) {
                    clearTimeout(pendingStreamTimerRef.current);
                    pendingStreamTimerRef.current = null;
                  }
                  flushStreamBuffer();
                } else if (!pendingStreamTimerRef.current) {
                  pendingStreamTimerRef.current = setTimeout(
                    flushStreamBuffer,
                    STREAM_RENDER_INTERVAL - (now - lastStreamRender),
                  );
                }
              },
              onAgentEvent: (event) => {
                if (controller.signal.aborted || !isActiveConversationRun()) {
                  return;
                }
                if (
                  event.type === "agent_spawn" ||
                  event.type === "agent_progress" ||
                  event.type === "agent_complete"
                ) {
                  setLocalAgentEntries((prev: LocalAgentEntry[]) =>
                    reduceLocalAgentEntries(prev, event)
                  );
                  return;
                }
                if (event.type === "plan_phase_changed") {
                  suppressPlanningTokens = event.phase !== "done";
                }
                if (event.type === "tool_start" && textBuffer.trim()) {
                  if (pendingStreamTimerRef.current) {
                    clearTimeout(pendingStreamTimerRef.current);
                    pendingStreamTimerRef.current = null;
                  }
                  conversationRef.current.addAssistantText(
                    textBuffer,
                    false,
                    undefined,
                    {
                      turnId: activeRunTurnIdRef.current,
                    },
                  );
                  textBuffer = "";
                  lastStreamRender = 0;
                }
                conversationRef.current.addEvent(event);
              },
              onFinalResponseMeta: (meta) => {
                if (!isActiveConversationRun()) return;
                finalCitations = meta.citationSpans as
                  | AssistantCitation[]
                  | undefined;
              },
              onTrace: (event) => {
                if (controller.signal.aborted || !isActiveConversationRun()) {
                  return;
                }
                appendDebugTrace(presentTraceEvent(event));
                if (event.type === "context_pressure") {
                  setFooterContextUsageLabel(
                    formatContextPressureLabel(event.percent, event.level),
                  );
                  const previousLevel = contextPressureLevelRef.current;
                  contextPressureLevelRef.current = event.level;
                  if (event.level === previousLevel) {
                    return;
                  }
                  if (event.level === "soft") {
                    conversationRef.current.addInfo(
                      "Context pressure rising.",
                      {
                        isTransient: true,
                        turnId: activeRunTurnIdRef.current,
                      },
                    );
                    return;
                  }
                  if (event.level === "urgent") {
                    conversationRef.current.addInfo(
                      "Context nearly full.",
                      {
                        isTransient: true,
                        turnId: activeRunTurnIdRef.current,
                      },
                    );
                  }
                  return;
                }
                if (event.type === "context_overflow_retry") {
                  contextPressureLevelRef.current = "normal";
                  setFooterContextUsageLabel("");
                  conversationRef.current.addInfo(
                    "Context compacted and retried.",
                    {
                      isTransient: true,
                      turnId: activeRunTurnIdRef.current,
                    },
                  );
                  return;
                }
                if (event.type === "context_compaction") {
                  contextPressureLevelRef.current = "normal";
                  setFooterContextUsageLabel("");
                  conversationRef.current.addInfo(
                    "Older context was compacted before the next model call.",
                    {
                      isTransient: true,
                      turnId: activeRunTurnIdRef.current,
                    },
                  );
                  return;
                }
                if (
                  event.type === "response_continuation" &&
                  event.status === "starting"
                ) {
                  conversationRef.current.addInfo(
                    "Continuing truncated response...",
                    {
                      isTransient: true,
                      turnId: activeRunTurnIdRef.current,
                    },
                  );
                }
              },
            },
            onInteraction: (event) => {
              if (controller.signal.aborted || !isActiveConversationRun()) {
                throw new DOMException("Agent interaction aborted", "AbortError");
              }
              const interactionEvent: InteractionRequestEvent = {
                type: "interaction_request",
                requestId: event.requestId,
                mode: event.mode,
                toolName: event.toolName,
                toolArgs: event.toolArgs,
                toolInput: event.toolInput,
                question: event.question,
                options: event.options,
                sourceLabel: event.sourceLabel,
                sourceThreadId: event.sourceThreadId,
              };
              setInteractionQueue((prev: InteractionRequestEvent[]) => {
                if (
                  prev.some((item) => item.requestId === interactionEvent.requestId)
                ) return prev;
                return [...prev, interactionEvent];
              });
              return new Promise<InteractionResponse>((resolve, reject) => {
                let settled = false;
                const finalizeRequest = () => {
                  if (
                    !interactionResolversRef.current.has(interactionEvent.requestId)
                  ) return;
                  interactionResolversRef.current.delete(
                    interactionEvent.requestId,
                  );
                  setInteractionQueue((prev: InteractionRequestEvent[]) =>
                    prev.filter((item) =>
                      item.requestId !== interactionEvent.requestId
                    )
                  );
                  controller.signal.removeEventListener("abort", onAbort);
                };
                const onAbort = () => {
                  if (settled) return;
                  settled = true;
                  finalizeRequest();
                  reject(
                    new DOMException("Agent interaction aborted", "AbortError"),
                  );
                };
                const handler = (response: InteractionResponse) => {
                  if (settled) return;
                  settled = true;
                  finalizeRequest();
                  resolve(response);
                };
                interactionResolversRef.current.set(
                  interactionEvent.requestId,
                  handler,
                );
                controller.signal.addEventListener("abort", onAbort, {
                  once: true,
                });
              });
            },
          });
          break;
        } catch (error) {
          if (
            controller.signal.aborted ||
            hostAttempt === RUNTIME_HOST_START_RETRY_ATTEMPTS - 1 ||
            !isRuntimeHostStartingError(error)
          ) {
            throw error;
          }
          appendDebugTrace([{
            depth: 1,
            text: withParts(
              "AI engine still starting",
              `retry ${hostAttempt + 2}/${RUNTIME_HOST_START_RETRY_ATTEMPTS}`,
            ),
            tone: "warning",
          }]);
          if (hostAttempt === 0) {
            conversationRef.current.addInfo(
              "AI engine still starting...",
              {
                isTransient: true,
                turnId: activeRunTurnIdRef.current,
              },
            );
          }
          await delay(600 * (hostAttempt + 1));
        }
      }
      if (!result) {
        throw new Error("AI engine did not return a conversation result.");
      }
      traceReplMainThread("ui.run_conversation.host_done", {
        requestId,
        durationMs: Date.now() - runStartedAt,
        textChars: result.text.length,
        estimatedTokens: result.stats.estimatedTokens,
        toolMessages: result.stats.toolMessages,
      });
      appendDebugTrace([{
        depth: 1,
        text: withParts(
          `Host completed`,
          `in ${Date.now() - runStartedAt}ms`,
          result.stats.toolMessages > 0
            ? `${result.stats.toolMessages} tool messages`
            : undefined,
          typeof result.stats.estimatedTokens === "number"
            ? `${result.stats.estimatedTokens} est. tokens`
            : undefined,
        ),
        tone: "active",
      }]);
      // Clear any pending streaming render timer
      if (pendingStreamTimerRef.current) {
        clearTimeout(pendingStreamTimerRef.current);
        pendingStreamTimerRef.current = null;
      }
      if (!isActiveConversationRun()) {
        return;
      }
      contextPressureLevelRef.current = "normal";

      // Finalize assistant message
      const sanitizePlanModeFinalText = (text: string): string => {
        let cleaned = text;
        const lastPlanEnd = cleaned.lastIndexOf("END_PLAN");
        if (lastPlanEnd >= 0) {
          cleaned = cleaned.slice(lastPlanEnd + "END_PLAN".length);
        }
        cleaned = cleaned.replace(/STEP_DONE\s*[:\-]?\s*[a-z0-9_-]+/gi, "")
          .replace(/\b(?:Now\s+)?let me\b[^.?!]*[.?!]?/gi, "")
          .replace(/\bI need to\b[^.?!]*[.?!]?/gi, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        const paragraphs = cleaned.split(/\n{2,}/)
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
        return (paragraphs.at(-1) ?? "")
          .replace(/^(That said,\s*)/i, "")
          .replace(/\s{2,}/g, " ")
          .trim();
      };
      const finalAssistantText = agentExecutionMode === "plan"
        ? sanitizePlanModeFinalText(result.text ?? textBuffer)
        : textBuffer;
      if (finalAssistantText) {
        conversationRef.current.addAssistantText(
          finalAssistantText,
          false,
          finalCitations,
          { turnId: activeRunTurnIdRef.current },
        );
      }

      // Footer context usage (Gemini-style compact indicator)
      const usage = result.stats.usage;
      if (
        usage && typeof configuredContextWindow === "number" &&
        configuredContextWindow > 0
      ) {
        const pct = Math.max(
          0,
          Math.min(
            100,
            Math.round((usage.totalTokens / configuredContextWindow) * 100),
          ),
        );
        setFooterContextUsageLabel(`${pct}% ctx`);
      } else if (usage) {
        setFooterContextUsageLabel(`${usage.totalTokens} tokens`);
      } else {
        setFooterContextUsageLabel("");
      }
    } catch (error) {
      traceReplMainThread("ui.run_conversation.error", {
        requestId,
        durationMs: Date.now() - runStartedAt,
        error: ensureError(error).message,
      });
      appendDebugTrace([{
        depth: 1,
        text: withParts(
          `Run error`,
          ensureError(error).message,
        ),
        tone: "error",
      }]);
      if (controller.signal.aborted) {
        finalizeStatus = "cancelled";
        if (isActiveConversationRun()) {
          conversationRef.current.addInfo("Cancelled", {
            turnId: activeRunTurnIdRef.current,
          });
        }
      } else {
        finalizeStatus = "failed";
        if (isActiveConversationRun()) {
          conversationRef.current.addError(ensureError(error).message, {
            turnId: activeRunTurnIdRef.current,
          });
        }
      }
    } finally {
      const finalizedTurnId = activeRunTurnIdRef.current;
      appendDebugTrace([{
        depth: 0,
        text: withParts(
          `Run ${finalizeStatus}`,
          `in ${Date.now() - runStartedAt}ms`,
        ),
        tone: finalizeStatus === "completed"
          ? "active"
          : finalizeStatus === "cancelled"
          ? "warning"
          : "error",
      }], finalizedTurnId);
      if (isActiveConversationRun()) {
        agentControllerRef.current = null;
        interactionResolversRef.current.clear();
        setInteractionQueue([]);
        setIsEvaluating(false);
        contextPressureLevelRef.current = "normal";
        conversationRef.current.finalize(finalizeStatus, {
          turnId: activeRunTurnIdRef.current,
        });
        activeRunTurnIdRef.current = undefined;
      }
      traceReplMainThread("ui.run_conversation.finally", {
        requestId,
        durationMs: Date.now() - runStartedAt,
        status: finalizeStatus,
      });
    }
  }, [
    appendDebugTrace,
    activeModelId,
    agentExecutionMode,
    configuredContextWindow,
    refreshRuntimeConfigState,
  ]);

  const submitConversationDraft = useCallback((
    draft: ConversationComposerDraft,
  ): { started: boolean; unsupportedMimeType?: string } => {
    const expandedText = expandConversationDraftText(
      draft.text,
      draft.attachments,
    );
    const { attachments, unsupportedMimeType } =
      prepareConversationAttachmentPayload(draft.attachments, draft.text);
    if (unsupportedMimeType) {
      return { started: false, unsupportedMimeType };
    }
    setIsEvaluating(true);
    void runConversation(expandedText, attachments, {
      displayText: draft.text,
    });
    return { started: true };
  }, [
    expandConversationDraftText,
    prepareConversationAttachmentPayload,
    runConversation,
  ]);

  const handleInteractionResponse = useCallback(
    (requestId: string, response: InteractionResponse) => {
      const resolver = interactionResolversRef.current.get(requestId);
      if (!resolver) return;
      resolver(response);
    },
    [],
  );

  const closeConversationMode = useCallback(
    (options?: { clearConversation?: boolean }) => {
      // Resolve all queued interactions as denied so orchestrator is never left hanging.
      for (const interaction of interactionQueue) {
        const resolver = interactionResolversRef.current.get(
          interaction.requestId,
        );
        if (resolver) {
          resolver({ approved: false });
        }
      }
      interactionResolversRef.current.clear();
      setInteractionQueue([]);
      const hadActiveRun = agentControllerRef.current !== null;
      if (agentControllerRef.current) {
        agentControllerRef.current.abort();
        agentControllerRef.current = null;
      }
      setIsEvaluating(false);
      if (options?.clearConversation) {
        conversationRef.current.clear();
      } else if (hadActiveRun) {
        conversationRef.current.finalize("cancelled", {
          turnId: activeRunTurnIdRef.current,
        });
      }
      activeRunTurnIdRef.current = undefined;
      setPendingConversationQueue([]);
      setFooterContextUsageLabel("");
      contextPressureLevelRef.current = "normal";
      setActiveOverlay("none");
      setSurfacePanel("none");
      setLocalAgentEntries([]);
    },
    [interactionQueue],
  );

  const interruptConversationRun = useCallback((
    options?: {
      requestId?: string;
      clearPlanning?: boolean;
      restoreDraft?: boolean;
    },
  ) => {
    if (options?.requestId) {
      handleInteractionResponse(options.requestId, {
        approved: false,
      });
    }
    if (options?.clearPlanning) {
      conversationRef.current.cancelPlanning();
    }

    const controller = agentControllerRef.current;
    if (!controller || controller.signal.aborted) {
      return;
    }

    const currentComposerDraft = getCurrentComposerDraft();
    const restoredDraft = options?.restoreDraft === false ||
        !hasConversationDraftContent(currentComposerDraft)
      ? null
      : currentComposerDraft;

    if (pendingStreamTimerRef.current) {
      clearTimeout(pendingStreamTimerRef.current);
      pendingStreamTimerRef.current = null;
    }

    agentControllerRef.current = null;
    controller.abort();
    interactionResolversRef.current.clear();
    setInteractionQueue([]);
    setLocalAgentEntries((prev: LocalAgentEntry[]) => cancelActiveLocalAgents(prev));
    setIsEvaluating(false);
    setFooterContextUsageLabel("");
    contextPressureLevelRef.current = "normal";
    restoreComposerDraft(restoredDraft);
    conversationRef.current.finalize("cancelled", {
      turnId: activeRunTurnIdRef.current,
    });
    activeRunTurnIdRef.current = undefined;
  }, [
    getCurrentComposerDraft,
    getPendingConversationQueue,
    handleInteractionResponse,
    restoreComposerDraft,
    setFooterContextUsageLabel,
  ]);

  const handleForceInterrupt = useCallback(
    (code: string, attachments?: AnyAttachment[]) => {
      if (!code.trim()) return;
      recordPromptHistory(
        replState,
        code,
        "conversation",
        undefined,
        attachments,
      );
      clearComposerDraft();
      const draft = createConversationComposerDraft(code.trim(), attachments);

      interruptConversationRun({
        restoreDraft: false,
      });

      // Send immediately (bypass queue)
      const result = submitConversationDraft(draft);
      if (!result.started) {
        restoreComposerDraft(draft);
        if (result.unsupportedMimeType) {
          conversationRef.current.addError(
            describeConversationAttachmentMimeTypeError(
              result.unsupportedMimeType,
            ),
          );
        }
      }
    },
    [
      clearComposerDraft,
      interruptConversationRun,
      replState,
      restoreComposerDraft,
      submitConversationDraft,
    ],
  );

  return {
    interactionQueue,
    setInteractionQueue,
    pendingInteraction,
    localAgentEntries,
    interruptLocalAgentEntry,
    agentControllerRef,
    interactionResolversRef,
    prepareConversationAttachmentPayload,
    expandConversationDraftText,
    runConversation,
    submitConversationDraft,
    handleInteractionResponse,
    closeConversationMode,
    interruptConversationRun,
    handleForceInterrupt,
  };
}
