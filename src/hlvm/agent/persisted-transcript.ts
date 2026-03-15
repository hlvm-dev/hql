import type { Message as AgentMessage } from "./context.ts";
import { deriveDefaultSessionKey } from "../runtime/session-key.ts";
import {
  createSession,
  getOrCreateSession,
  getSession,
  insertMessage,
  listSessions,
  updateSession,
} from "../store/conversation-store.ts";
import {
  parseSessionMetadata,
  updateSessionMetadata,
} from "../store/session-metadata.ts";
import { loadAllMessages } from "../store/message-utils.ts";
import { buildStoredAgentHistoryMessages } from "../cli/repl/handlers/chat-context.ts";
import type { TodoItem } from "./todo-state.ts";
import type { DelegateTranscriptSnapshot } from "./delegate-transcript.ts";
import type { Plan } from "./planning.ts";
import {
  cloneTeamRuntimeSnapshot,
  type TeamRuntimeSnapshot,
} from "./team-runtime.ts";
import type { DelegateBatchSnapshot } from "./delegate-batches.ts";

const DEFAULT_TITLE_LENGTH = 60;
const AGENT_SESSION_METADATA_KEY = "agentSession";

export interface PersistedAgentTurn {
  sessionId: string;
  requestId: string;
}

interface PersistedToolMessageMetadata {
  argsSummary?: string;
  success?: boolean;
}

export interface PersistedAgentSessionMetadata {
  parentSessionId?: string;
  childSessionIds?: string[];
  todos?: TodoItem[];
  todoSource?: "plan" | "tool" | "team";
  plan?: Plan;
  completedPlanStepIds?: string[];
  agent?: string;
  task?: string;
  pendingPlanReview?: {
    requestId: string;
    plan: Plan;
    requestedAt: number;
  };
  approvedPlanSignature?: string;
  teamRuntime?: TeamRuntimeSnapshot;
  delegateBatches?: DelegateBatchSnapshot[];
}

interface CreatePersistedAgentChildSessionOptions {
  parentSessionId: string;
  agent: string;
  task: string;
}

interface PersistedAgentChildSessionSummary {
  sessionId: string;
  agent: string;
  task: string;
  createdAt: number;
  updatedAt: number;
  status: "success" | "error";
  summary?: string;
  error?: string;
  snapshot: DelegateTranscriptSnapshot;
}

export function getPersistedAgentSessionId(): string {
  return deriveDefaultSessionKey();
}

export async function loadPersistedAgentHistory(options: {
  sessionId?: string;
  model: string;
  maxGroups: number;
}): Promise<{ sessionId: string; history: AgentMessage[] }> {
  const sessionId = options.sessionId ?? getPersistedAgentSessionId();
  getOrCreateSession(sessionId);

  const history = await buildStoredAgentHistoryMessages({
    storedMessages: loadAllMessages(sessionId),
    maxGroups: options.maxGroups,
    modelKey: options.model,
  });

  return { sessionId, history };
}

export function startPersistedAgentTurn(
  sessionId: string,
  query: string,
): PersistedAgentTurn {
  const requestId = crypto.randomUUID();
  getOrCreateSession(sessionId);
  ensureDefaultTitle(sessionId, query);
  insertMessage({
    session_id: sessionId,
    role: "user",
    content: query,
    request_id: requestId,
    sender_type: "user",
  });
  return { sessionId, requestId };
}

export function appendPersistedAgentToolResult(
  turn: PersistedAgentTurn,
  toolName: string,
  content: string,
  options?: PersistedToolMessageMetadata,
): void {
  insertMessage({
    session_id: turn.sessionId,
    role: "tool",
    content,
    request_id: turn.requestId,
    sender_type: "agent",
    tool_name: toolName,
    tool_calls: (options?.argsSummary || typeof options?.success === "boolean")
      ? [{
        ...(options.argsSummary ? { argsSummary: options.argsSummary } : {}),
        ...(typeof options.success === "boolean" ? { success: options.success } : {}),
      }]
      : undefined,
  });
}

export function completePersistedAgentTurn(
  turn: PersistedAgentTurn,
  model: string,
  content: string,
): void {
  insertMessage({
    session_id: turn.sessionId,
    role: "assistant",
    content,
    request_id: turn.requestId,
    sender_type: "agent",
    sender_detail: model,
  });
}

function ensureDefaultTitle(sessionId: string, query: string): void {
  const session = getSession(sessionId);
  if (!session || session.title.length > 0) return;

  const title = query.slice(0, DEFAULT_TITLE_LENGTH).replace(/\n/g, " ").trim();
  if (!title) return;
  updateSession(sessionId, { title });
}

export function parsePersistedAgentSessionMetadata(
  metadata: string | null | undefined,
): PersistedAgentSessionMetadata {
  const parsed = parseSessionMetadata(metadata);
  const record = parsed[AGENT_SESSION_METADATA_KEY];
  if (!record || typeof record !== "object") {
    return {};
  }

  const agentRecord = record as Record<string, unknown>;
  const childSessionIds = Array.isArray(agentRecord.childSessionIds)
    ? agentRecord.childSessionIds.filter((value): value is string =>
      typeof value === "string"
    )
    : undefined;
  const todos = Array.isArray(agentRecord.todos)
    ? agentRecord.todos.filter((value): value is TodoItem =>
      !!value && typeof value === "object" &&
      typeof (value as TodoItem).id === "string" &&
      typeof (value as TodoItem).content === "string" &&
      (
        (value as TodoItem).status === "pending" ||
        (value as TodoItem).status === "in_progress" ||
        (value as TodoItem).status === "completed"
      )
    )
    : undefined;
  const pendingPlanReview =
    isPendingPlanReviewRecord(agentRecord.pendingPlanReview)
      ? {
        requestId: agentRecord.pendingPlanReview.requestId,
        plan: agentRecord.pendingPlanReview.plan,
        requestedAt: agentRecord.pendingPlanReview.requestedAt,
      }
      : undefined;
  const teamRuntime = isTeamRuntimeSnapshotRecord(agentRecord.teamRuntime)
    ? cloneTeamRuntimeSnapshot(agentRecord.teamRuntime)
    : undefined;
  const delegateBatches = Array.isArray(agentRecord.delegateBatches)
    ? agentRecord.delegateBatches.filter(isDelegateBatchSnapshotRecord).map(
      cloneDelegateBatchSnapshot,
    )
    : undefined;

  return {
    parentSessionId: typeof agentRecord.parentSessionId === "string"
      ? agentRecord.parentSessionId
      : undefined,
    childSessionIds,
    todos,
    todoSource: agentRecord.todoSource === "plan" ||
        agentRecord.todoSource === "tool" ||
        agentRecord.todoSource === "team"
      ? agentRecord.todoSource
      : undefined,
    plan: isPlanRecord(agentRecord.plan) ? agentRecord.plan : undefined,
    completedPlanStepIds: Array.isArray(agentRecord.completedPlanStepIds)
      ? agentRecord.completedPlanStepIds.filter((value): value is string =>
        typeof value === "string"
      )
      : undefined,
    agent: typeof agentRecord.agent === "string" ? agentRecord.agent : undefined,
    task: typeof agentRecord.task === "string" ? agentRecord.task : undefined,
    pendingPlanReview,
    approvedPlanSignature: typeof agentRecord.approvedPlanSignature === "string"
      ? agentRecord.approvedPlanSignature
      : undefined,
    teamRuntime,
    delegateBatches,
  };
}

function cloneDelegateBatchSnapshot(
  snapshot: DelegateBatchSnapshot,
): DelegateBatchSnapshot {
  return {
    ...snapshot,
    threadIds: [...snapshot.threadIds],
  };
}

function isPlanRecord(value: unknown): value is Plan {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.goal === "string" &&
    Array.isArray(record.steps) &&
    record.steps.every((step) =>
      !!step && typeof step === "object" &&
      typeof (step as { id?: unknown }).id === "string" &&
      typeof (step as { title?: unknown }).title === "string"
    );
}

function isPendingPlanReviewRecord(
  value: unknown,
): value is { requestId: string; plan: Plan; requestedAt: number } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.requestId === "string" &&
    typeof record.requestedAt === "number" &&
    isPlanRecord(record.plan);
}

function isTeamRuntimeSnapshotRecord(value: unknown): value is TeamRuntimeSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.teamId !== "string" ||
    typeof record.leadMemberId !== "string" ||
    !Array.isArray(record.members) ||
    !Array.isArray(record.tasks) ||
    !Array.isArray(record.messages) ||
    !Array.isArray(record.approvals) ||
    !Array.isArray(record.shutdowns)
  ) {
    return false;
  }
  return true;
}

function isDelegateBatchSnapshotRecord(
  value: unknown,
): value is DelegateBatchSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.batchId === "string" &&
    typeof record.agent === "string" &&
    typeof record.totalRows === "number" &&
    Array.isArray(record.threadIds) &&
    typeof record.spawnFailures === "number" &&
    typeof record.createdAt === "number" &&
    typeof record.queued === "number" &&
    typeof record.running === "number" &&
    typeof record.completed === "number" &&
    typeof record.errored === "number" &&
    typeof record.cancelled === "number" &&
    typeof record.spawned === "number" &&
    (
      record.status === "running" || record.status === "completed" ||
      record.status === "partial"
    );
}

function updatePersistedAgentSessionMetadata(
  sessionId: string,
  mutate: (metadata: PersistedAgentSessionMetadata) => void,
): void {
  updateSessionMetadata(sessionId, (existing) => {
    const next = parsePersistedAgentSessionMetadata(JSON.stringify(existing));
    mutate(next);
    existing[AGENT_SESSION_METADATA_KEY] = next;
  });
}

export function persistAgentTodos(
  sessionId: string,
  items: TodoItem[],
  source: "plan" | "tool" | "team",
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.todos = items.map((item) => ({ ...item }));
    metadata.todoSource = source;
  });
}

export function persistAgentPlanState(
  sessionId: string,
  plan: Plan | undefined,
  completedPlanStepIds: Iterable<string>,
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.plan = plan
      ? {
        goal: plan.goal,
        steps: plan.steps.map((step) => ({
          id: step.id,
          title: step.title,
          ...(step.goal ? { goal: step.goal } : {}),
          ...(step.tools ? { tools: [...step.tools] } : {}),
          ...(step.successCriteria ? { successCriteria: [...step.successCriteria] } : {}),
          ...(step.agent ? { agent: step.agent } : {}),
        })),
      }
      : undefined;
    metadata.completedPlanStepIds = plan
      ? [...new Set([...completedPlanStepIds])]
      : undefined;
  });
}

export function persistPendingPlanReview(
  sessionId: string,
  requestId: string,
  plan: Plan,
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.pendingPlanReview = {
      requestId,
      requestedAt: Date.now(),
      plan: {
        goal: plan.goal,
        steps: plan.steps.map((step) => ({
          id: step.id,
          title: step.title,
          ...(step.goal ? { goal: step.goal } : {}),
          ...(step.tools ? { tools: [...step.tools] } : {}),
          ...(step.successCriteria ? { successCriteria: [...step.successCriteria] } : {}),
          ...(step.agent ? { agent: step.agent } : {}),
        })),
      },
    };
  });
}

export function resolvePendingPlanReview(
  sessionId: string,
  options: { approved: boolean; planSignature?: string },
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.pendingPlanReview = undefined;
    metadata.approvedPlanSignature = options.approved
      ? options.planSignature
      : undefined;
  });
}

export function resetApprovedPlanSignature(sessionId: string): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.approvedPlanSignature = undefined;
    metadata.pendingPlanReview = undefined;
  });
}

export function clearPersistedAgentPlanningState(sessionId: string): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.plan = undefined;
    metadata.completedPlanStepIds = undefined;
    metadata.pendingPlanReview = undefined;
    metadata.approvedPlanSignature = undefined;
    if (metadata.todoSource === "plan") {
      metadata.todos = undefined;
      metadata.todoSource = undefined;
    }
  });
}

export function persistAgentTeamRuntime(
  sessionId: string,
  snapshot: TeamRuntimeSnapshot,
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.teamRuntime = cloneTeamRuntimeSnapshot(snapshot);
  });
}

export function persistAgentDelegateBatches(
  sessionId: string,
  snapshots: readonly DelegateBatchSnapshot[],
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.delegateBatches = snapshots.map(cloneDelegateBatchSnapshot);
  });
}

export function createPersistedAgentChildSession(
  options: CreatePersistedAgentChildSessionOptions,
): PersistedAgentTurn {
  const title = `${options.agent}: ${
    options.task.slice(0, DEFAULT_TITLE_LENGTH).replace(/\n/g, " ").trim()
  }`;
  const childSession = createSession(title);
  updatePersistedAgentSessionMetadata(childSession.id, (metadata) => {
    metadata.parentSessionId = options.parentSessionId;
    metadata.agent = options.agent;
    metadata.task = options.task;
  });
  updatePersistedAgentSessionMetadata(options.parentSessionId, (metadata) => {
    const childIds = new Set(metadata.childSessionIds ?? []);
    childIds.add(childSession.id);
    metadata.childSessionIds = [...childIds];
  });
  return startPersistedAgentTurn(childSession.id, options.task);
}

export function loadPersistedAgentTodos(sessionId: string): TodoItem[] {
  const session = getSession(sessionId);
  const metadata = parsePersistedAgentSessionMetadata(session?.metadata);
  return (metadata.todos ?? []).map((item) => ({ ...item }));
}

export function loadPersistedAgentSessionMetadata(
  sessionId: string,
): PersistedAgentSessionMetadata {
  const session = getSession(sessionId);
  return parsePersistedAgentSessionMetadata(session?.metadata);
}

function listPersistedAgentChildSessions(
  parentSessionId: string,
): string[] {
  return listSessions()
    .filter((session) => {
      const metadata = parsePersistedAgentSessionMetadata(session.metadata);
      return metadata.parentSessionId === parentSessionId;
    })
    .map((session) => session.id);
}

export function loadPersistedAgentChildSessionSummaries(
  parentSessionId: string,
): PersistedAgentChildSessionSummary[] {
  const parent = getSession(parentSessionId);
  const parentMetadata = parsePersistedAgentSessionMetadata(parent?.metadata);
  const childIds = parentMetadata.childSessionIds ?? listPersistedAgentChildSessions(parentSessionId);

  return childIds.flatMap((sessionId) => {
    const child = getSession(sessionId);
    if (!child) return [];

    const metadata = parsePersistedAgentSessionMetadata(child.metadata);
    const messages = loadAllMessages(sessionId);
    const toolMessages = messages.filter((message) => message.role === "tool");
    const finalAssistant = [...messages].reverse().find((message) =>
      message.role === "assistant"
    )?.content;
    const failurePrefix = "Delegation failed:";
    const error = !finalAssistant
      ? "Incomplete child session"
      : finalAssistant.startsWith(failurePrefix)
      ? finalAssistant.slice(failurePrefix.length).trim() || finalAssistant
      : undefined;
    const summary = error ? undefined : finalAssistant;
    const createdAt = Date.parse(child.created_at);
    const updatedAt = Date.parse(child.updated_at);
    const durationMs = Math.max(
      0,
      (Number.isFinite(updatedAt) ? updatedAt : createdAt) -
        (Number.isFinite(createdAt) ? createdAt : updatedAt),
    );

    return [{
      sessionId,
      agent: metadata.agent ?? "delegate",
      task: metadata.task ?? child.title,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      status: error ? "error" as const : "success" as const,
      summary,
      error,
      snapshot: {
        agent: metadata.agent ?? "delegate",
        task: metadata.task ?? child.title,
        childSessionId: sessionId,
        success: !error,
        durationMs,
        toolCount: toolMessages.length,
        finalResponse: summary,
        error,
        events: toolMessages.map((message) => ({
          type: "tool_end" as const,
          name: message.tool_name ?? "tool",
          success: parsePersistedToolMessageMetadata(message.tool_calls).success ?? true,
          content: message.content,
          summary: message.content,
          durationMs: 0,
          argsSummary: parsePersistedToolMessageMetadata(message.tool_calls).argsSummary ?? "",
        })),
      },
    }];
  }).sort((a, b) => a.createdAt - b.createdAt);
}

function parsePersistedToolMessageMetadata(
  value: string | null,
): PersistedToolMessageMetadata {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    const record = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!record || typeof record !== "object") return {};
    return {
      argsSummary: typeof (record as { argsSummary?: unknown }).argsSummary === "string"
        ? (record as { argsSummary: string }).argsSummary
        : undefined,
      success: typeof (record as { success?: unknown }).success === "boolean"
        ? (record as { success: boolean }).success
        : undefined,
    };
  } catch {
    return {};
  }
}
