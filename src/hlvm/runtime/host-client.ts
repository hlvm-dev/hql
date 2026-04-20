import { delay } from "@std/async";
import { http } from "../../common/http-client.ts";
import {
  HTTP_STATUS,
  isClientError,
  isServerError,
} from "../../common/http-status.ts";
import { releaseDirLock, tryAcquireDirLock } from "../../common/dir-lock.ts";
import { RuntimeError } from "../../common/error.ts";
import { getErrorMessage } from "../../common/utils.ts";
import {
  HLVMErrorCode,
  parseErrorCodeFromMessage,
  type UnifiedErrorCode,
} from "../../common/error-codes.ts";
import { getPlatform } from "../../platform/platform.ts";
import {
  type ConfigKey,
  type HlvmConfig,
} from "../../common/config/types.ts";
import type {
  AgentUIEvent,
  FinalResponseMeta,
  TraceEvent,
} from "../agent/orchestrator.ts";
import {
  AgentStreamError,
  CancellationError,
  type ErrorClass,
} from "../agent/error-taxonomy.ts";
import type { AgentExecutionMode } from "../agent/execution-mode.ts";
import type { InteractionOption } from "../agent/registry.ts";
import { formatStructuredResultText } from "../agent/structured-output.ts";
import type { BackgroundAgentSnapshot } from "../agent/tools/agent-types.ts";
import {
  getHlvmRuntimeBaseUrl,
  hasExplicitRuntimePortOverride,
  resolveHlvmRuntimePort,
  setCachedRuntimeBaseUrl,
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
import type { AttachmentRecord } from "../attachments/types.ts";
import {
  areRuntimeHostBuildIdsCompatible,
  buildRuntimeServeCommand,
  getRuntimeHostIdentity,
  isRuntimeHostSourceMode,
  type RuntimeHostIdentity,
} from "./host-identity.ts";
import {
  findListeningPidForPort,
  getProcessCommand,
  terminateProcess,
} from "./port-process.ts";
import {
  buildTraceTextPreview,
  summarizeTraceEvent,
  traceReplMainThreadForSource,
} from "../repl-main-thread-trace.ts";

const STREAM_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const HEALTH_POLL_ATTEMPTS = 60;
const AI_READY_POLL_ATTEMPTS = 600;
const HEALTH_POLL_DELAY_MS = 100;
const RUNTIME_CHAT_WARMUP_GRACE_MS = 20_000;
const RUNTIME_CHAT_WARMUP_RETRY_DELAY_MS = 1_000;
const RUNTIME_SHUTDOWN_POLL_ATTEMPTS = 30;
const RUNTIME_START_LOCK_WAIT_ATTEMPTS = 120;
const RUNTIME_START_LOCK_STALE_MS = 30_000;
const STALE_PENDING_RUNTIME_HOST_MS = 90_000;
const GENERIC_RUNTIME_AI_READY_REASON = "AI runtime is still initializing.";

function parseNdjsonLine<T>(line: string): T {
  try {
    return JSON.parse(line) as T;
  } catch (error) {
    throw createRuntimeHostError(
      "Failed to parse runtime host stream event",
      error instanceof Error ? error : undefined,
      HLVMErrorCode.STREAM_ERROR,
    );
  }
}

/**
 * Parse newline-delimited JSON from a ReadableStream.
 * Yields one parsed object per line, handling partial chunks and trailing data.
 */
async function* readNdjsonStream<T>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<T, void, unknown> {
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
          yield parseNdjsonLine<T>(line);
        }
        newlineIndex = pending.indexOf("\n");
      }
    }

    const trailing = pending.trim();
    if (trailing.length > 0) {
      yield parseNdjsonLine<T>(trailing);
    }
  } finally {
    reader.releaseLock();
  }
}

interface RuntimeInteractionRequest {
  requestId: string;
  mode: "permission" | "question";
  toolName?: string;
  toolArgs?: string;
  toolInput?: unknown;
  question?: string;
  options?: InteractionOption[];
  sourceLabel?: string;
  sourceThreadId?: string;
}

interface RuntimeInteractionResponse {
  approved?: boolean;
  rememberChoice?: boolean;
  userInput?: string;
}

interface HostBackedChatResult {
  text: string;
  structuredResult?: unknown;
  stats: ChatResultStats;
  sessionVersion: number;
  duplicateMessage?: unknown;
}

interface HostBackedAgentQueryResult {
  text: string;
  structuredResult?: unknown;
  stats: ChatResultStats;
}

const EARLY_STREAM_RETRY_LIMIT = 1;

export interface RuntimeConfigApi {
  set: (key: string, value: unknown) => Promise<void>;
  patch: (updates: Partial<Record<ConfigKey, unknown>>) => Promise<HlvmConfig>;
  reset: () => Promise<HlvmConfig>;
  reload: () => Promise<HlvmConfig>;
  readonly all: Promise<HlvmConfig>;
}

interface HostBackedChatCallbacks {
  onToken?: (text: string) => void;
  onAgentEvent?: (event: AgentUIEvent) => void;
  onTrace?: (event: TraceEvent) => void;
  onFinalResponseMeta?: (meta: FinalResponseMeta) => void;
}

interface HostBackedChatOptions {
  mode: ChatMode;
  querySource?: string;
  requestId?: string;
  stateless?: boolean;
  messages: ChatRequestMessage[];
  model?: string;
  fixturePath?: string;
  /** Internal runtime-host seam used by tests to force short provider outputs. */
  maxTokens?: number;
  contextWindow?: number;
  skipSessionHistory?: boolean;
  disablePersistentMemory?: boolean;
  permissionMode?: AgentExecutionMode;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  maxIterations?: number;
  responseSchema?: Record<string, unknown>;
  expectedVersion?: number;
  signal?: AbortSignal;
  callbacks?: HostBackedChatCallbacks;
  onInteraction?: (
    event: RuntimeInteractionRequest,
  ) => Promise<RuntimeInteractionResponse>;
}

interface HostBackedAgentQueryOptions {
  query: string;
  model: string;
  querySource?: string;
  fixturePath?: string;
  attachmentIds?: string[];
  contextWindow?: number;
  stateless?: boolean;
  disablePersistentMemory?: boolean;
  permissionMode?: AgentExecutionMode;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  maxIterations?: number;
  responseSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  callbacks?: HostBackedChatCallbacks;
  onInteraction?: (
    event: RuntimeInteractionRequest,
  ) => Promise<RuntimeInteractionResponse>;
}

interface HostBackedDirectChatOptions {
  query: string;
  model?: string;
  attachmentIds?: string[];
  expectedVersion?: number;
  signal?: AbortSignal;
  callbacks: Pick<HostBackedChatCallbacks, "onToken">;
}

interface RuntimeHostErrorResponseDetails {
  status: number;
  message: string;
  code: HLVMErrorCode;
  retryable?: boolean;
  aiReadyReason?: string;
  retryAfterMs?: number;
  errorClass?: string;
  hint?: string | null;
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
  overrideCode?: UnifiedErrorCode,
): RuntimeError {
  const parsed = parseErrorCodeFromMessage(message);
  const fallbackCode = overrideCode ?? parsed ?? HLVMErrorCode.REQUEST_FAILED;
  return new RuntimeError(message, {
    code: fallbackCode,
    originalError,
  });
}

function getHostErrorCodeFromStatus(
  status: number,
  fallbackMessage: string,
): HLVMErrorCode {
  if (status === HTTP_STATUS.PAYLOAD_TOO_LARGE) {
    return HLVMErrorCode.REQUEST_TOO_LARGE;
  }
  if (
    status === HTTP_STATUS.REQUEST_TIMEOUT ||
    fallbackMessage.toLowerCase().includes("timeout")
  ) {
    return HLVMErrorCode.TRANSPORT_ERROR;
  }
  if (isClientError(status)) {
    return HLVMErrorCode.REQUEST_REJECTED;
  }
  if (isServerError(status)) {
    return HLVMErrorCode.REQUEST_FAILED;
  }
  return HLVMErrorCode.REQUEST_FAILED;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number.parseInt(value.trim(), 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup only.
  }
}

function rethrowAsRuntimeHostError(error: unknown): never {
  if (error instanceof RuntimeError) {
    throw error;
  }
  throw createRuntimeHostError(
    getErrorMessage(error),
    error instanceof Error ? error : undefined,
    isHostTransportError(error) ? HLVMErrorCode.TRANSPORT_ERROR : undefined,
  );
}

function isRetryableHostChatStreamError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("error reading a body from connection") ||
    message.includes("connection closed before message completed") ||
    message.includes("connection reset") ||
    message.includes("broken pipe") ||
    message.includes("socket hang up") ||
    message.includes("stream closed");
}

function shouldRetryEarlyTransientStreamDrop(
  error: unknown,
  attempt: number,
  sawFirstToken = false,
  sawPlanReview = false,
): boolean {
  return attempt < EARLY_STREAM_RETRY_LIMIT &&
    !sawFirstToken &&
    !sawPlanReview &&
    isRetryableHostChatStreamError(error);
}

function isHostTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  const message = error.message.toLowerCase();
  return message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("connection") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("eai_again") ||
    message.includes("dns");
}

function matchesRuntimeHostIdentity(
  health: HostHealthResponse,
  identity: RuntimeHostIdentity,
): boolean {
  return areRuntimeHostBuildIdsCompatible(identity.buildId, health.buildId);
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

async function waitForRuntimeHost(
  baseUrl: string,
  predicate?: (health: HostHealthResponse) => boolean,
  attempts = HEALTH_POLL_ATTEMPTS,
  requireAiReady = false,
): Promise<HostHealthResponse | null> {
  for (let i = 0; i < attempts; i++) {
    const health = await readHealth(baseUrl);
    if (
      health?.status === "ok" && health.authToken &&
      (!predicate || predicate(health))
    ) {
      if (
        !requireAiReady || health.aiReady ||
        health.aiReadyRetryable === false
      ) {
        return health;
      }
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

function spawnRuntimeHost(
  authToken: string,
  buildId: string,
  port?: number,
): void {
  const platform = getPlatform();
  const env = {
    ...platform.env.toObject(),
    HLVM_AUTH_TOKEN: authToken,
    HLVM_RUNTIME_BUILD_ID: buildId,
    // Increase V8 heap limit for the runtime server.
    // Background agents run in-process and each holds LLM context + tool
    // schemas, which can exceed the default ~1.7 GB heap with 2+ concurrent
    // agents.
    DENO_V8_FLAGS: [
      platform.env.get("DENO_V8_FLAGS"),
      "--max-old-space-size=4096",
    ].filter(Boolean).join(","),
    ...(port !== undefined ? { HLVM_REPL_PORT: String(port) } : {}),
  };
  const process = platform.command.run({
    cmd: buildRuntimeServeCommand(),
    env,
    stdin: "null",
    stdout: "null",
    stderr: "null",
    detached: true,
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

export async function __testOnlyWaitForStaleFallbackHostSweep(): Promise<void> {
  return;
}

async function tryAcquireRuntimeStartLock(): Promise<boolean> {
  return await tryAcquireDirLock(
    getRuntimeStartLockPath(),
    RUNTIME_START_LOCK_STALE_MS,
  );
}

async function releaseRuntimeStartLock(): Promise<void> {
  await releaseDirLock(getRuntimeStartLockPath());
}

function cacheAndReturn(baseUrl: string, authToken: string): {
  baseUrl: string;
  authToken: string;
} {
  setCachedRuntimeBaseUrl(baseUrl);
  return { baseUrl, authToken };
}

function createSourceModeRuntimeIsolationError(): RuntimeError {
  return createRuntimeHostError(
    "Source-mode HLVM will not auto-start or replace the shared runtime " +
      "without HLVM_REPL_PORT. Use ./hlvm for the shared user daemon or set " +
      "HLVM_REPL_PORT for dev/test isolation.",
  );
}

function createRuntimeHostConflictError(port: number): RuntimeError {
  return createRuntimeHostError(
    `A different runtime is already using port ${port}. ` +
      "Stop that runtime or use HLVM_REPL_PORT for dev/test isolation.",
  );
}

function createForeignPortConflictError(port: number): RuntimeError {
  return createRuntimeHostError(
    `Port ${port} is occupied by a non-HLVM process. ` +
      "Stop that process or use HLVM_REPL_PORT for dev/test isolation.",
  );
}

function isKnownRuntimeHostCommand(command: string): boolean {
  const normalized = command.toLowerCase().replaceAll("\\", "/");
  const servesHlvm = /\bhlvm(?:\.exe)?\b/.test(normalized) &&
    /(^|\s)serve(\s|$)/.test(normalized);
  const servesSourceCli = normalized.includes("deno run") &&
    normalized.includes("src/hlvm/cli/cli.ts") &&
    /(^|\s)serve(\s|$)/.test(normalized);
  return servesHlvm || servesSourceCli;
}

async function isKnownRuntimeHostProcess(pid: string): Promise<boolean> {
  const command = await getProcessCommand(pid);
  return !!command && isKnownRuntimeHostCommand(command);
}

async function reclaimKnownRuntimeProcess(
  baseUrl: string,
  pid: string,
): Promise<boolean> {
  if (!await isKnownRuntimeHostProcess(pid)) {
    return false;
  }
  if (!await terminateProcess(pid)) {
    return false;
  }
  await delay(HEALTH_POLL_DELAY_MS);
  return await waitForRuntimeShutdown(baseUrl);
}

async function reclaimIdleIncompatibleRuntimeHost(
  baseUrl: string,
  authToken: string,
  activeRequests?: number,
): Promise<boolean> {
  if ((activeRequests ?? 0) !== 0) {
    return false;
  }
  if (!await requestRuntimeShutdown(baseUrl, authToken)) {
    return false;
  }
  return await waitForRuntimeShutdown(baseUrl);
}

async function reclaimStaleCompatibleRuntimeHost(
  baseUrl: string,
  authToken: string,
  port: number,
): Promise<boolean> {
  if (await requestRuntimeShutdown(baseUrl, authToken)) {
    if (await waitForRuntimeShutdown(baseUrl)) {
      return true;
    }
  }

  const pid = await findListeningPidForPort(port);
  return !!(pid && await terminateProcess(pid) && await waitForRuntimeShutdown(baseUrl));
}

function shouldReclaimStaleCompatibleRuntimeHost(
  health: HostHealthResponse,
): boolean {
  if (health.aiReady) {
    return false;
  }
  if ((health.activeRequests ?? 0) > 0) {
    return false;
  }
  if (health.aiReadyRetryable === false) {
    return false;
  }
  if ((health.uptimeMs ?? 0) < STALE_PENDING_RUNTIME_HOST_MS) {
    return false;
  }
  return (health.aiReadyReason?.trim() || GENERIC_RUNTIME_AI_READY_REASON) ===
    GENERIC_RUNTIME_AI_READY_REASON;
}

async function ensureRuntimeHost(): Promise<{
  baseUrl: string;
  authToken: string;
}> {
  const basePort = resolveHlvmRuntimePort();
  const baseUrl = getHlvmRuntimeBaseUrl();
  const identity = await getRuntimeHostIdentity();
  const sourceModeRequiresIsolation = isRuntimeHostSourceMode() &&
    !hasExplicitRuntimePortOverride();

  const attachCompatibleHost = async (
    url: string,
    attempts = HEALTH_POLL_ATTEMPTS,
  ) => {
    const attached = await waitForRuntimeHost(
      url,
      (health) => matchesRuntimeHostIdentity(health, identity),
      attempts,
    );
    if (!attached?.authToken) {
      return null;
    }
    if (shouldReclaimStaleCompatibleRuntimeHost(attached)) {
      const attachedPort = Number(new URL(url).port || basePort);
      if (
        await reclaimStaleCompatibleRuntimeHost(
          url,
          attached.authToken,
          attachedPort,
        )
      ) {
        return null;
      }
    }
    return cacheAndReturn(url, attached.authToken);
  };

  // Check base port first
  const attached = await readHealth(baseUrl);
  if (
    attached?.status === "ok" && attached.authToken &&
    matchesRuntimeHostIdentity(attached, identity)
  ) {
    if (shouldReclaimStaleCompatibleRuntimeHost(attached)) {
      if (
        await reclaimStaleCompatibleRuntimeHost(
          baseUrl,
          attached.authToken,
          basePort,
        )
      ) {
        return await ensureRuntimeHost();
      }
    }
    return cacheAndReturn(baseUrl, attached.authToken);
  }
  if (sourceModeRequiresIsolation) {
    throw createSourceModeRuntimeIsolationError();
  }

  if (
    attached?.status === "ok" && attached.authToken &&
    !matchesRuntimeHostIdentity(attached, identity)
  ) {
    if (
      await reclaimIdleIncompatibleRuntimeHost(
        baseUrl,
        attached.authToken,
        attached.activeRequests,
      )
    ) {
      return await ensureRuntimeHost();
    }
    throw createRuntimeHostConflictError(basePort);
  }

  const occupiedBasePid = await findListeningPidForPort(basePort);
  if (occupiedBasePid) {
    if (await reclaimKnownRuntimeProcess(baseUrl, occupiedBasePid)) {
      return await ensureRuntimeHost();
    }
    throw createForeignPortConflictError(basePort);
  }

  // Base port is free or no response — proceed with the original startup logic
  let acquiredLock = await tryAcquireRuntimeStartLock();
  if (!acquiredLock) {
    for (let i = 0; i < RUNTIME_START_LOCK_WAIT_ATTEMPTS; i++) {
      const waitingAttachment = await attachCompatibleHost(baseUrl, 1);
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
        baseUrl,
        HEALTH_POLL_ATTEMPTS * 4,
      );
      if (waitedAttachment) {
        return waitedAttachment;
      }
      throw createRuntimeHostError(
        "Failed to start a matching local HLVM runtime host. Restart HLVM and try again.",
        undefined,
        HLVMErrorCode.RUNTIME_IDENTITY_MISMATCH,
      );
    }
  }

  try {
    const reattached = await readHealth(baseUrl);
    if (
      reattached?.status === "ok" && reattached.authToken &&
      matchesRuntimeHostIdentity(reattached, identity)
    ) {
      return cacheAndReturn(baseUrl, reattached.authToken);
    }

    if (
      reattached?.status === "ok" && reattached.authToken &&
      !matchesRuntimeHostIdentity(reattached, identity)
    ) {
      if (
        await reclaimIdleIncompatibleRuntimeHost(
          baseUrl,
          reattached.authToken,
          reattached.activeRequests,
        )
      ) {
        const attachedAfterReclaim = await attachCompatibleHost(baseUrl, 1);
        if (attachedAfterReclaim) {
          return attachedAfterReclaim;
        }
      } else {
        throw createRuntimeHostConflictError(basePort);
      }
    }

    const occupiedPidAfterLock = await findListeningPidForPort(basePort);
    if (occupiedPidAfterLock) {
      if (!await reclaimKnownRuntimeProcess(baseUrl, occupiedPidAfterLock)) {
        throw createForeignPortConflictError(basePort);
      }
    }

    const authToken = crypto.randomUUID();
    spawnRuntimeHost(authToken, identity.buildId);

    const started = await waitForRuntimeHost(
      baseUrl,
      (health) =>
        health.authToken === authToken &&
        matchesRuntimeHostIdentity(health, identity),
      HEALTH_POLL_ATTEMPTS * 4,
    );
    if (
      started?.authToken &&
      matchesRuntimeHostIdentity(started, identity)
    ) {
      return cacheAndReturn(baseUrl, started.authToken);
    }

    const compatibleAttached = await attachCompatibleHost(
      baseUrl,
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
  const health = await waitForRuntimeHost(
    runtime.baseUrl,
    undefined,
    AI_READY_POLL_ATTEMPTS,
    true,
  );
  if (!health?.authToken) {
    throw createRuntimeHostError(
      "Failed to start or attach to the local HLVM runtime host.",
    );
  }
  if (!health.aiReady) {
    const reason = health.aiReadyReason?.trim();
    throw createRuntimeHostError(
      reason
        ? `Local HLVM runtime host is not ready for AI requests: ${reason}`
        : "Local HLVM runtime host is not ready for AI requests.",
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

export async function ensureRuntimeHostAvailable(): Promise<void> {
  await ensureRuntimeHost();
}

export async function getRuntimeHostHealth(): Promise<
  HostHealthResponse | null
> {
  const runtime = await ensureRuntimeHost();
  return await readHealth(runtime.baseUrl);
}

function toAgentUiEvent(event: ChatStreamEvent): AgentUIEvent | null {
  switch (event.event) {
    case "thinking":
      return { type: "thinking", iteration: event.iteration };
    case "reasoning_update":
      return {
        type: "reasoning_update",
        iteration: event.iteration,
        summary: event.summary,
      };
    case "planning_update":
      return {
        type: "planning_update",
        iteration: event.iteration,
        summary: event.summary,
      };
    case "tool_start":
      return {
        type: "tool_start",
        name: event.name,
        toolCallId: event.tool_call_id,
        argsSummary: event.args_summary,
        toolIndex: event.tool_index,
        toolTotal: event.tool_total,
      };
    case "tool_progress":
      return {
        type: "tool_progress",
        name: event.name,
        toolCallId: event.tool_call_id,
        argsSummary: event.args_summary,
        message: event.message,
        tone: event.tone,
        phase: event.phase,
      };
    case "tool_end":
      return {
        type: "tool_end",
        name: event.name,
        toolCallId: event.tool_call_id,
        success: event.success,
        content: event.content ?? "",
        summary: event.summary,
        durationMs: event.duration_ms ?? 0,
        argsSummary: event.args_summary,
        meta: event.meta,
      };
    case "agent_spawn":
      return {
        type: "agent_spawn",
        agentId: event.agent_id,
        agentType: event.agent_type,
        description: event.description,
        isAsync: event.is_async,
      };
    case "agent_progress":
      return {
        type: "agent_progress",
        agentId: event.agent_id,
        agentType: event.agent_type,
        toolUseCount: event.tool_use_count,
        durationMs: event.duration_ms,
        tokenCount: event.token_count,
        lastToolInfo: event.last_tool_info,
      };
    case "agent_complete":
      return {
        type: "agent_complete",
        agentId: event.agent_id,
        agentType: event.agent_type,
        success: event.success,
        cancelled: event.cancelled,
        durationMs: event.duration_ms,
        toolUseCount: event.tool_use_count,
        totalTokens: event.total_tokens,
        resultPreview: event.result_preview,
        transcript: event.transcript,
      };
    case "todo_updated":
      return {
        type: "todo_updated",
        todoState: event.todo_state,
        source: event.source,
      };
    case "plan_phase_changed":
      return {
        type: "plan_phase_changed",
        phase: event.phase,
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
        decision: event.decision,
      };
    case "turn_stats":
      return {
        type: "turn_stats",
        iteration: event.iteration,
        toolCount: event.tool_count,
        durationMs: event.duration_ms ?? 0,
        inputTokens: event.input_tokens,
        outputTokens: event.output_tokens,
        modelId: event.model_id,
        continuedThisTurn: event.continued_this_turn,
        continuationCount: event.continuation_count,
        compactionReason: event.compaction_reason,
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
  if (!result.ok) {
    throw createRuntimeHostError(
      "Failed to submit interaction response to runtime host.",
    );
  }
  // Fully consume the response to avoid dangling local test-server bodies.
  await result.text();
}

function throwRuntimeHostError(
  details: RuntimeHostErrorResponseDetails,
): never {
  if (details.errorClass !== undefined) {
    throw new AgentStreamError(
      details.message,
      details.errorClass as ErrorClass,
      details.retryable ?? false,
      details.hint ?? null,
    );
  }
  const parsedCode = parseErrorCodeFromMessage(details.message);
  throw createRuntimeHostError(
    details.message,
    undefined,
    parsedCode ?? details.code,
  );
}

async function readErrorResponse(
  response: Response,
): Promise<RuntimeHostErrorResponseDetails> {
  let message = `Runtime host request failed with HTTP ${response.status}`;
  let retryable: boolean | undefined;
  let aiReadyReason: string | undefined;
  let errorClass: string | undefined;
  let hint: string | null | undefined;
  try {
    const body = (await response.text()).trim();
    if (body.length > 0) {
      try {
        const json = JSON.parse(body) as {
          error?: unknown;
          message?: unknown;
          retryable?: unknown;
          aiReadyReason?: unknown;
          errorClass?: unknown;
          hint?: unknown;
        };
        if (typeof json.error === "string") {
          message = json.error;
        } else if (typeof json.message === "string") {
          message = json.message;
        } else {
          message = body;
        }
        if (typeof json.retryable === "boolean") {
          retryable = json.retryable;
        }
        if (typeof json.aiReadyReason === "string") {
          aiReadyReason = json.aiReadyReason;
        }
        if (typeof json.errorClass === "string") {
          errorClass = json.errorClass;
        }
        if (typeof json.hint === "string" || json.hint === null) {
          hint = json.hint;
        }
      } catch {
        message = body;
      }
    }
  } catch {
    // Ignore unreadable bodies; use the default message.
  }
  return {
    status: response.status,
    message,
    code: getHostErrorCodeFromStatus(response.status, message),
    retryable,
    aiReadyReason,
    retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After")),
    errorClass,
    hint,
  };
}

function isRetryableRuntimeWarmupResponse(
  details: RuntimeHostErrorResponseDetails,
): boolean {
  if (details.status !== 503 || details.retryable === false) {
    return false;
  }
  const reason = (details.aiReadyReason ?? details.message).trim();
  return reason === GENERIC_RUNTIME_AI_READY_REASON ||
    reason === `${GENERIC_RUNTIME_AI_READY_REASON} Please retry shortly.`;
}

async function parseErrorResponse(response: Response): Promise<never> {
  throwRuntimeHostError(await readErrorResponse(response));
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

async function fetchRuntimeChecked(
  path: string,
  options?: RequestInit & {
    timeout?: number;
    signal?: AbortSignal;
    requireAiReady?: boolean;
  },
): Promise<Response> {
  const response = await fetchRuntimeRaw(path, options);
  if (!response.ok) await parseErrorResponse(response);
  return response;
}

async function postRuntimeJson<T>(
  path: string,
  body: unknown,
  options?: { requireAiReady?: boolean; timeout?: number },
): Promise<T> {
  const response = await fetchRuntimeChecked(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...options,
  });
  return await response.json() as T;
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

export async function verifyRuntimeModelAccess(
  modelId: string,
): Promise<boolean> {
  const result = await postRuntimeJson<{ available?: boolean }>(
    "/api/models/verify-access",
    { model: modelId },
    { requireAiReady: true, timeout: 10_000 },
  );
  return result.available === true;
}

export async function listRuntimeBackgroundAgents(): Promise<
  BackgroundAgentSnapshot[]
> {
  const response = await fetchRuntimeJson<{ agents?: BackgroundAgentSnapshot[] }>(
    "/api/background-agents",
  );
  return response.agents ?? [];
}

export async function cancelRuntimeBackgroundAgent(
  agentId: string,
): Promise<boolean> {
  const response = await postRuntimeJson<{ cancelled?: boolean }>(
    "/api/background-agents/cancel",
    { agent_id: agentId },
  );
  return response.cancelled === true;
}

export async function getRuntimeProviderStatus(
  providerName?: string,
): Promise<ProviderStatus> {
  const response = await fetchRuntimeJson<
    { providers?: Record<string, ProviderStatus> }
  >("/api/models/status");

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
  );
  return response.models;
}

export async function getRuntimeModelDiscovery(
  options: { refresh?: boolean } = {},
): Promise<RuntimeModelDiscoveryResponse> {
  const query = options.refresh ? "?refresh=true" : "";
  return await fetchRuntimeJson<RuntimeModelDiscoveryResponse>(
    `/api/models/discovery${query}`,
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

  if (!response.ok) await parseErrorResponse(response);

  return await response.json() as ModelInfo;
}

export async function deleteRuntimeModel(
  name: string,
  provider = "ollama",
): Promise<boolean> {
  const response = await fetchRuntimeRaw(
    `/api/models/${encodeURIComponent(provider)}/${encodeURIComponent(name)}`,
    { method: "DELETE", requireAiReady: true },
  );

  if (response.status === 404) {
    await response.body?.cancel();
    return false;
  }

  if (!response.ok) await parseErrorResponse(response);

  const result = await response.json() as { deleted?: boolean };
  return result.deleted === true;
}

export async function registerRuntimeAttachmentPath(
  filePath: string,
): Promise<AttachmentRecord> {
  return await postRuntimeJson<AttachmentRecord>("/api/attachments/register", {
    path: filePath,
  });
}

export async function uploadRuntimeAttachment(
  fileName: string,
  bytes: Uint8Array,
  options?: {
    mimeType?: string;
    sourcePath?: string;
  },
): Promise<AttachmentRecord> {
  const file = new File([bytes as Uint8Array<ArrayBuffer>], fileName, {
    type: options?.mimeType ?? "application/octet-stream",
  });
  const form = new FormData();
  form.append("file", file);
  if (options?.sourcePath) {
    form.append("source_path", options.sourcePath);
  }

  const response = await fetchRuntimeChecked("/api/attachments/upload", {
    method: "POST",
    body: form,
  });
  return await response.json() as AttachmentRecord;
}

export async function getRuntimeAttachment(
  attachmentId: string,
): Promise<AttachmentRecord> {
  const response = await fetchRuntimeChecked(
    `/api/attachments/${encodeURIComponent(attachmentId)}`,
  );
  return await response.json() as AttachmentRecord;
}

export async function* pullRuntimeModelViaHost(
  name: string,
  provider?: string,
  signal?: AbortSignal,
): AsyncGenerator<PullProgress, void, unknown> {
  const response = await fetchRuntimeChecked("/api/models/pull", {
    method: "POST",
    requireAiReady: true,
    timeout: STREAM_TIMEOUT_MS,
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, provider }),
  });

  const stream = response.body;
  const reader = stream?.getReader();
  if (!reader) {
    throw createRuntimeHostError("Runtime host returned no model pull stream.");
  }

  try {
    for await (
      const event of readNdjsonStream<RuntimeModelPullStreamEvent>(reader)
    ) {
      if (event.event === "progress") {
        const { event: _kind, ...progress } = event;
        yield progress;
      } else if (event.event === "error") {
        throw new AgentStreamError(
          event.message,
          (event.errorClass ?? "unknown") as ErrorClass,
          event.retryable ?? false,
          event.hint ?? null,
        );
      }
    }
  } finally {
    if (stream) {
      await stream.cancel().catch(() => undefined);
    }
  }
}

export async function getRuntimeConfig(): Promise<HlvmConfig> {
  return await fetchRuntimeJson<HlvmConfig>("/api/config");
}

export async function patchRuntimeConfig(
  updates: Partial<Record<ConfigKey, unknown>>,
): Promise<HlvmConfig> {
  const response = await fetchRuntimeChecked("/api/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return await response.json() as HlvmConfig;
}

export async function setRuntimeConfigKey(
  key: ConfigKey,
  value: unknown,
): Promise<void> {
  await patchRuntimeConfig({ [key]: value });
}

export async function resetRuntimeConfig(): Promise<HlvmConfig> {
  const response = await fetchRuntimeChecked("/api/config/reset", {
    method: "POST",
  });
  return await response.json() as HlvmConfig;
}

export async function reloadRuntimeConfig(): Promise<HlvmConfig> {
  const response = await fetchRuntimeChecked("/api/config/reload", {
    method: "POST",
  });
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
  return await postRuntimeJson<RuntimeOllamaSigninResponse>(
    "/api/providers/ollama/signin",
    { openBrowser: true },
    { timeout: 120_000 },
  );
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
  const response = await fetchRuntimeChecked("/api/mcp/servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await response.text();
}

export async function removeRuntimeMcpServer(input: {
  name: string;
}): Promise<RuntimeMcpRemoveResponse> {
  const response = await fetchRuntimeChecked("/api/mcp/servers", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return await response.json() as RuntimeMcpRemoveResponse;
}

export async function loginRuntimeMcpServer(input: {
  name: string;
}): Promise<RuntimeMcpOauthResponse> {
  return await postRuntimeJson<RuntimeMcpOauthResponse>(
    "/api/mcp/oauth/login",
    input,
    { timeout: 135_000 },
  );
}

export async function logoutRuntimeMcpServer(input: {
  name: string;
}): Promise<RuntimeMcpOauthResponse> {
  return await postRuntimeJson<RuntimeMcpOauthResponse>(
    "/api/mcp/oauth/logout",
    input,
  );
}

export async function runChatViaHost(
  options: HostBackedChatOptions,
): Promise<HostBackedChatResult> {
  return await runChatViaHostAttempt(options, 0);
}

async function runChatViaHostAttempt(
  options: HostBackedChatOptions,
  attempt: number,
): Promise<HostBackedChatResult> {
  const callbacks = options.callbacks ?? {};
  const runStartedAt = Date.now();
  const requestId = options.requestId ?? crypto.randomUUID();
  traceReplMainThreadForSource(options.querySource, "client.run_chat.start", {
    requestId,
    attempt,
    mode: options.mode,
    model: options.model ?? null,
    stateless: options.stateless === true,
    messageCount: options.messages.length,
    queryPreview: buildTraceTextPreview(options.messages.at(-1)?.content),
  });
  const runtimeReadyStartedAt = Date.now();
  const { baseUrl, authToken } = options.fixturePath
    ? await ensureRuntimeHost()
    : await ensureRuntimeAiReady();
  traceReplMainThreadForSource(
    options.querySource,
    "client.runtime_ready.done",
    {
      requestId,
      attempt,
      durationMs: Date.now() - runtimeReadyStartedAt,
      baseUrl,
      fixturePath: !!options.fixturePath,
    },
  );
  const { messages, clientTurnId } = cloneMessagesWithCurrentTurn(
    options.messages,
  );
  const request: ChatRequest = {
    mode: options.mode,
    query_source: options.querySource,
    stateless: options.stateless,
    messages,
    client_turn_id: clientTurnId,
    assistant_client_turn_id: crypto.randomUUID(),
    expected_version: options.expectedVersion,
    model: options.model,
    fixture_path: options.fixturePath,
    max_tokens: options.maxTokens,
    context_window: options.contextWindow,
    permission_mode: options.permissionMode,
    skip_session_history: options.skipSessionHistory,
    disable_persistent_memory: options.disablePersistentMemory,
    tool_allowlist: options.toolAllowlist,
    tool_denylist: options.toolDenylist,
    max_iterations: options.maxIterations,
    response_schema: options.responseSchema,
    trace: !!callbacks.onTrace,
  };

  const requestBody = JSON.stringify(request);
  let response: Response;
  const fetchStartedAt = Date.now();
  const warmupRetryDeadline = runStartedAt + RUNTIME_CHAT_WARMUP_GRACE_MS;
  traceReplMainThreadForSource(options.querySource, "client.fetch.start", {
    requestId,
    attempt,
    bodyBytes: requestBody.length,
    traceEnabled: !!callbacks.onTrace,
  });
  while (true) {
    try {
      response = await http.fetchRaw(`${baseUrl}/api/chat`, {
        method: "POST",
        timeout: STREAM_TIMEOUT_MS,
        signal: options.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": requestId,
          ...authHeaders(authToken),
        },
        body: requestBody,
      });
    } catch (error) {
      traceReplMainThreadForSource(options.querySource, "client.fetch.error", {
        requestId,
        attempt,
        durationMs: Date.now() - fetchStartedAt,
        error: getErrorMessage(error),
      });
      if (shouldRetryEarlyTransientStreamDrop(error, attempt)) {
        return await runChatViaHostAttempt(options, attempt + 1);
      }
      rethrowAsRuntimeHostError(error);
    }

    if (response.ok) {
      break;
    }

    const errorDetails = await readErrorResponse(response);
    if (
      isRetryableRuntimeWarmupResponse(errorDetails) &&
      Date.now() < warmupRetryDeadline &&
      !options.signal?.aborted
    ) {
      traceReplMainThreadForSource(
        options.querySource,
        "client.fetch.runtime_warmup_retry",
        {
          requestId,
          attempt,
          durationMs: Date.now() - runStartedAt,
          retryAfterMs: errorDetails.retryAfterMs ??
            RUNTIME_CHAT_WARMUP_RETRY_DELAY_MS,
        },
      );
      await delay(
        errorDetails.retryAfterMs ?? RUNTIME_CHAT_WARMUP_RETRY_DELAY_MS,
      );
      continue;
    }

    throwRuntimeHostError(errorDetails);
  }

  const responseRequestId = response.headers.get("X-Request-ID");
  const effectiveRequestId = responseRequestId || requestId;
  traceReplMainThreadForSource(
    options.querySource,
    "client.fetch.headers",
    {
      requestId: effectiveRequestId,
      attempt,
      status: response.status,
      durationMs: Date.now() - fetchStartedAt,
      responseRequestId,
    },
  );
  const cancel = async () => {
    try {
      const cancelResponse = await http.fetchRaw(`${baseUrl}/api/chat/cancel`, {
        method: "POST",
        timeout: 2_000,
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(authToken),
        },
        body: JSON.stringify({ request_id: effectiveRequestId }),
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

  let text = "";
  let structuredResult: unknown;
  let stats = defaultChatStats();
  let sessionVersion = 0;
  let duplicateMessage: unknown;
  let sawPlanReview = false;
  let sawFirstEvent = false;
  let sawFirstToken = false;

  try {
    for await (const event of readNdjsonStream<ChatStreamEvent>(reader)) {
      if (!sawFirstEvent) {
        sawFirstEvent = true;
        traceReplMainThreadForSource(
          options.querySource,
          "client.stream.first_event",
          {
            requestId: effectiveRequestId,
            attempt,
            event: event.event,
            durationMs: Date.now() - runStartedAt,
          },
        );
      }
      switch (event.event) {
        case "token":
          text += event.text;
          if (!sawFirstToken && event.text.length > 0) {
            sawFirstToken = true;
            traceReplMainThreadForSource(
              options.querySource,
              "client.stream.first_token",
              {
                requestId: effectiveRequestId,
                attempt,
                durationMs: Date.now() - runStartedAt,
                preview: buildTraceTextPreview(event.text, 80),
              },
            );
          }
          callbacks.onToken?.(event.text);
          break;
        case "interaction_request": {
          if (event.tool_name === "plan_review") {
            sawPlanReview = true;
          }
          const interaction = options.onInteraction
            ? await options.onInteraction({
              requestId: event.request_id,
              mode: event.mode,
              toolName: event.tool_name,
              toolArgs: event.tool_args,
              toolInput: event.tool_input,
              question: event.question,
              options: event.options,
              sourceLabel: event.source_label,
              sourceThreadId: event.source_thread_id,
            })
            : { approved: false };
          await respondToInteraction(baseUrl, authToken, {
            request_id: event.request_id,
            approved: interaction.approved,
            remember_choice: interaction.rememberChoice,
            user_input: interaction.userInput,
          });
          break;
        }
        case "trace":
          traceReplMainThreadForSource(
            options.querySource,
            "client.stream.trace",
            {
              requestId: effectiveRequestId,
              attempt,
              durationMs: Date.now() - runStartedAt,
              ...summarizeTraceEvent(event.trace),
            },
          );
          callbacks.onTrace?.(event.trace);
          break;
        case "final_response_meta":
          callbacks.onFinalResponseMeta?.(event.meta);
          break;
        case "result_stats":
          stats = event.stats;
          break;
        case "structured_result":
          structuredResult = event.result;
          text = formatStructuredResultText(event.result);
          break;
        case "duplicate":
          duplicateMessage = event.message;
          break;
        case "complete":
          sessionVersion = event.session_version;
          traceReplMainThreadForSource(
            options.querySource,
            "client.stream.complete_event",
            {
              requestId: effectiveRequestId,
              attempt,
              durationMs: Date.now() - runStartedAt,
              sessionVersion,
            },
          );
          break;
        case "error":
          traceReplMainThreadForSource(
            options.querySource,
            "client.stream.error_event",
            {
              requestId: effectiveRequestId,
              attempt,
              durationMs: Date.now() - runStartedAt,
              message: event.message,
              errorClass: event.errorClass,
              retryable: event.retryable,
            },
          );
          throw new AgentStreamError(
            event.message,
            (event.errorClass ?? "unknown") as ErrorClass,
            event.retryable ?? false,
            event.hint ?? null,
          );
        case "cancelled":
          traceReplMainThreadForSource(
            options.querySource,
            "client.stream.cancelled_event",
            {
              requestId: effectiveRequestId,
              attempt,
              durationMs: Date.now() - runStartedAt,
            },
          );
          throw new CancellationError("Runtime host request cancelled.");
        case "plan_review_required":
        case "plan_review_resolved":
          sawPlanReview = true;
          {
            const uiEvent = toAgentUiEvent(event);
            if (uiEvent) {
              callbacks.onAgentEvent?.(uiEvent);
            }
          }
          break;
        case "start":
          traceReplMainThreadForSource(
            options.querySource,
            "client.stream.start_event",
            {
              requestId: effectiveRequestId,
              attempt,
              durationMs: Date.now() - runStartedAt,
            },
          );
          break;
        case "heartbeat":
          traceReplMainThreadForSource(
            options.querySource,
            "client.stream.heartbeat",
            {
              requestId: effectiveRequestId,
              attempt,
              durationMs: Date.now() - runStartedAt,
            },
          );
          break;
        default: {
          const uiEvent = toAgentUiEvent(event);
          if (uiEvent) {
            callbacks.onAgentEvent?.(uiEvent);
          }
        }
      }
    }
  } catch (error) {
    traceReplMainThreadForSource(options.querySource, "client.run_chat.error", {
      requestId: effectiveRequestId,
      attempt,
      durationMs: Date.now() - runStartedAt,
      error: getErrorMessage(error),
    });
    await cancelResponseBody(response);
    if (
      shouldRetryEarlyTransientStreamDrop(
        error,
        attempt,
        sawFirstToken,
        sawPlanReview,
      )
    ) {
      await cancel();
      return await runChatViaHostAttempt(options, attempt + 1);
    }
    rethrowAsRuntimeHostError(error);
  }

  traceReplMainThreadForSource(options.querySource, "client.run_chat.done", {
    requestId: effectiveRequestId,
    attempt,
    durationMs: Date.now() - runStartedAt,
    textChars: text.length,
    sessionVersion,
    duplicate: duplicateMessage !== undefined,
    sawPlanReview,
  });
  return { text, structuredResult, stats, sessionVersion, duplicateMessage };
}

export async function runAgentQueryViaHost(
  options: HostBackedAgentQueryOptions,
): Promise<HostBackedAgentQueryResult> {
  const result = await runChatViaHost({
    mode: "agent",
    querySource: options.querySource,
    messages: [{
      role: "user",
      content: options.query,
      attachment_ids: options.attachmentIds,
      client_turn_id: crypto.randomUUID(),
    }],
    model: options.model,
    fixturePath: options.fixturePath,
    contextWindow: options.contextWindow,
    stateless: options.stateless,
    permissionMode: options.permissionMode,
    disablePersistentMemory: options.disablePersistentMemory,
    toolAllowlist: options.toolAllowlist,
    toolDenylist: options.toolDenylist,
    maxIterations: options.maxIterations,
    responseSchema: options.responseSchema,
    signal: options.signal,
    callbacks: options.callbacks,
    onInteraction: options.onInteraction,
  });

  return {
    text: result.text,
    structuredResult: result.structuredResult,
    stats: result.stats,
  };
}

export async function runDirectChatViaHost(
  options: HostBackedDirectChatOptions,
): Promise<HostBackedChatResult> {
  return await runChatViaHost({
    mode: "chat",
    messages: [{
      role: "user",
      content: options.query,
      attachment_ids: options.attachmentIds,
      client_turn_id: crypto.randomUUID(),
    }],
    model: options.model,
    expectedVersion: options.expectedVersion,
    signal: options.signal,
    callbacks: options.callbacks,
  });
}
