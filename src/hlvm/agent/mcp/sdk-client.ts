/**
 * MCP SDK Client Adapter — wraps @modelcontextprotocol/sdk Client with
 * the API surface used by tools.ts and the rest of HLVM.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  auth,
  extractWWWAuthenticateParams,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CancelledNotificationSchema,
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
  LoggingMessageNotificationSchema,
  PingRequestSchema,
  ProgressNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getAgentLogger } from "../logger.ts";
import { getErrorMessage, isObjectValue } from "../../../common/utils.ts";
import { TOOL_CATEGORY, ToolError } from "../error-taxonomy.ts";
import { TOOL_NAMES } from "../tool-names.ts";
import { http } from "../../../common/http-client.ts";
import { sleep } from "../../../common/timeout-utils.ts";
import {
  createMcpOAuthTransportAuthProvider,
  type McpOAuthTransportAuthProvider,
} from "./oauth.ts";
import { capMcpDescription, sanitizeMcpText } from "./text-utils.ts";
import type {
  McpPromptInfo,
  McpPromptMessage,
  McpResourceContent,
  McpResourceInfo,
  McpResourceTemplate,
  McpServerConfig,
  McpToolInfo,
} from "./types.ts";

// Map method strings to SDK schemas for handler registration
// deno-lint-ignore no-explicit-any
const REQUEST_SCHEMAS: Record<string, any> = {
  "sampling/createMessage": CreateMessageRequestSchema,
  "elicitation/create": ElicitRequestSchema,
  "roots/list": ListRootsRequestSchema,
  "ping": PingRequestSchema,
};

// deno-lint-ignore no-explicit-any
const NOTIFICATION_SCHEMAS: Record<string, any> = {
  "notifications/tools/list_changed": ToolListChangedNotificationSchema,
  "notifications/resources/list_changed": ResourceListChangedNotificationSchema,
  "notifications/prompts/list_changed": PromptListChangedNotificationSchema,
  "notifications/message": LoggingMessageNotificationSchema,
  "notifications/progress": ProgressNotificationSchema,
  "notifications/cancelled": CancelledNotificationSchema,
  "notifications/resources/updated": ResourceUpdatedNotificationSchema,
};

// ============================================================
// Fetch Helpers
// ============================================================

/**
 * Wraps the SSOT http client with a per-request timeout. Each call creates a
 * fresh AbortController that fires after `timeoutMs`. If the caller already
 * provides a signal via RequestInit, both signals are composed so either can abort.
 */
function wrapFetchWithTimeout(
  timeoutMs: number,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("MCP HTTP request timeout"), timeoutMs);

    // Compose with caller-provided signal if present
    const callerSignal = init?.signal;
    if (callerSignal?.aborted) {
      clearTimeout(timer);
      controller.abort(callerSignal.reason);
    } else if (callerSignal) {
      callerSignal.addEventListener("abort", () => {
        clearTimeout(timer);
        controller.abort(callerSignal.reason);
      }, { once: true });
    }

    // Use SSOT http.fetchRaw — cast required because SDK passes standard
    // RequestInit but http.fetchRaw expects HttpOptions & RequestInit.
    // deno-lint-ignore no-explicit-any
    return http.fetchRaw(String(input), { ...init, signal: controller.signal, timeout: timeoutMs } as any)
      .finally(() => clearTimeout(timer));
  };
}

const MCP_HTTP_REQUEST_TIMEOUT_MS = 60_000;

function hasExplicitAuthorizationHeader(
  headers: Record<string, string>,
): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
}

// ============================================================
// SdkMcpClient — Adapter wrapping SDK Client
// ============================================================

export class SdkMcpClient {
  private static readonly MAX_PENDING_PER_METHOD = 100;
  private client: Client;
  private readonly serverConfig: McpServerConfig;
  private readonly interactiveAuth: boolean;
  private transport:
    | InstanceType<typeof SSEClientTransport>
    | InstanceType<typeof StdioClientTransport>
    | InstanceType<typeof StreamableHTTPClientTransport>
    | null = null;
  private remoteAuthProvider: McpOAuthTransportAuthProvider | null = null;
  private closed = false;
  private pendingAbortController = new AbortController();
  private readonly requestHandlers = new Map<
    string,
    (params: unknown) => Promise<unknown>
  >();
  private readonly notificationHandlers = new Map<
    string,
    (params: unknown) => void
  >();
  private readonly reconnectListeners = new Set<() => void>();
  private connectionState = {
    connected: false,
    reconnectAttempts: 0,
    terminalErrorCount: 0,
  };

  /**
   * Queue for server-initiated requests that arrive before handlers are
   * registered via onRequest(). The SDK doesn't queue these internally,
   * so we install stub handlers during start() that capture early requests,
   * then replay them when the real handler is wired via onRequest().
   */
  // deno-lint-ignore no-explicit-any
  private pendingRequests = new Map<
    string,
    Array<{ params: unknown; resolve: (v: any) => void; reject: (e: unknown) => void }>
  >();

  constructor(
    serverConfig: McpServerConfig,
    options: { interactiveAuth?: boolean } = {},
  ) {
    this.serverConfig = serverConfig;
    this.interactiveAuth = options.interactiveAuth !== false;
    this.client = this.createClient();
  }

  private createClient(): Client {
    const client = new Client(
      { name: "hlvm", version: "0.1.0" },
      {
        capabilities: {
          sampling: {},
          elicitation: {},
          roots: { listChanged: true },
        },
      },
    );

    for (const method of ["sampling/createMessage", "elicitation/create", "roots/list"]) {
      const handler = this.requestHandlers.get(method);
      if (handler) {
        this.applyRequestHandler(client, method, handler);
      } else {
        this.installQueuingHandler(client, method);
      }
    }
    for (const [method, handler] of this.requestHandlers) {
      if (
        method !== "sampling/createMessage" &&
        method !== "elicitation/create" &&
        method !== "roots/list"
      ) {
        this.applyRequestHandler(client, method, handler);
      }
    }
    for (const [method, handler] of this.notificationHandlers) {
      this.applyNotificationHandler(client, method, handler);
    }
    return client;
  }

  /** Connect to the server and perform the initialize handshake */
  async start(): Promise<void> {
    await this.connectClient();
  }

  private createRemoteFetch(
    fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  ): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
    if (!this.remoteAuthProvider || !this.serverConfig.url) {
      return fetchImpl;
    }
    const authProvider = this.remoteAuthProvider;
    const serverUrl = this.serverConfig.url;
    return async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const response = await fetchImpl(input, init);
      if (response.status !== 403) return response;
      const { resourceMetadataUrl, scope, error } =
        extractWWWAuthenticateParams(response);
      if (error !== "insufficient_scope") return response;
      await response.body?.cancel().catch(() => undefined);
      const result = await auth(authProvider, {
        serverUrl,
        resourceMetadataUrl,
        scope,
        fetchFn: fetchImpl as FetchLike,
      });
      if (result !== "AUTHORIZED") {
        throw new UnauthorizedError(
          "Authentication requires user authorization - redirect initiated",
        );
      }
      return await fetchImpl(input, init);
    };
  }

  private buildTransport():
    | InstanceType<typeof SSEClientTransport>
    | InstanceType<typeof StdioClientTransport>
    | InstanceType<typeof StreamableHTTPClientTransport> {
    const authOptions = this.interactiveAuth
      ? {}
      : {
        openBrowser: async () => {
          throw new ToolError(
            `Interactive MCP OAuth disabled while inspecting '${this.serverConfig.name}'`,
            TOOL_NAMES.MCP,
            TOOL_CATEGORY.PERMISSION,
          );
        },
      };
    if (this.serverConfig.transport === "sse") {
      const url = new URL(this.serverConfig.url!);
      const baseHeaders = this.serverConfig.headers ?? {};
      const explicitAuthorization = hasExplicitAuthorizationHeader(baseHeaders);
      this.remoteAuthProvider = explicitAuthorization
        ? null
        : createMcpOAuthTransportAuthProvider(
          this.serverConfig,
          authOptions,
        );
      const rawFetchImpl =
        // deno-lint-ignore no-explicit-any
        wrapFetchWithTimeout(MCP_HTTP_REQUEST_TIMEOUT_MS) as any;
      const fetchImpl = explicitAuthorization
        ? rawFetchImpl
        : this.createRemoteFetch(rawFetchImpl);
      return new SSEClientTransport(url, {
        ...(this.remoteAuthProvider ? { authProvider: this.remoteAuthProvider } : {}),
        requestInit: {
          headers: baseHeaders,
        },
        // deno-lint-ignore no-explicit-any
        fetch: fetchImpl as any,
      });
    }
    if (this.serverConfig.url || this.serverConfig.transport === "http") {
      const url = new URL(this.serverConfig.url!);
      const baseHeaders = this.serverConfig.headers ?? {};
      const explicitAuthorization = hasExplicitAuthorizationHeader(baseHeaders);
      this.remoteAuthProvider = explicitAuthorization
        ? null
        : createMcpOAuthTransportAuthProvider(
          this.serverConfig,
          authOptions,
        );
      const rawFetchImpl =
        // deno-lint-ignore no-explicit-any
        wrapFetchWithTimeout(MCP_HTTP_REQUEST_TIMEOUT_MS) as any;
      const fetchImpl = explicitAuthorization
        ? rawFetchImpl
        : this.createRemoteFetch(rawFetchImpl);
      return new StreamableHTTPClientTransport(url, {
        ...(this.remoteAuthProvider ? { authProvider: this.remoteAuthProvider } : {}),
        requestInit: {
          headers: {
            ...baseHeaders,
            Accept: "application/json, text/event-stream",
          },
        },
        // deno-lint-ignore no-explicit-any
        fetch: fetchImpl as any,
      });
    }
    this.remoteAuthProvider = null;
    const [command, ...args] = this.serverConfig.command!;
    return new StdioClientTransport({
      command,
      args,
      env: this.serverConfig.env,
      cwd: this.serverConfig.cwd,
    });
  }

  private async finishPendingAuthorization(error: unknown): Promise<boolean> {
    if (!(error instanceof UnauthorizedError)) return false;
    if (!this.interactiveAuth) return false;
    if (
      !this.remoteAuthProvider ||
      !this.transport ||
      !("finishAuth" in this.transport) ||
      typeof this.transport.finishAuth !== "function" ||
      !this.remoteAuthProvider.hasPendingAuthorization()
    ) {
      return false;
    }
    const authorizationCode =
      await this.remoteAuthProvider.promptForAuthorizationCode();
    await this.transport.finishAuth(authorizationCode);
    return true;
  }

  private async connectClient(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      this.transport = this.buildTransport();
      try {
        await this.client.connect(this.transport);
        this.connectionState.connected = true;
        this.connectionState.reconnectAttempts = 0;
        break;
      } catch (error) {
        lastError = error;
        this.connectionState.connected = false;
        const completedAuth = await this.finishPendingAuthorization(error);
        await this.transport.close().catch(() => undefined);
        if (!completedAuth || attempt > 0) {
          throw error;
        }
        this.client = this.createClient();
      }
    }
    if (!this.connectionState.connected && lastError) {
      throw lastError;
    }

    if (this.transport instanceof StdioClientTransport) {
      const stderr = (this.transport as unknown as { stderr?: { on?: (event: string, cb: (chunk: unknown) => void) => void } }).stderr;
      if (stderr?.on) {
        stderr.on("data", (chunk: unknown) => {
          const text = typeof chunk === "string" ? chunk : String(chunk);
          getAgentLogger().debug(
            `MCP stderr (${this.serverConfig.name}): ${text.trim()}`,
          );
        });
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.cancelAllPending("MCP client closed");
    this.closed = true;
    this.connectionState.connected = false;
    const transport = this.transport;
    this.transport = null;
    this.remoteAuthProvider = null;
    try {
      await Promise.race([
        Promise.allSettled([
          this.client.close(),
          transport?.close() ?? Promise.resolve(),
        ]).then(() => undefined),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("MCP close timeout")), 5_000)
        ),
      ]);
    } catch (error) {
      getAgentLogger().debug(
        `MCP close error (${this.serverConfig.name}): ${getErrorMessage(error)}`,
      );
    }
  }

  private extractStatusCode(error: unknown): number | undefined {
    if (!isObjectValue(error)) return undefined;
    const direct = typeof error.status === "number" ? error.status : undefined;
    if (direct !== undefined) return direct;
    const response = isObjectValue(error.response)
      ? error.response as Record<string, unknown>
      : undefined;
    return typeof response?.status === "number" ? response.status : undefined;
  }

  private extractJsonRpcCode(error: unknown): number | undefined {
    if (!isObjectValue(error)) return undefined;
    const direct = typeof error.code === "number" ? error.code : undefined;
    if (direct !== undefined) return direct;
    const nested = isObjectValue(error.error)
      ? error.error as Record<string, unknown>
      : undefined;
    return typeof nested?.code === "number" ? nested.code : undefined;
  }

  private classifyError(
    error: unknown,
  ): "session_expired" | "terminal" | "transient" | "other" {
    const message = getErrorMessage(error).toLowerCase();
    const statusCode = this.extractStatusCode(error);
    const jsonRpcCode = this.extractJsonRpcCode(error);
    if (
      (statusCode === 404 && jsonRpcCode === -32001) ||
      message.includes("session expired")
    ) {
      return "session_expired";
    }
    if (statusCode === 401 || statusCode === 403) {
      return "terminal";
    }
    if (
      message.includes("econnreset") ||
      message.includes("etimedout") ||
      message.includes("epipe") ||
      message.includes("socket hang up") ||
      message.includes("connection closed") ||
      message.includes("error reading a body from connection") ||
      message.includes("network")
    ) {
      return "transient";
    }
    return "other";
  }

  private async delayReconnect(ms: number): Promise<void> {
    await sleep(ms);
  }

  private async reconnectWithBackoff(): Promise<void> {
    // Stdio transports have limited reconnect capability — log a warning.
    // The SDK's StdioClientTransport may restart the child process, so we
    // still attempt reconnection but with reduced attempts.
    const isStdio = this.transport instanceof StdioClientTransport;
    const maxAttempts = isStdio ? 2 : 5;
    if (isStdio) {
      getAgentLogger().debug(
        `MCP stdio server "${this.serverConfig.name}" disconnected — attempting restart`,
      );
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.connectionState.reconnectAttempts = attempt;
      try {
        this.cancelAllPending("MCP reconnect");
        try {
          await this.client.close();
        } catch {
          // Best-effort close before rebuilding transport/client.
        }
        this.client = this.createClient();
        await this.connectClient();
        this.connectionState.terminalErrorCount = 0;
        for (const listener of this.reconnectListeners) listener();
        return;
      } catch (error) {
        lastError = error;
        this.connectionState.connected = false;
        const delayMs = Math.min(30_000, 1000 * (2 ** (attempt - 1)));
        if (attempt < maxAttempts) {
          await this.delayReconnect(delayMs);
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("MCP reconnect exhausted");
  }

  private async withReconnect<T>(
    run: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.connectionState.terminalErrorCount >= 3) {
      throw new ToolError(
        `MCP terminal error budget exceeded for '${this.serverConfig.name}'`,
        TOOL_NAMES.MCP,
        TOOL_CATEGORY.INTERNAL,
      );
    }
    try {
      return await run(signal);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        const completedAuth = await this.finishPendingAuthorization(error);
        if (!completedAuth) {
          throw error;
        }
        await this.reconnectWithBackoff();
        return await run(signal);
      }
      const kind = this.classifyError(error);
      if (kind === "terminal") {
        this.connectionState.terminalErrorCount += 1;
        if (this.connectionState.terminalErrorCount >= 3) {
          getAgentLogger().warn(
            `MCP '${this.serverConfig.name}' reached terminal error budget`,
          );
        }
        throw error;
      }
      if (kind !== "session_expired" && kind !== "transient") {
        throw error;
      }
      if (this.closed) throw error;
      await this.reconnectWithBackoff();
      return await run(signal);
    }
  }

  // ============================================================
  // Tool Operations
  // ============================================================

  private buildRequestOptions(
    signal?: AbortSignal,
  ): { options: { signal: AbortSignal }; cleanup: () => void } {
    const pendingSignal = this.pendingAbortController.signal;
    if (!signal) {
      return { options: { signal: pendingSignal }, cleanup: () => {} };
    }

    if (signal.aborted || pendingSignal.aborted) {
      const controller = new AbortController();
      controller.abort(signal.aborted ? signal.reason : pendingSignal.reason);
      return { options: { signal: controller.signal }, cleanup: () => {} };
    }

    const controller = new AbortController();
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      pendingSignal.removeEventListener("abort", onPendingAbort);
      signal.removeEventListener("abort", onSignalAbort);
    };
    const onPendingAbort = () => {
      if (!controller.signal.aborted) {
        controller.abort(pendingSignal.reason);
      }
      cleanup();
    };
    const onSignalAbort = () => {
      if (!controller.signal.aborted) {
        controller.abort(signal.reason);
      }
      cleanup();
    };
    pendingSignal.addEventListener("abort", onPendingAbort, { once: true });
    signal.addEventListener("abort", onSignalAbort, { once: true });

    return { options: { signal: controller.signal }, cleanup };
  }

  private async withRequestOptions<T>(
    run: (options: { signal: AbortSignal }) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const { options, cleanup } = this.buildRequestOptions(signal);
    const abortSignal = options.signal;
    const abortError = () => {
      const reason = abortSignal.reason;
      if (reason instanceof Error) return reason;
      const error = new Error(
        typeof reason === "string" && reason.length > 0
          ? reason
          : "MCP request aborted",
      );
      error.name = "AbortError";
      return error;
    };

    if (abortSignal.aborted) {
      cleanup();
      throw abortError();
    }

    let removeAbortListener = () => {};
    const abortPromise = new Promise<T>((_, reject) => {
      const onAbort = () => reject(abortError());
      abortSignal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () =>
        abortSignal.removeEventListener("abort", onAbort);
    });

    try {
      return await Promise.race([run(options), abortPromise]);
    } finally {
      removeAbortListener();
      cleanup();
    }
  }

  async listTools(signal?: AbortSignal): Promise<McpToolInfo[]> {
    const result = await this.withReconnect(
      (requestSignal) =>
        this.withRequestOptions(
          (options) => this.client.listTools(undefined, options),
          requestSignal,
        ),
      signal,
    ) as {
      tools: Array<Record<string, unknown> & {
        name: string;
        description?: string;
        inputSchema?: unknown;
      }>;
    };
    return result.tools.map((t) => ({
      name: t.name,
      description: capMcpDescription(t.description),
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      metadata: isObjectValue((t as Record<string, unknown>).metadata)
        ? (t as Record<string, unknown>).metadata as Record<string, unknown>
        : undefined,
      annotations: isObjectValue((t as Record<string, unknown>).annotations)
        ? (t as Record<string, unknown>).annotations as Record<string, unknown>
        : undefined,
      _meta: isObjectValue((t as Record<string, unknown>)._meta)
        ? (t as Record<string, unknown>)._meta as Record<string, unknown>
        : undefined,
    }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return await this.withReconnect(
      (requestSignal) =>
        this.withRequestOptions(
          (options) =>
            this.client.callTool(
              { name, arguments: args },
              undefined,
              options,
            ),
          requestSignal,
        ),
      signal,
    );
  }

  // ============================================================
  // Resource Operations
  // ============================================================

  async listResources(signal?: AbortSignal): Promise<McpResourceInfo[]> {
    const result = await this.withReconnect(
      (requestSignal) =>
        this.withRequestOptions(
          (options) => this.client.listResources(undefined, options),
          requestSignal,
        ),
      signal,
    ) as {
      resources: Array<{
        uri: string;
        name: string;
        description?: string;
        mimeType?: string;
      }>;
    };
    return result.resources.map((r) => ({
      uri: r.uri,
      name: sanitizeMcpText(r.name),
      description: capMcpDescription(r.description),
      mimeType: r.mimeType,
    }));
  }

  async readResource(
    uri: string,
    signal?: AbortSignal,
  ): Promise<McpResourceContent[]> {
    const result = await this.withReconnect(
      (requestSignal) =>
        this.withRequestOptions(
          (options) => this.client.readResource({ uri }, options),
          requestSignal,
        ),
      signal,
    ) as {
      contents: Array<Record<string, unknown> & {
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
      }>;
    };
    return result.contents.map((c) => ({
      uri: c.uri,
      mimeType: c.mimeType,
      text: "text" in c && typeof c.text === "string"
        ? sanitizeMcpText(c.text)
        : undefined,
      blob: "blob" in c ? c.blob as string : undefined,
    }));
  }

  async listResourceTemplates(
    signal?: AbortSignal,
  ): Promise<McpResourceTemplate[]> {
    const result = await this.withReconnect(
      (requestSignal) =>
        this.withRequestOptions(
          (options) => this.client.listResourceTemplates(undefined, options),
          requestSignal,
        ),
      signal,
    ) as {
      resourceTemplates: Array<{
        uriTemplate: string;
        name: string;
        description?: string;
        mimeType?: string;
      }>;
    };
    return result.resourceTemplates.map((t) => ({
      uriTemplate: t.uriTemplate,
      name: sanitizeMcpText(t.name),
      description: capMcpDescription(t.description),
      mimeType: t.mimeType,
    }));
  }

  async subscribeResource(uri: string, signal?: AbortSignal): Promise<void> {
    await this.withReconnect(
      (requestSignal) =>
        this.withRequestOptions(
          (options) => this.client.subscribeResource({ uri }, options),
          requestSignal,
        ),
      signal,
    );
  }

  async unsubscribeResource(uri: string, signal?: AbortSignal): Promise<void> {
    await this.withReconnect(
      (requestSignal) =>
        this.withRequestOptions(
          (options) => this.client.unsubscribeResource({ uri }, options),
          requestSignal,
        ),
      signal,
    );
  }

  // ============================================================
  // Prompt Operations
  // ============================================================

  async listPrompts(signal?: AbortSignal): Promise<McpPromptInfo[]> {
    const result = await this.withReconnect(
      (requestSignal) =>
        this.withRequestOptions(
          (options) => this.client.listPrompts(undefined, options),
          requestSignal,
        ),
      signal,
    ) as {
      prompts: Array<{
        name: string;
        description?: string;
        arguments?: Array<{
          name: string;
          description?: string;
          required?: boolean;
        }>;
      }>;
    };
    return result.prompts.map((p) => ({
      name: sanitizeMcpText(p.name),
      description: capMcpDescription(p.description),
      arguments: p.arguments?.map((a) => ({
        name: sanitizeMcpText(a.name),
        description: capMcpDescription(a.description),
        required: a.required,
      })),
    }));
  }

  async getPrompt(
    name: string,
    args?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<McpPromptMessage[]> {
    const result = await this.withReconnect(
      (requestSignal) =>
        this.withRequestOptions(
          (options) => this.client.getPrompt({ name, arguments: args }, options),
          requestSignal,
        ),
      signal,
    ) as {
      messages: McpPromptMessage[];
    };
    return (result.messages as McpPromptMessage[]).map((message) => {
      const content = message.content;
      if ("text" in content) {
        return {
          ...message,
          content: {
            ...content,
            text: sanitizeMcpText(content.text),
          },
        };
      }
      if ("resource" in content && typeof content.resource.text === "string") {
        return {
          ...message,
          content: {
            ...content,
            resource: {
              ...content.resource,
              text: sanitizeMcpText(content.resource.text),
            },
          },
        };
      }
      return message;
    });
  }

  // ============================================================
  // Completion
  // ============================================================

  async complete(
    ref:
      | { type: "ref/resource"; uri: string }
      | { type: "ref/prompt"; name: string },
    argument: { name: string; value: string },
    signal?: AbortSignal,
  ): Promise<string[]> {
    const result = await this.withReconnect(
      (requestSignal) =>
        this.withRequestOptions(
          (options) => this.client.complete({ ref, argument }, options),
          requestSignal,
        ),
      signal,
    ) as {
      completion: { values: string[] };
    };
    return result.completion.values;
  }

  // ============================================================
  // Logging
  // ============================================================

  async setLogLevel(level: string, signal?: AbortSignal): Promise<void> {
    await this.withReconnect(
      (requestSignal) =>
        this.withRequestOptions(
          (options) =>
            this.client.setLoggingLevel(level as
              | "debug"
              | "info"
              | "notice"
              | "warning"
              | "error"
              | "critical"
              | "alert"
              | "emergency", options),
          requestSignal,
        ),
      signal,
    );
  }

  // ============================================================
  // Ping
  // ============================================================

  async ping(signal?: AbortSignal): Promise<void> {
    await this.withReconnect(
      (requestSignal) =>
        this.withRequestOptions(
          (options) => this.client.ping(options),
          requestSignal,
        ),
      signal,
    );
  }

  // ============================================================
  // Capabilities
  // ============================================================

  hasCapability(name: string): boolean {
    const caps = this.client.getServerCapabilities();
    if (!caps) return false;
    return name in caps;
  }

  onReconnect(listener: () => void): void {
    this.reconnectListeners.add(listener);
  }

  // ============================================================
  // Request / Notification handlers (bidirectional protocol)
  // ============================================================

  /**
   * Install a queuing stub handler for a deferrable server request method.
   * Captures requests that arrive before the real handler is registered.
   */
  private installQueuingHandler(client: Client, method: string): void {
    const schema = REQUEST_SCHEMAS[method];
    if (!schema) return;
    client.setRequestHandler(schema, (request) => {
      return new Promise((resolve, reject) => {
        if (!this.pendingRequests.has(method)) {
          this.pendingRequests.set(method, []);
        }
        const queue = this.pendingRequests.get(method)!;
        if (queue.length >= SdkMcpClient.MAX_PENDING_PER_METHOD) {
          const dropped = queue.shift()!;
          dropped.reject(new Error("MCP pending request queue overflow"));
        }
        queue.push({
          params: request.params,
          resolve,
          reject,
        });
      });
    });
  }

  private applyRequestHandler(
    client: Client,
    method: string,
    handler: (params: unknown) => Promise<unknown>,
  ): void {
    const schema = REQUEST_SCHEMAS[method];
    if (!schema) {
      getAgentLogger().debug(`No SDK schema for request method: ${method}`);
      return;
    }
    client.setRequestHandler(schema, async (request) => {
      return await handler(request.params) as Record<string, unknown>;
    });
  }

  private applyNotificationHandler(
    client: Client,
    method: string,
    handler: (params: unknown) => void,
  ): void {
    const schema = NOTIFICATION_SCHEMAS[method];
    if (!schema) {
      getAgentLogger().debug(`No SDK schema for notification method: ${method}`);
      return;
    }
    client.setNotificationHandler(schema, (notification) => {
      handler(notification.params);
    });
  }

  /**
   * Register a handler for server-initiated requests.
   * Maps method strings to SDK Zod schemas for type-safe handler registration.
   * Replays any queued requests that arrived before this handler was wired.
   */
  onRequest(
    method: string,
    handler: (params: unknown) => Promise<unknown>,
  ): void {
    this.requestHandlers.set(method, handler);
    this.applyRequestHandler(this.client, method, handler);

    // Replay any requests that were queued while waiting for this handler
    const queued = this.pendingRequests.get(method);
    if (queued?.length) {
      this.pendingRequests.delete(method);
      for (const { params, resolve, reject } of queued) {
        handler(params).then(
          (result) => resolve(result as Record<string, unknown>),
          reject,
        );
      }
    }
  }

  /**
   * Register a handler for server notifications.
   */
  onNotification(
    method: string,
    handler: (params: unknown) => void,
  ): void {
    this.notificationHandlers.set(method, handler);
    this.applyNotificationHandler(this.client, method, handler);
  }

  // ============================================================
  // Cancellation (SDK handles internally, expose for setSignal)
  // ============================================================

  /** Cancel all in-flight requests by rotating the shared request AbortController. */
  cancelAllPending(reason?: string): void {
    if (!this.pendingAbortController.signal.aborted) {
      this.pendingAbortController.abort(reason ?? "MCP request cancelled");
    }
    this.pendingAbortController = new AbortController();
  }
}

/** Factory function — create and connect an SDK MCP client */
export async function createSdkMcpClient(
  server: McpServerConfig,
  signal?: AbortSignal,
  options: { interactiveAuth?: boolean } = {},
): Promise<SdkMcpClient> {
  const client = new SdkMcpClient(server, options);
  let removeAbortListener = () => {};
  try {
    const startPromise = client.start().then(() => client);
    if (!signal) {
      return await startPromise;
    }
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () =>
        reject(signal.reason ?? new Error("MCP client start aborted"));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", onAbort);
    });
    return await Promise.race([startPromise, abortPromise]);
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  } finally {
    removeAbortListener();
  }
}
