import { delay } from "@std/async";
import { http } from "../../common/http-client.ts";
import { RuntimeError } from "../../common/error.ts";
import { HQLErrorCode } from "../../common/error-codes.ts";
import { getPlatform } from "../../platform/platform.ts";
import type { ConfigKey, HlvmConfig } from "../../common/config/types.ts";
import type {
  AgentUIEvent,
  FinalResponseMeta,
  TraceEvent,
} from "../agent/orchestrator.ts";
import type { AgentExecutionMode } from "../agent/execution-mode.ts";
import {
  getHlvmRuntimeBaseUrl,
  resolveHlvmRuntimePort,
} from "./host-config.ts";
import {
  type ChatMode,
  type ChatRequest,
  type ChatRequestMessage,
  type ChatResultStats,
  type ChatStreamEvent,
  type HostHealthResponse,
  type InteractionResponseRequest,
} from "./chat-protocol.ts";
import {
  type RuntimeSession,
  type RuntimeSessionMessage,
  type RuntimeSessionMessageInput,
  type RuntimeSessionMessagesResponse,
  type RuntimeSessionsResponse,
} from "./session-protocol.ts";
import { deriveDefaultSessionKey } from "./session-key.ts";
import type {
  PullProgress,
  RuntimeModelDiscoveryResponse,
  RuntimeModelPullStreamEvent,
} from "./model-protocol.ts";
import type { ModelInfo, ProviderStatus } from "../providers/types.ts";
import type {
  RuntimeMcpListResponse,
  RuntimeMcpOauthResponse,
  RuntimeMcpRemoveResponse,
  RuntimeMcpServerDescriptor,
  RuntimeMcpServerInput,
} from "./mcp-protocol.ts";
import type { RuntimeOllamaSigninResponse } from "./provider-protocol.ts";
import {
  areRuntimeHostBuildIdsCompatible,
  buildRuntimeServeCommand,
  getRuntimeHostIdentity,
} from "./host-identity.ts";

const STREAM_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const HEALTH_POLL_ATTEMPTS = 60;
const HEALTH_POLL_DELAY_MS = 100;
const RUNTIME_SHUTDOWN_POLL_ATTEMPTS = 30;
const RUNTIME_START_LOCK_WAIT_ATTEMPTS = 120;
const RUNTIME_START_LOCK_STALE_MS = 30_000;

export interface RuntimeInteractionRequest {
  requestId: string;
  mode: "permission" | "question";
  toolName?: string;
  toolArgs?: string;
  question?: string;
}

export interface RuntimeInteractionResponse {
  approved?: boolean;
  rememberChoice?: boolean;
  userInput?: string;
}

export interface HostBackedChatResult {
  text: string;
  stats: ChatResultStats;
  sessionVersion: number;
  duplicateMessage?: unknown;
}

export interface HostBackedAgentQueryResult {
  text: string;
  stats: ChatResultStats;
}

export interface RuntimeConfigApi {
  set: (key: string, value: unknown) => Promise<void>;
  patch: (updates: Partial<Record<ConfigKey, unknown>>) => Promise<HlvmConfig>;
  reset: () => Promise<HlvmConfig>;
  reload: () => Promise<HlvmConfig>;
  readonly all: Promise<HlvmConfig>;
}

export interface HostBackedChatCallbacks {
  onToken?: (text: string) => void;
  onAgentEvent?: (event: AgentUIEvent) => void;
  onTrace?: (event: TraceEvent) => void;
  onFinalResponseMeta?: (meta: FinalResponseMeta) => void;
}

export interface HostBackedChatOptions {
  mode: ChatMode;
  sessionId: string;
  messages: ChatRequestMessage[];
  model?: string;
  fixturePath?: string;
  contextWindow?: number;
  skipSessionHistory?: boolean;
  disablePersistentMemory?: boolean;
  historyContext?: string;
  permissionMode?: AgentExecutionMode;
  toolDenylist?: string[];
  expectedVersion?: number;
  signal?: AbortSignal;
  callbacks?: HostBackedChatCallbacks;
  onInteraction?: (
    event: RuntimeInteractionRequest,
  ) => Promise<RuntimeInteractionResponse>;
}

export interface HostBackedAgentQueryOptions {
  query: string;
  model: string;
  fixturePath?: string;
  imagePaths?: string[];
  contextWindow?: number;
  skipSessionHistory?: boolean;
  disablePersistentMemory?: boolean;
  historyContext?: string;
  permissionMode?: AgentExecutionMode;
  toolDenylist?: string[];
  signal?: AbortSignal;
  callbacks?: HostBackedChatCallbacks;
  onInteraction?: (
    event: RuntimeInteractionRequest,
  ) => Promise<RuntimeInteractionResponse>;
}

export interface HostBackedDirectChatOptions {
  query: string;
  sessionId: string;
  model?: string;
  imagePaths?: string[];
  expectedVersion?: number;
  signal?: AbortSignal;
  callbacks: Pick<HostBackedChatCallbacks, "onToken">;
}

function defaultChatStats(): ChatResultStats {
  return {
    messageCount: 0,
    estimatedTokens: 0,
    toolMessages: 0,
  };
}

function authHeaders(authToken: string): Record<string, string> {
  return { "Authorization": `Bearer ${authToken}` };
}

function createRuntimeHostError(
  message: string,
  originalError?: Error,
): RuntimeError {
  return new RuntimeError(message, {
    code: /\[HQL\d{4}\]/.test(message)
      ? undefined
      : HQLErrorCode.RUNTIME_HOST_REQUEST_FAILED,
    originalError,
  });
}

function matchesRuntimeHostIdentity(
  health: HostHealthResponse,
  buildId: string,
): boolean {
  return areRuntimeHostBuildIdsCompatible(buildId, health.buildId);
}

async function readHealth(baseUrl: string): Promise<HostHealthResponse | null> {
  try {
    const response = await http.fetchRaw(`${baseUrl}/health`, { timeout: 500 });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return await response.json() as HostHealthResponse;
  } catch {
    return null;
  }
}

async function waitForHealthyRuntime(
  baseUrl: string,
  predicate?: (health: HostHealthResponse) => boolean,
  attempts = HEALTH_POLL_ATTEMPTS,
): Promise<HostHealthResponse | null> {
  for (let i = 0; i < attempts; i++) {
    const health = await readHealth(baseUrl);
    if (
      health?.status === "ok" && health.authToken &&
      (!predicate || predicate(health))
    ) {
      if (health.aiReady) return health;
    }
    await delay(HEALTH_POLL_DELAY_MS);
  }
  const health = await readHealth(baseUrl);
  if (
    health?.status === "ok" && health.authToken &&
    (!predicate || predicate(health))
  ) {
    return health;
  }
  return null;
}

async function waitForRuntimeHost(
  baseUrl: string,
  predicate?: (health: HostHealthResponse) => boolean,
  attempts = HEALTH_POLL_ATTEMPTS,
): Promise<HostHealthResponse | null> {
  for (let i = 0; i < attempts; i++) {
    const health = await readHealth(baseUrl);
    if (
      health?.status === "ok" && health.authToken &&
      (!predicate || predicate(health))
    ) {
      return health;
    }
    await delay(HEALTH_POLL_DELAY_MS);
  }
  const health = await readHealth(baseUrl);
  if (
    health?.status === "ok" && health.authToken &&
    (!predicate || predicate(health))
  ) {
    return health;
  }
  return null;
}

async function waitForRuntimeShutdown(baseUrl: string): Promise<boolean> {
  for (let i = 0; i < RUNTIME_SHUTDOWN_POLL_ATTEMPTS; i++) {
    if ((await readHealth(baseUrl)) === null) {
      return true;
    }
    await delay(HEALTH_POLL_DELAY_MS);
  }
  return (await readHealth(baseUrl)) === null;
}

async function requestRuntimeShutdown(
  baseUrl: string,
  authToken: string,
): Promise<boolean> {
  try {
    const response = await http.fetchRaw(`${baseUrl}/api/runtime/shutdown`, {
      method: "POST",
      timeout: 5_000,
      headers: authHeaders(authToken),
    });
    await response.text();
    return response.ok;
  } catch {
    return false;
  }
}

function spawnRuntimeHost(authToken: string): void {
  const platform = getPlatform();
  const env = {
    ...platform.env.toObject(),
    HLVM_AUTH_TOKEN: authToken,
    // Increase V8 heap limit for the runtime server.
    // Background delegates run in-process and each holds LLM context + tool
    // schemas, which can exceed the default ~1.7 GB heap with 2+ concurrent
    // delegates.
    DENO_V8_FLAGS: [
      platform.env.get("DENO_V8_FLAGS"),
      "--max-old-space-size=4096",
    ].filter(Boolean).join(","),
  };
  const process = platform.command.run({
    cmd: buildRuntimeServeCommand(),
    env,
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });
  process.unref?.();
}

function getRuntimeStartLockPath(): string {
  const platform = getPlatform();
  return platform.path.join(
    platform.env.get("TMPDIR") ?? "/tmp",
    `hlvm-runtime-host-start-${resolveHlvmRuntimePort()}.lock`,
  );
}

export function __testOnlyGetRuntimeStartLockPath(): string {
  return getRuntimeStartLockPath();
}

async function tryAcquireRuntimeStartLock(): Promise<boolean> {
  const platform = getPlatform();
  const lockPath = getRuntimeStartLockPath();

  try {
    await platform.fs.mkdir(lockPath);
    return true;
  } catch {
    try {
      const info = await platform.fs.stat(lockPath);
      const modifiedAt = typeof info.mtimeMs === "number"
        ? info.mtimeMs
        : undefined;
      if (
        modifiedAt !== undefined &&
        Date.now() - modifiedAt > RUNTIME_START_LOCK_STALE_MS
      ) {
        await platform.fs.remove(lockPath, { recursive: true });
        await platform.fs.mkdir(lockPath);
        return true;
      }
    } catch {
      // Another process may have released or recreated the lock meanwhile.
    }
    return false;
  }
}

async function releaseRuntimeStartLock(): Promise<void> {
  try {
    await getPlatform().fs.remove(getRuntimeStartLockPath(), {
      recursive: true,
    });
  } catch {
    // Best-effort cleanup only.
  }
}

async function ensureRuntimeHost(): Promise<{
  baseUrl: string;
  authToken: string;
}> {
  const baseUrl = getHlvmRuntimeBaseUrl();
  const identity = await getRuntimeHostIdentity();
  const attachCompatibleHost = async (attempts = HEALTH_POLL_ATTEMPTS) => {
    const attached = await waitForRuntimeHost(
      baseUrl,
      (health) => matchesRuntimeHostIdentity(health, identity.buildId),
      attempts,
    );
    return attached?.authToken
      ? { baseUrl, authToken: attached.authToken }
      : null;
  };

  const attached = await readHealth(baseUrl);
  if (
    attached?.status === "ok" && attached.authToken &&
    matchesRuntimeHostIdentity(attached, identity.buildId)
  ) {
    return { baseUrl, authToken: attached.authToken };
  }

  let acquiredLock = await tryAcquireRuntimeStartLock();
  if (!acquiredLock) {
    for (let i = 0; i < RUNTIME_START_LOCK_WAIT_ATTEMPTS; i++) {
      const waitingAttachment = await attachCompatibleHost(1);
      if (waitingAttachment) {
        return waitingAttachment;
      }
      acquiredLock = await tryAcquireRuntimeStartLock();
      if (acquiredLock) {
        break;
      }
      await delay(HEALTH_POLL_DELAY_MS);
    }

    if (!acquiredLock) {
      const waitedAttachment = await attachCompatibleHost(
        HEALTH_POLL_ATTEMPTS * 4,
      );
      if (waitedAttachment) {
        return waitedAttachment;
      }
      throw createRuntimeHostError(
        "Failed to start a matching local HLVM runtime host. Restart HLVM and try again.",
      );
    }
  }

  try {
    const reattached = await readHealth(baseUrl);
    if (
      reattached?.status === "ok" && reattached.authToken &&
      matchesRuntimeHostIdentity(reattached, identity.buildId)
    ) {
      return { baseUrl, authToken: reattached.authToken };
    }
    if (
      reattached?.status === "ok" && reattached.authToken &&
      !matchesRuntimeHostIdentity(reattached, identity.buildId)
    ) {
      const shutdownRequested = await requestRuntimeShutdown(
        baseUrl,
        reattached.authToken,
      );
      if (shutdownRequested) {
        const stopped = await waitForRuntimeShutdown(baseUrl);
        if (!stopped) {
          throw createRuntimeHostError(
            "Failed to replace the stale local HLVM runtime host.",
          );
        }
      }
    }

    const authToken = crypto.randomUUID();
    spawnRuntimeHost(authToken);

    const started = await waitForRuntimeHost(
      baseUrl,
      (health) =>
        health.authToken === authToken &&
        matchesRuntimeHostIdentity(health, identity.buildId),
      HEALTH_POLL_ATTEMPTS * 4,
    );
    if (
      started?.authToken &&
      matchesRuntimeHostIdentity(started, identity.buildId)
    ) {
      return { baseUrl, authToken: started.authToken };
    }

    const compatibleAttached = await attachCompatibleHost(
      HEALTH_POLL_ATTEMPTS * 4,
    );
    if (compatibleAttached) {
      return compatibleAttached;
    }

    throw createRuntimeHostError(
      "Failed to start a matching local HLVM runtime host. Restart HLVM and try again.",
    );
  } finally {
    await releaseRuntimeStartLock();
  }
}

async function ensureRuntimeAiReady(): Promise<{
  baseUrl: string;
  authToken: string;
}> {
  const runtime = await ensureRuntimeHost();
  const health = await waitForHealthyRuntime(runtime.baseUrl);
  if (!health?.authToken) {
    throw createRuntimeHostError(
      "Failed to start or attach to the local HLVM runtime host.",
    );
  }
  if (!health.aiReady) {
    throw createRuntimeHostError(
      "Local HLVM runtime host is not ready for AI requests.",
    );
  }
  return {
    baseUrl: runtime.baseUrl,
    authToken: health.authToken,
  };
}

export async function ensureRuntimeHostReady(): Promise<void> {
  await ensureRuntimeAiReady();
}

function createSessionId(skipSessionHistory: boolean): string {
  if (skipSessionHistory) {
    return `fresh:${crypto.randomUUID()}`;
  }
  return deriveDefaultSessionKey();
}

function toAgentUiEvent(event: ChatStreamEvent): AgentUIEvent | null {
  switch (event.event) {
    case "thinking":
      return { type: "thinking", iteration: event.iteration };
    case "thinking_update":
      return {
        type: "thinking_update",
        iteration: event.iteration,
        summary: event.summary,
      };
    case "tool_start":
      return {
        type: "tool_start",
        name: event.name,
        argsSummary: event.args_summary,
        toolIndex: event.tool_index,
        toolTotal: event.tool_total,
      };
    case "tool_end":
      return {
        type: "tool_end",
        name: event.name,
        success: event.success,
        content: event.content ?? "",
        summary: event.summary,
        durationMs: event.duration_ms ?? 0,
        argsSummary: event.args_summary,
        meta: event.meta,
      };
    case "delegate_start":
      return {
        type: "delegate_start",
        agent: event.agent,
        task: event.task,
        threadId: event.thread_id,
        nickname: event.nickname,
        childSessionId: event.child_session_id,
      };
    case "delegate_running":
      return {
        type: "delegate_running",
        threadId: event.thread_id,
      };
    case "delegate_end":
      return {
        type: "delegate_end",
        agent: event.agent,
        task: event.task,
        success: event.success,
        summary: event.summary,
        durationMs: event.duration_ms ?? 0,
        error: event.error,
        snapshot: event.snapshot,
        childSessionId: event.child_session_id,
        threadId: event.thread_id,
      };
    case "todo_updated":
      return {
        type: "todo_updated",
        todoState: event.todo_state,
        source: event.source,
      };
    case "team_task_updated":
      return {
        type: "team_task_updated",
        taskId: event.task_id,
        goal: event.goal,
        status: event.status,
        assigneeMemberId: event.assignee_member_id,
      };
    case "team_message":
      return {
        type: "team_message",
        kind: event.kind,
        fromMemberId: event.from_member_id,
        toMemberId: event.to_member_id,
        relatedTaskId: event.related_task_id,
        contentPreview: event.content_preview,
      };
    case "team_plan_review_required":
      return {
        type: "team_plan_review_required",
        approvalId: event.approval_id,
        taskId: event.task_id,
        submittedByMemberId: event.submitted_by_member_id,
      };
    case "team_plan_review_resolved":
      return {
        type: "team_plan_review_resolved",
        approvalId: event.approval_id,
        taskId: event.task_id,
        submittedByMemberId: event.submitted_by_member_id,
        approved: event.approved,
        reviewedByMemberId: event.reviewed_by_member_id,
      };
    case "team_shutdown_requested":
      return {
        type: "team_shutdown_requested",
        requestId: event.request_id,
        memberId: event.member_id,
        requestedByMemberId: event.requested_by_member_id,
        reason: event.reason,
      };
    case "team_shutdown_resolved":
      return {
        type: "team_shutdown_resolved",
        requestId: event.request_id,
        memberId: event.member_id,
        requestedByMemberId: event.requested_by_member_id,
        status: event.status,
      };
    case "batch_progress_updated":
      return {
        type: "batch_progress_updated",
        snapshot: event.snapshot,
      };
    case "plan_created":
      return {
        type: "plan_created",
        plan: event.plan,
      };
    case "plan_step":
      return {
        type: "plan_step",
        stepId: event.step_id,
        index: event.index,
        completed: event.completed,
      };
    case "plan_review_required":
      return {
        type: "plan_review_required",
        plan: event.plan,
      };
    case "plan_review_resolved":
      return {
        type: "plan_review_resolved",
        plan: event.plan,
        approved: event.approved,
      };
    case "checkpoint_created":
      return {
        type: "checkpoint_created",
        checkpoint: event.checkpoint,
      };
    case "checkpoint_restored":
      return {
        type: "checkpoint_restored",
        checkpoint: event.checkpoint,
        restoredFileCount: event.restored_file_count,
      };
    case "turn_stats":
      return {
        type: "turn_stats",
        iteration: event.iteration,
        toolCount: event.tool_count,
        durationMs: event.duration_ms ?? 0,
      };
    default:
      return null;
  }
}

async function respondToInteraction(
  baseUrl: string,
  authToken: string,
  response: InteractionResponseRequest,
): Promise<void> {
  const result = await http.fetchRaw(`${baseUrl}/api/chat/interaction`, {
    method: "POST",
    timeout: 5_000,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(authToken),
    },
    body: JSON.stringify(response),
  });
  try {
    if (!result.ok) {
      throw createRuntimeHostError(
        "Failed to submit interaction response to runtime host.",
      );
    }
    await result.text();
  } finally {
    // Fully consume the response to avoid dangling local test-server bodies.
  }
}

async function parseErrorResponse(response: Response): Promise<never> {
  let message = `Runtime host request failed with HTTP ${response.status}`;
  try {
    const json = await response.json() as { error?: string };
    if (json.error) message = json.error;
  } catch {
    // Ignore invalid JSON bodies; use the default message.
  }
  throw createRuntimeHostError(message);
}

async function fetchRuntimeJson<T>(
  path: string,
  options: { requireAiReady?: boolean } = {},
): Promise<T> {
  const { baseUrl, authToken } = options.requireAiReady
    ? await ensureRuntimeAiReady()
    : await ensureRuntimeHost();
  return await http.get<T>(`${baseUrl}${path}`, {
    timeout: 5_000,
    headers: authHeaders(authToken),
  });
}

async function fetchRuntimeRaw(
  path: string,
  options?: RequestInit & {
    timeout?: number;
    signal?: AbortSignal;
    requireAiReady?: boolean;
  },
): Promise<Response> {
  const { requireAiReady = false, ...requestOptions } = options ?? {};
  const { baseUrl, authToken } = requireAiReady
    ? await ensureRuntimeAiReady()
    : await ensureRuntimeHost();
  return await http.fetchRaw(`${baseUrl}${path}`, {
    ...requestOptions,
    timeout: requestOptions.timeout ?? 5_000,
    headers: {
      ...(requestOptions.headers instanceof Headers
        ? Object.fromEntries(requestOptions.headers.entries())
        : (requestOptions.headers as Record<string, string> | undefined)),
      ...authHeaders(authToken),
    },
  });
}

function cloneMessagesWithCurrentTurn(
  messages: ChatRequestMessage[],
): {
  messages: ChatRequestMessage[];
  clientTurnId: string;
} {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  const clientTurnId = lastUserIndex >= 0
    ? messages[lastUserIndex]?.client_turn_id ?? crypto.randomUUID()
    : crypto.randomUUID();

  if (lastUserIndex < 0 || messages[lastUserIndex]?.client_turn_id) {
    return { messages, clientTurnId };
  }

  return {
    clientTurnId,
    messages: messages.map((message, index) =>
      index === lastUserIndex
        ? { ...message, client_turn_id: clientTurnId }
        : message
    ),
  };
}

export async function listRuntimeSessions(): Promise<RuntimeSession[]> {
  const response = await fetchRuntimeJson<RuntimeSessionsResponse>(
    "/api/sessions",
  );
  return response.sessions;
}

export async function createRuntimeSession(
  input: { id?: string; title?: string } = {},
): Promise<RuntimeSession> {
  const response = await fetchRuntimeRaw("/api/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  return await response.json() as RuntimeSession;
}

export async function getRuntimeSession(
  sessionId: string,
): Promise<RuntimeSession | null> {
  const { baseUrl, authToken } = await ensureRuntimeHost();
  const response = await http.fetchRaw(
    `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      timeout: 5_000,
      headers: authHeaders(authToken),
    },
  );

  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  return await response.json() as RuntimeSession;
}

export async function deleteRuntimeSession(
  sessionId: string,
): Promise<boolean> {
  const response = await fetchRuntimeRaw(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "DELETE",
    },
  );

  if (response.status === 404) {
    await response.body?.cancel();
    return false;
  }

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  const result = await response.json() as { deleted?: boolean };
  return result.deleted === true;
}

export async function addRuntimeSessionMessage(
  sessionId: string,
  input: RuntimeSessionMessageInput,
): Promise<RuntimeSessionMessage> {
  const response = await fetchRuntimeRaw(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  return await response.json() as RuntimeSessionMessage;
}

export async function listRuntimeSessionMessages(
  sessionId: string,
): Promise<RuntimeSessionMessage[]> {
  const messages: RuntimeSessionMessage[] = [];
  let offset = 0;
  const limit = 200;

  while (true) {
    const response = await fetchRuntimeRaw(
      `/api/sessions/${
        encodeURIComponent(sessionId)
      }/messages?limit=${limit}&offset=${offset}&sort=asc`,
    );

    if (response.status === 404) {
      await response.body?.cancel();
      return [];
    }

    if (!response.ok) {
      await parseErrorResponse(response);
    }

    const page = await response.json() as RuntimeSessionMessagesResponse;
    messages.push(...page.messages);
    if (!page.has_more || page.messages.length === 0) break;
    offset += page.messages.length;
  }

  return messages;
}

export async function verifyRuntimeModelAccess(
  modelId: string,
): Promise<boolean> {
  const response = await fetchRuntimeRaw("/api/models/verify-access", {
    method: "POST",
    requireAiReady: true,
    timeout: 10_000,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: modelId }),
  });

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  const result = await response.json() as { available?: boolean };
  return result.available === true;
}

export async function getRuntimeProviderStatus(
  providerName?: string,
): Promise<ProviderStatus> {
  const response = await fetchRuntimeJson<
    { providers?: Record<string, ProviderStatus> }
  >(
    "/api/models/status",
    { requireAiReady: true },
  );

  if (!providerName) {
    return response.providers?.ollama ?? { available: false };
  }

  return response.providers?.[providerName] ?? {
    available: false,
    error: `Provider not registered: ${providerName}`,
  };
}

export async function listRuntimeInstalledModels(
  provider = "ollama",
): Promise<ModelInfo[]> {
  const response = await fetchRuntimeJson<{ models: ModelInfo[] }>(
    `/api/models/installed?provider=${encodeURIComponent(provider)}`,
    { requireAiReady: true },
  );
  return response.models;
}

export async function getRuntimeModelDiscovery(
  options: { refresh?: boolean } = {},
): Promise<RuntimeModelDiscoveryResponse> {
  const query = options.refresh ? "?refresh=true" : "";
  return await fetchRuntimeJson<RuntimeModelDiscoveryResponse>(
    `/api/models/discovery${query}`,
    { requireAiReady: true },
  );
}

export async function getRuntimeModel(
  name: string,
  provider = "ollama",
): Promise<ModelInfo | null> {
  const response = await fetchRuntimeRaw(
    `/api/models/${encodeURIComponent(provider)}/${encodeURIComponent(name)}`,
    { requireAiReady: true },
  );

  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  return await response.json() as ModelInfo;
}

export async function deleteRuntimeModel(
  name: string,
  provider = "ollama",
): Promise<boolean> {
  const response = await fetchRuntimeRaw(
    `/api/models/${encodeURIComponent(provider)}/${encodeURIComponent(name)}`,
    {
      method: "DELETE",
      requireAiReady: true,
    },
  );

  if (response.status === 404) {
    await response.body?.cancel();
    return false;
  }

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  const result = await response.json() as { deleted?: boolean };
  return result.deleted === true;
}

export async function* pullRuntimeModelViaHost(
  name: string,
  provider?: string,
  signal?: AbortSignal,
): AsyncGenerator<PullProgress, void, unknown> {
  const response = await fetchRuntimeRaw("/api/models/pull", {
    method: "POST",
    requireAiReady: true,
    timeout: STREAM_TIMEOUT_MS,
    signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, provider }),
  });

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw createRuntimeHostError("Runtime host returned no model pull stream.");
  }

  const decoder = new TextDecoder();
  let pending = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = pending.slice(0, newlineIndex).trim();
        pending = pending.slice(newlineIndex + 1);
        if (line.length > 0) {
          const event = JSON.parse(line) as RuntimeModelPullStreamEvent;
          if (event.event === "progress") {
            const { event: _kind, ...progress } = event;
            yield progress;
          } else if (event.event === "error") {
            throw createRuntimeHostError(event.message);
          }
        }
        newlineIndex = pending.indexOf("\n");
      }
    }

    const trailing = pending.trim();
    if (trailing.length > 0) {
      const event = JSON.parse(trailing) as RuntimeModelPullStreamEvent;
      if (event.event === "progress") {
        const { event: _kind, ...progress } = event;
        yield progress;
      } else if (event.event === "error") {
        throw createRuntimeHostError(event.message);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function getRuntimeConfig(): Promise<HlvmConfig> {
  return await fetchRuntimeJson<HlvmConfig>("/api/config");
}

export async function patchRuntimeConfig(
  updates: Partial<Record<ConfigKey, unknown>>,
): Promise<HlvmConfig> {
  const response = await fetchRuntimeRaw("/api/config", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  return await response.json() as HlvmConfig;
}

export async function setRuntimeConfigKey(
  key: ConfigKey,
  value: unknown,
): Promise<void> {
  await patchRuntimeConfig({ [key]: value });
}

export async function resetRuntimeConfig(): Promise<HlvmConfig> {
  const response = await fetchRuntimeRaw("/api/config/reset", {
    method: "POST",
  });

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  return await response.json() as HlvmConfig;
}

export async function reloadRuntimeConfig(): Promise<HlvmConfig> {
  const response = await fetchRuntimeRaw("/api/config/reload", {
    method: "POST",
  });

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  return await response.json() as HlvmConfig;
}

export function getRuntimeConfigApi(): RuntimeConfigApi {
  return {
    set: (key, value) => setRuntimeConfigKey(key as ConfigKey, value),
    patch: (updates) => patchRuntimeConfig(updates),
    reset: () => resetRuntimeConfig(),
    reload: () => reloadRuntimeConfig(),
    get all() {
      return getRuntimeConfig();
    },
  };
}

export async function runRuntimeOllamaSignin(): Promise<
  RuntimeOllamaSigninResponse
> {
  const response = await fetchRuntimeRaw("/api/providers/ollama/signin", {
    method: "POST",
    timeout: 120_000,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ openBrowser: true }),
  });

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  return await response.json() as RuntimeOllamaSigninResponse;
}

export async function listRuntimeMcpServers(): Promise<
  RuntimeMcpServerDescriptor[]
> {
  const response = await fetchRuntimeJson<RuntimeMcpListResponse>(
    "/api/mcp/servers",
  );
  return response.servers;
}

export async function addRuntimeMcpServer(input: {
  server: RuntimeMcpServerInput;
}): Promise<void> {
  const response = await fetchRuntimeRaw("/api/mcp/servers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  await response.text();
}

export async function removeRuntimeMcpServer(input: {
  name: string;
}): Promise<RuntimeMcpRemoveResponse> {
  const response = await fetchRuntimeRaw("/api/mcp/servers", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  return await response.json() as RuntimeMcpRemoveResponse;
}

export async function loginRuntimeMcpServer(input: {
  name: string;
}): Promise<RuntimeMcpOauthResponse> {
  const response = await fetchRuntimeRaw("/api/mcp/oauth/login", {
    method: "POST",
    timeout: 135_000,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  return await response.json() as RuntimeMcpOauthResponse;
}

export async function logoutRuntimeMcpServer(input: {
  name: string;
}): Promise<RuntimeMcpOauthResponse> {
  const response = await fetchRuntimeRaw("/api/mcp/oauth/logout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  return await response.json() as RuntimeMcpOauthResponse;
}

export async function runChatViaHost(
  options: HostBackedChatOptions,
): Promise<HostBackedChatResult> {
  const callbacks = options.callbacks ?? {};
  const { baseUrl, authToken } = options.fixturePath
    ? await ensureRuntimeHost()
    : await ensureRuntimeAiReady();
  const { messages, clientTurnId } = cloneMessagesWithCurrentTurn(
    options.messages,
  );
  const request: ChatRequest = {
    mode: options.mode,
    session_id: options.sessionId,
    messages,
    client_turn_id: clientTurnId,
    assistant_client_turn_id: crypto.randomUUID(),
    expected_version: options.expectedVersion,
    model: options.model,
    fixture_path: options.fixturePath,
    context_window: options.contextWindow,
    permission_mode: options.permissionMode,
    skip_session_history: options.skipSessionHistory,
    disable_persistent_memory: options.disablePersistentMemory,
    history_context: options.historyContext,
    tool_denylist: options.toolDenylist,
    trace: !!callbacks.onTrace,
  };

  const response = await http.fetchRaw(`${baseUrl}/api/chat`, {
    method: "POST",
    timeout: STREAM_TIMEOUT_MS,
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(authToken),
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  const requestId = response.headers.get("X-Request-ID") ?? crypto.randomUUID();
  const cancel = async () => {
    try {
      const cancelResponse = await http.fetchRaw(`${baseUrl}/api/chat/cancel`, {
        method: "POST",
        timeout: 2_000,
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(authToken),
        },
        body: JSON.stringify({ request_id: requestId }),
      });
      await cancelResponse.text();
    } catch {
      // Best-effort cancellation only.
    }
  };

  options.signal?.addEventListener("abort", () => {
    void cancel();
  }, { once: true });

  const reader = response.body?.getReader();
  if (!reader) {
    throw createRuntimeHostError("Runtime host returned no response stream.");
  }

  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let stats = defaultChatStats();
  let sessionVersion = 0;
  let duplicateMessage: unknown;

  const handleEvent = async (event: ChatStreamEvent): Promise<void> => {
    switch (event.event) {
      case "token":
        text += event.text;
        callbacks.onToken?.(event.text);
        return;
      case "interaction_request": {
        const interaction = options.onInteraction
          ? await options.onInteraction({
            requestId: event.request_id,
            mode: event.mode,
            toolName: event.tool_name,
            toolArgs: event.tool_args,
            question: event.question,
          })
          : { approved: false };
        await respondToInteraction(baseUrl, authToken, {
          request_id: event.request_id,
          approved: interaction.approved,
          remember_choice: interaction.rememberChoice,
          user_input: interaction.userInput,
        });
        return;
      }
      case "trace":
        callbacks.onTrace?.(event.trace);
        return;
      case "final_response_meta":
        callbacks.onFinalResponseMeta?.(event.meta);
        return;
      case "result_stats":
        stats = event.stats;
        return;
      case "duplicate":
        duplicateMessage = event.message;
        return;
      case "complete":
        sessionVersion = event.session_version;
        return;
      case "error":
        throw createRuntimeHostError(event.message);
      case "cancelled":
        throw createRuntimeHostError("Runtime host request cancelled.");
      case "start":
        return;
      case "heartbeat":
        return;
      default: {
        const uiEvent = toAgentUiEvent(event);
        if (uiEvent) {
          callbacks.onAgentEvent?.(uiEvent);
        }
      }
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = pending.slice(0, newlineIndex).trim();
        pending = pending.slice(newlineIndex + 1);
        if (line.length > 0) {
          const event = JSON.parse(line) as ChatStreamEvent;
          await handleEvent(event);
        }
        newlineIndex = pending.indexOf("\n");
      }
    }

    const trailing = pending.trim();
    if (trailing.length > 0) {
      const event = JSON.parse(trailing) as ChatStreamEvent;
      await handleEvent(event);
    }
  } finally {
    reader.releaseLock();
  }

  return { text, stats, sessionVersion, duplicateMessage };
}

export async function runAgentQueryViaHost(
  options: HostBackedAgentQueryOptions,
): Promise<HostBackedAgentQueryResult> {
  const result = await runChatViaHost({
    mode: "agent",
    sessionId: createSessionId(options.skipSessionHistory === true),
    messages: [{
      role: "user",
      content: options.query,
      image_paths: options.imagePaths,
      client_turn_id: crypto.randomUUID(),
    }],
    model: options.model,
    fixturePath: options.fixturePath,
    contextWindow: options.contextWindow,
    permissionMode: options.permissionMode,
    skipSessionHistory: options.skipSessionHistory,
    disablePersistentMemory: options.disablePersistentMemory,
    historyContext: options.historyContext,
    toolDenylist: options.toolDenylist,
    signal: options.signal,
    callbacks: options.callbacks,
    onInteraction: options.onInteraction,
  });

  return {
    text: result.text,
    stats: result.stats,
  };
}

export async function runDirectChatViaHost(
  options: HostBackedDirectChatOptions,
): Promise<HostBackedChatResult> {
  return await runChatViaHost({
    mode: "chat",
    sessionId: options.sessionId,
    messages: [{
      role: "user",
      content: options.query,
      image_paths: options.imagePaths,
      client_turn_id: crypto.randomUUID(),
    }],
    model: options.model,
    expectedVersion: options.expectedVersion,
    signal: options.signal,
    callbacks: options.callbacks,
  });
}
