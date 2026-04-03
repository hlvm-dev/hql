import type { Message as AgentMessage } from "./context.ts";
import { deriveDefaultSessionKey } from "../runtime/session-key.ts";
import {
  createSession,
  getOrCreateSession,
  getSession,
  insertMessage,
  updateSession,
} from "../store/conversation-store.ts";
import {
  parseSessionMetadata,
  updateSessionMetadata,
} from "../store/session-metadata.ts";
import { loadAllMessages } from "../store/message-utils.ts";
import { buildStoredAgentHistoryMessages } from "../cli/repl/handlers/chat-context.ts";
import type { TodoItem } from "./todo-state.ts";
import type { Plan } from "./planning.ts";
import {
  cloneTeamRuntimeSnapshot,
  type TeamRuntimeSnapshot,
} from "./team-runtime.ts";
import type { DelegateBatchSnapshot } from "./delegate-batches.ts";
import {
  normalizeExecutionFallbackState,
  type ExecutionFallbackState,
} from "./execution-surface.ts";
import {
  normalizeRoutingConstraintSet,
  type RoutingConstraintSet,
} from "./routing-constraints.ts";
import { normalizeRuntimeMode, type RuntimeMode } from "./runtime-mode.ts";
import {
  normalizeExecutionTaskCapabilityContext,
  type ExecutionTaskCapabilityContext,
} from "./task-capability-context.ts";
import {
  normalizeExecutionResponseShapeContext,
  type ExecutionResponseShapeContext,
} from "./response-shape-context.ts";
import {
  normalizeExecutionTurnContext,
  type ExecutionTurnContext,
} from "./turn-context.ts";

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
  runtimeMode?: RuntimeMode;
  discoveredDeferredTools?: string[];
  lastAppliedRoutingConstraints?: RoutingConstraintSet;
  lastAppliedTaskCapabilityContext?: ExecutionTaskCapabilityContext;
  lastAppliedResponseShapeContext?: ExecutionResponseShapeContext;
  lastAppliedTurnContext?: ExecutionTurnContext;
  lastAppliedExecutionFallbackState?: ExecutionFallbackState;
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

export function getPersistedAgentSessionId(): string {
  const sessionId = deriveDefaultSessionKey();
  getOrCreateSession(sessionId);
  return sessionId;
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
        ...(typeof options.success === "boolean"
          ? { success: options.success }
          : {}),
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
    runtimeMode: normalizeRuntimeMode(agentRecord.runtimeMode),
    discoveredDeferredTools: Array.isArray(agentRecord.discoveredDeferredTools)
      ? agentRecord.discoveredDeferredTools.filter((value): value is string =>
        typeof value === "string"
      )
      : undefined,
    lastAppliedRoutingConstraints: normalizeRoutingConstraintSet(
      agentRecord.lastAppliedRoutingConstraints,
    ),
    lastAppliedTaskCapabilityContext: normalizeExecutionTaskCapabilityContext(
      agentRecord.lastAppliedTaskCapabilityContext,
    ),
    lastAppliedResponseShapeContext: normalizeExecutionResponseShapeContext(
      agentRecord.lastAppliedResponseShapeContext,
    ),
    lastAppliedTurnContext: normalizeExecutionTurnContext(
      agentRecord.lastAppliedTurnContext,
    ),
    lastAppliedExecutionFallbackState: normalizeExecutionFallbackState(
      agentRecord.lastAppliedExecutionFallbackState,
    ),
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
    agent: typeof agentRecord.agent === "string"
      ? agentRecord.agent
      : undefined,
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

/** DRY helper: clone a Plan for safe persistence (deep-copy arrays). */
function clonePlanForPersistence(plan: Plan): Plan {
  return {
    goal: plan.goal,
    steps: plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      ...(step.goal ? { goal: step.goal } : {}),
      ...(step.tools ? { tools: [...step.tools] } : {}),
      ...(step.successCriteria
        ? { successCriteria: [...step.successCriteria] }
        : {}),
      ...(step.agent ? { agent: step.agent } : {}),
    })),
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

function isTeamRuntimeSnapshotRecord(
  value: unknown,
): value is TeamRuntimeSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.teamId === "string" &&
    typeof record.leadMemberId === "string" &&
    Array.isArray(record.members) &&
    Array.isArray(record.tasks) &&
    Array.isArray(record.messages) &&
    Array.isArray(record.approvals) &&
    Array.isArray(record.shutdowns);
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

export function persistAgentRuntimeMode(
  sessionId: string,
  runtimeMode: RuntimeMode,
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.runtimeMode = runtimeMode;
  });
}

export function persistDiscoveredDeferredTools(
  sessionId: string,
  tools: Iterable<string>,
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    const next = [...new Set(tools)];
    metadata.discoveredDeferredTools = next.length > 0 ? next : undefined;
  });
}

export function persistLastAppliedRoutingConstraints(
  sessionId: string,
  constraints: RoutingConstraintSet,
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.lastAppliedRoutingConstraints = {
      hardConstraints: [...constraints.hardConstraints],
      ...(constraints.preference ? { preference: constraints.preference } : {}),
      preferenceConflict: constraints.preferenceConflict,
      source: constraints.source,
    };
  });
}

export function persistLastAppliedTaskCapabilityContext(
  sessionId: string,
  taskCapabilityContext: ExecutionTaskCapabilityContext,
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.lastAppliedTaskCapabilityContext = {
      requestedCapabilities: [...taskCapabilityContext.requestedCapabilities],
      source: taskCapabilityContext.source,
      matchedCueLabels: [...taskCapabilityContext.matchedCueLabels],
    };
  });
}

export function persistLastAppliedResponseShapeContext(
  sessionId: string,
  responseShapeContext: ExecutionResponseShapeContext,
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.lastAppliedResponseShapeContext = {
      requested: responseShapeContext.requested,
      source: responseShapeContext.source,
      ...(responseShapeContext.schemaSignature
        ? { schemaSignature: responseShapeContext.schemaSignature }
        : {}),
      topLevelKeys: [...responseShapeContext.topLevelKeys],
    };
  });
}

export function persistLastAppliedTurnContext(
  sessionId: string,
  turnContext: ExecutionTurnContext,
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.lastAppliedTurnContext = {
      attachmentCount: turnContext.attachmentCount,
      attachmentKinds: [...turnContext.attachmentKinds],
      visionEligibleAttachmentCount: turnContext.visionEligibleAttachmentCount,
      visionEligibleKinds: [...turnContext.visionEligibleKinds],
      audioEligibleAttachmentCount: turnContext.audioEligibleAttachmentCount,
      audioEligibleKinds: [...turnContext.audioEligibleKinds],
    };
  });
}

export function persistLastAppliedExecutionFallbackState(
  sessionId: string,
  fallbackState: ExecutionFallbackState,
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.lastAppliedExecutionFallbackState = {
      suppressedCandidates: fallbackState.suppressedCandidates.map((
        candidate,
      ) => ({
        capabilityId: candidate.capabilityId,
        backendKind: candidate.backendKind,
        ...(candidate.toolName ? { toolName: candidate.toolName } : {}),
        ...(candidate.serverName ? { serverName: candidate.serverName } : {}),
        routePhase: candidate.routePhase,
        failureReason: candidate.failureReason,
      })),
    };
  });
}

export function persistAgentPlanState(
  sessionId: string,
  plan: Plan | undefined,
  completedPlanStepIds: Iterable<string>,
): void {
  updatePersistedAgentSessionMetadata(sessionId, (metadata) => {
    metadata.plan = plan ? clonePlanForPersistence(plan) : undefined;
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
      plan: clonePlanForPersistence(plan),
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
