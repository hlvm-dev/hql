import { http } from "../../common/http-client.ts";
import { RuntimeError } from "../../common/error.ts";
import { getPlatform } from "../../platform/platform.ts";
import type {
  ConfigKey,
  HlvmConfig,
  PermissionMode,
} from "../../common/config/types.ts";
import type {
  AgentUIEvent,
  FinalResponseMeta,
  TraceEvent,
} from "../agent/orchestrator.ts";
import { getHlvmRuntimeBaseUrl } from "./host-config.ts";
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
  type RuntimeSessionsResponse,
} from "./session-protocol.ts";
import { deriveDefaultSessionKey } from "./session-key.ts";
import type {
  PullProgress,
  RuntimeModelDiscoveryResponse,
  RuntimeModelPullStreamEvent,
} from "./model-protocol.ts";
import type { ModelInfo, ProviderStatus } from "../providers/types.ts";

const STREAM_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const HEALTH_POLL_ATTEMPTS = 60;
const HEALTH_POLL_DELAY_MS = 100;

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
  workspace?: string;
  contextWindow?: number;
  skipSessionHistory?: boolean;
  permissionMode?: PermissionMode;
  toolDenylist?: string[];
  expectedVersion?: number;
  signal?: AbortSignal;
  callbacks: HostBackedChatCallbacks;
  onInteraction?: (
    event: RuntimeInteractionRequest,
  ) => Promise<RuntimeInteractionResponse>;
}

export interface HostBackedAgentQueryOptions {
  query: string;
  model: string;
  workspace: string;
  imagePaths?: string[];
  contextWindow?: number;
  skipSessionHistory?: boolean;
  permissionMode?: PermissionMode;
  toolDenylist?: string[];
  signal?: AbortSignal;
  callbacks: HostBackedChatCallbacks;
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

function isDenoExecutable(execPath: string): boolean {
  return /(?:^|\/|\\)deno(?:\.exe)?$/i.test(execPath);
}

function buildServeCommand(): string[] {
  const platform = getPlatform();
  const execPath = platform.process.execPath();
  if (!isDenoExecutable(execPath)) {
    return [execPath, "serve"];
  }

  const cliEntry = platform.path.fromFileUrl(
    new URL("../cli/cli.ts", import.meta.url),
  );
  return [execPath, "run", "-A", cliEntry, "serve"];
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
): Promise<HostHealthResponse | null> {
  for (let i = 0; i < HEALTH_POLL_ATTEMPTS; i++) {
    const health = await readHealth(baseUrl);
    if (health?.status === "ok" && health.authToken) {
      if (health.aiReady) return health;
    }
    await sleep(HEALTH_POLL_DELAY_MS);
  }
  return await readHealth(baseUrl);
}

function spawnRuntimeHost(authToken: string): void {
  const platform = getPlatform();
  const env = {
    ...platform.env.toObject(),
    HLVM_AUTH_TOKEN: authToken,
  };
  const process = platform.command.run({
    cmd: buildServeCommand(),
    env,
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });
  process.unref?.();
}

async function ensureRuntimeHost(): Promise<{
  baseUrl: string;
  authToken: string;
}> {
  const baseUrl = getHlvmRuntimeBaseUrl();
  const attached = await waitForHealthyRuntime(baseUrl);
  if (attached?.status === "ok" && attached.authToken) {
    return { baseUrl, authToken: attached.authToken };
  }

  const authToken = crypto.randomUUID();
  spawnRuntimeHost(authToken);

  const started = await waitForHealthyRuntime(baseUrl);
  if (!started?.authToken) {
    throw new RuntimeError(
      "Failed to start or attach to the local HLVM runtime host.",
    );
  }
  return { baseUrl, authToken: started.authToken };
}

function createSessionId(
  workspace: string,
  model: string,
  skipSessionHistory: boolean,
): string {
  if (skipSessionHistory) {
    return `fresh:${crypto.randomUUID()}`;
  }
  return deriveDefaultSessionKey(workspace, model);
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
      throw new RuntimeError("Failed to submit interaction response to runtime host.");
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
  throw new RuntimeError(message);
}

async function fetchRuntimeJson<T>(
  path: string,
): Promise<T> {
  const { baseUrl, authToken } = await ensureRuntimeHost();
  return await http.get<T>(`${baseUrl}${path}`, {
    timeout: 5_000,
    headers: authHeaders(authToken),
  });
}

async function fetchRuntimeRaw(
  path: string,
  options?: RequestInit & { timeout?: number; signal?: AbortSignal },
): Promise<Response> {
  const { baseUrl, authToken } = await ensureRuntimeHost();
  return await http.fetchRaw(`${baseUrl}${path}`, {
    ...options,
    timeout: options?.timeout ?? 5_000,
    headers: {
      ...(options?.headers instanceof Headers
        ? Object.fromEntries(options.headers.entries())
        : (options?.headers as Record<string, string> | undefined)),
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
  const response = await fetchRuntimeJson<RuntimeSessionsResponse>("/api/sessions");
  return response.sessions;
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

export async function verifyRuntimeModelAccess(
  modelId: string,
): Promise<boolean> {
  const response = await fetchRuntimeRaw("/api/models/verify-access", {
    method: "POST",
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
  const response = await fetchRuntimeJson<{ providers?: Record<string, ProviderStatus> }>(
    "/api/models/status",
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
    throw new RuntimeError("Runtime host returned no model pull stream.");
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
            throw new RuntimeError(event.message);
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
        throw new RuntimeError(event.message);
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

export async function runChatViaHost(
  options: HostBackedChatOptions,
): Promise<HostBackedChatResult> {
  const { baseUrl, authToken } = await ensureRuntimeHost();
  const { messages, clientTurnId } = cloneMessagesWithCurrentTurn(options.messages);
  const request: ChatRequest = {
    mode: options.mode,
    session_id: options.sessionId,
    messages,
    client_turn_id: clientTurnId,
    assistant_client_turn_id: crypto.randomUUID(),
    expected_version: options.expectedVersion,
    model: options.model,
    workspace: options.workspace,
    context_window: options.contextWindow,
    permission_mode: options.permissionMode,
    skip_session_history: options.skipSessionHistory,
    tool_denylist: options.toolDenylist,
    trace: !!options.callbacks.onTrace,
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
    throw new RuntimeError("Runtime host returned no response stream.");
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
        options.callbacks.onToken?.(event.text);
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
        options.callbacks.onTrace?.(event.trace);
        return;
      case "final_response_meta":
        options.callbacks.onFinalResponseMeta?.(event.meta);
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
        throw new RuntimeError(event.message);
      case "cancelled":
        throw new RuntimeError("Runtime host request cancelled.");
      case "start":
        return;
      default: {
        const uiEvent = toAgentUiEvent(event);
        if (uiEvent) {
          options.callbacks.onAgentEvent?.(uiEvent);
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
    sessionId: createSessionId(
      options.workspace,
      options.model,
      options.skipSessionHistory === true,
    ),
    messages: [{
      role: "user",
      content: options.query,
      image_paths: options.imagePaths,
      client_turn_id: crypto.randomUUID(),
    }],
    model: options.model,
    workspace: options.workspace,
    contextWindow: options.contextWindow,
    permissionMode: options.permissionMode,
    skipSessionHistory: options.skipSessionHistory,
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
