import {
  createTranscriptState,
  type TranscriptState,
} from "../agent-transcript-state.ts";
import {
  detectMimeType,
  getAttachmentType,
  getDisplayName,
} from "../repl/attachment.ts";
import { createTodoStateFromPlan } from "../../agent/todo-state.ts";
import {
  loadPersistedAgentChildSessionSummaries,
  parsePersistedAgentSessionMetadata,
} from "../../agent/persisted-transcript.ts";
import { cloneTeamRuntimeSnapshot } from "../../agent/team-runtime.ts";
import type { Session, SessionMessage } from "../repl/session/types.ts";
import type {
  ConversationItem,
  DelegateItem,
  TeamRuntimeSnapshotInfoItem,
  ToolCallDisplay,
  ToolGroupItem,
} from "./types.ts";

function formatAttachmentLabels(
  attachments?: readonly string[],
): string[] | undefined {
  if (!attachments?.length) return undefined;
  return attachments.map((path, index) =>
    getDisplayName(getAttachmentType(detectMimeType(path)), index + 1)
  );
}

function buildToolGroup(
  startIndex: number,
  messages: readonly SessionMessage[],
): { item: ToolGroupItem; nextIndex: number } {
  const tools: ToolCallDisplay[] = [];
  let index = startIndex;

  while (index < messages.length && messages[index]?.role === "tool") {
    const message = messages[index]!;
    tools.push({
      id: `session-tool-${index}`,
      name: message.toolName ?? "tool",
      argsSummary: message.toolArgsSummary ?? "",
      status: message.toolSuccess === false ? "error" : "success",
      resultSummaryText: message.content,
      resultText: message.content,
      toolIndex: tools.length + 1,
      toolTotal: 0,
    });
    index += 1;
  }

  const finalizedTools = tools.map((tool, toolIndex) => ({
    ...tool,
    toolIndex: toolIndex + 1,
    toolTotal: tools.length,
  }));

  return {
    item: {
      type: "tool_group",
      id: `session-tool-group-${startIndex}`,
      tools: finalizedTools,
      ts: messages[startIndex]?.ts ?? Date.now(),
    },
    nextIndex: index,
  };
}

export function buildConversationItemsFromSessionMessages(
  messages: readonly SessionMessage[],
): ConversationItem[] {
  const items: ConversationItem[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role === "tool") {
      const { item, nextIndex } = buildToolGroup(index, messages);
      items.push(item);
      index = nextIndex - 1;
      continue;
    }

    if (message.role === "user") {
      items.push({
        type: "user",
        id: `session-user-${index}`,
        text: message.content,
        attachments: formatAttachmentLabels(message.attachments),
        ts: message.ts,
      });
      continue;
    }

    items.push({
      type: "assistant",
      id: `session-assistant-${index}`,
      text: message.content,
      isPending: false,
      ts: message.ts,
    });
  }

  return items;
}

function buildDelegateItemsFromSession(
  session: Session,
): DelegateItem[] {
  return loadPersistedAgentChildSessionSummaries(session.meta.id).map((
    child,
  ) => ({
    type: "delegate",
    id: `session-delegate-${child.sessionId}`,
    agent: child.agent,
    task: child.task,
    childSessionId: child.sessionId,
    status: child.status,
    summary: child.summary,
    error: child.error,
    durationMs: Math.max(0, child.updatedAt - child.createdAt),
    snapshot: child.snapshot,
    ts: child.createdAt,
  }));
}

function getItemTimestamp(item: ConversationItem): number {
  switch (item.type) {
    case "user":
    case "assistant":
    case "tool_group":
    case "delegate":
    case "info":
      return item.ts ?? Number.MAX_SAFE_INTEGER;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}

export function buildTranscriptStateFromSession(
  session: Session,
): TranscriptState {
  const baseItems = buildConversationItemsFromSessionMessages(session.messages);
  const delegateItems = buildDelegateItemsFromSession(session);
  const metadata = parsePersistedAgentSessionMetadata(session.meta.metadata);
  const teamSnapshotItem: TeamRuntimeSnapshotInfoItem | undefined =
    metadata.teamRuntime
      ? (() => {
        const snapshot = cloneTeamRuntimeSnapshot(metadata.teamRuntime);
        const activeMembers = snapshot.members.filter((member) =>
          member.status === "active" ||
          member.status === "shutdown_requested" ||
          member.status === "shutting_down"
        ).length;
        const pendingApprovals = snapshot.approvals.filter((approval) =>
          approval.status === "pending"
        ).length;
        const unreadMessages = snapshot.messages.filter((message) =>
          (!message.toMemberId ||
            message.toMemberId === snapshot.leadMemberId) &&
          !message.readBy.includes(snapshot.leadMemberId)
        ).length;
        return {
          type: "info",
          id: "session-team-runtime",
          teamEventType: "team_runtime_snapshot",
          text:
            `Restored team state: ${activeMembers}/${snapshot.members.length} active · ${snapshot.tasks.length} tasks · ${pendingApprovals} pending reviews · ${unreadMessages} unread`,
          snapshot,
          ts: session.meta.updatedAt,
        };
      })()
      : undefined;
  const items = [
    ...baseItems,
    ...delegateItems,
    ...(teamSnapshotItem ? [teamSnapshotItem] : []),
  ]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const tsDiff = getItemTimestamp(a.item) - getItemTimestamp(b.item);
      return tsDiff !== 0 ? tsDiff : a.index - b.index;
    })
    .map(({ item }) => item);

  return {
    ...createTranscriptState(),
    items,
    nextId: items.length,
    activePlan: metadata.plan,
    completedPlanStepIds: [...(metadata.completedPlanStepIds ?? [])],
    todoState: metadata.todos
      ? { items: metadata.todos.map((item) => ({ ...item })) }
      : undefined,
    planTodoState: metadata.plan
      ? createTodoStateFromPlan(
        metadata.plan.steps,
        new Set(metadata.completedPlanStepIds ?? []),
        (metadata.completedPlanStepIds?.length ?? 0) <
            metadata.plan.steps.length
          ? metadata.completedPlanStepIds?.length
          : undefined,
      )
      : undefined,
    pendingPlanReview: metadata.pendingPlanReview
      ? {
        plan: {
          goal: metadata.pendingPlanReview.plan.goal,
          steps: metadata.pendingPlanReview.plan.steps.map((step) => ({
            ...step,
          })),
        },
      }
      : undefined,
    latestCheckpoint: metadata.checkpoints?.length
      ? { ...metadata.checkpoints[metadata.checkpoints.length - 1]! }
      : undefined,
  };
}
