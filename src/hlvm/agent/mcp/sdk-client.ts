/**
 * MCP SDK Client Adapter — Wraps @modelcontextprotocol/sdk Client to expose
 * the same API surface used by tools.ts and other HLVM code.
 *
 * Replaces the hand-rolled McpClient, StdioTransport, and HttpTransport with
 * the official Anthropic-maintained SDK.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
import { getErrorMessage } from "../../../common/utils.ts";
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
// SdkMcpClient — Adapter wrapping SDK Client
// ============================================================

export class SdkMcpClient {
  private readonly client: Client;
  private readonly serverConfig: McpServerConfig;
  private transport:
    | InstanceType<typeof StdioClientTransport>
    | InstanceType<typeof StreamableHTTPClientTransport>
    | null = null;
  private closed = false;
  private pendingAbortController = new AbortController();

  /**
   * Queue for server-initiated requests that arrive before handlers are
   * registered via onRequest(). The SDK doesn't queue these internally,
   * so we install stub handlers during start() that capture early requests,
   * then replay them when the real handler is wired via onRequest().
   */
  // deno-lint-ignore no-explicit-any
  private readonly pendingRequests = new Map<
    string,
    Array<{ params: unknown; resolve: (v: any) => void; reject: (e: unknown) => void }>
  >();
  private readonly registeredHandlers = new Set<string>();

  constructor(serverConfig: McpServerConfig) {
    this.serverConfig = serverConfig;
    this.client = new Client(
      { name: "hlvm", version: "0.1.0" },
      {
        capabilities: {
          sampling: {},
          elicitation: {},
          roots: { listChanged: true },
        },
      },
    );

    // Pre-register stub handlers for deferrable server requests so the SDK
    // doesn't reject them if they arrive before onRequest() is called.
    for (const method of ["sampling/createMessage", "elicitation/create", "roots/list"]) {
      this.installQueuingHandler(method);
    }
  }

  /** Connect to the server and perform the initialize handshake */
  async start(): Promise<void> {
    if (this.serverConfig.url || this.serverConfig.transport === "http") {
      // HTTP transport
      const url = new URL(this.serverConfig.url!);
      this.transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: this.serverConfig.headers ?? {},
        },
      });
    } else {
      // Stdio transport
      const [command, ...args] = this.serverConfig.command!;
      this.transport = new StdioClientTransport({
        command,
        args,
        env: this.serverConfig.env,
        cwd: this.serverConfig.cwd,
      });
    }

    await this.client.connect(this.transport);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.cancelAllPending("MCP client closed");
    this.closed = true;
    try {
      await this.client.close();
    } catch (error) {
      getAgentLogger().debug(
        `MCP close error (${this.serverConfig.name}): ${getErrorMessage(error)}`,
      );
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
    try {
      return await run(options);
    } finally {
      cleanup();
    }
  }

  async listTools(signal?: AbortSignal): Promise<McpToolInfo[]> {
    const result = await this.withRequestOptions(
      (options) => this.client.listTools(undefined, options),
      signal,
    );
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return await this.withRequestOptions(
      (options) =>
        this.client.callTool(
          { name, arguments: args },
          undefined,
          options,
        ),
      signal,
    );
  }

  // ============================================================
  // Resource Operations
  // ============================================================

  async listResources(signal?: AbortSignal): Promise<McpResourceInfo[]> {
    const result = await this.withRequestOptions(
      (options) => this.client.listResources(undefined, options),
      signal,
    );
    return result.resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
  }

  async readResource(
    uri: string,
    signal?: AbortSignal,
  ): Promise<McpResourceContent[]> {
    const result = await this.withRequestOptions(
      (options) => this.client.readResource({ uri }, options),
      signal,
    );
    return result.contents.map((c) => ({
      uri: c.uri,
      mimeType: c.mimeType,
      text: "text" in c ? c.text as string : undefined,
      blob: "blob" in c ? c.blob as string : undefined,
    }));
  }

  async listResourceTemplates(
    signal?: AbortSignal,
  ): Promise<McpResourceTemplate[]> {
    const result = await this.withRequestOptions(
      (options) => this.client.listResourceTemplates(undefined, options),
      signal,
    );
    return result.resourceTemplates.map((t) => ({
      uriTemplate: t.uriTemplate,
      name: t.name,
      description: t.description,
      mimeType: t.mimeType,
    }));
  }

  async subscribeResource(uri: string, signal?: AbortSignal): Promise<void> {
    await this.withRequestOptions(
      (options) => this.client.subscribeResource({ uri }, options),
      signal,
    );
  }

  async unsubscribeResource(uri: string, signal?: AbortSignal): Promise<void> {
    await this.withRequestOptions(
      (options) => this.client.unsubscribeResource({ uri }, options),
      signal,
    );
  }

  // ============================================================
  // Prompt Operations
  // ============================================================

  async listPrompts(signal?: AbortSignal): Promise<McpPromptInfo[]> {
    const result = await this.withRequestOptions(
      (options) => this.client.listPrompts(undefined, options),
      signal,
    );
    return result.prompts.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments?.map((a) => ({
        name: a.name,
        description: a.description,
        required: a.required,
      })),
    }));
  }

  async getPrompt(
    name: string,
    args?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<McpPromptMessage[]> {
    const result = await this.withRequestOptions(
      (options) => this.client.getPrompt({ name, arguments: args }, options),
      signal,
    );
    return result.messages as McpPromptMessage[];
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
    const result = await this.withRequestOptions(
      (options) => this.client.complete({ ref, argument }, options),
      signal,
    );
    return result.completion.values;
  }

  // ============================================================
  // Logging
  // ============================================================

  async setLogLevel(level: string, signal?: AbortSignal): Promise<void> {
    await this.withRequestOptions(
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
      signal,
    );
  }

  // ============================================================
  // Ping
  // ============================================================

  async ping(signal?: AbortSignal): Promise<void> {
    await this.withRequestOptions(
      (options) => this.client.ping(options),
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

  // ============================================================
  // Request / Notification handlers (bidirectional protocol)
  // ============================================================

  /**
   * Install a queuing stub handler for a deferrable server request method.
   * Captures requests that arrive before the real handler is registered.
   */
  private installQueuingHandler(method: string): void {
    const schema = REQUEST_SCHEMAS[method];
    if (!schema) return;
    this.client.setRequestHandler(schema, (request) => {
      return new Promise((resolve, reject) => {
        if (!this.pendingRequests.has(method)) {
          this.pendingRequests.set(method, []);
        }
        this.pendingRequests.get(method)!.push({
          params: request.params,
          resolve,
          reject,
        });
      });
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
    const schema = REQUEST_SCHEMAS[method];
    if (!schema) {
      getAgentLogger().debug(`No SDK schema for request method: ${method}`);
      return;
    }
    this.registeredHandlers.add(method);

    // Replace the queuing stub with the real handler
    this.client.setRequestHandler(schema, async (request) => {
      return await handler(request.params) as Record<string, unknown>;
    });

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
    const schema = NOTIFICATION_SCHEMAS[method];
    if (!schema) {
      getAgentLogger().debug(`No SDK schema for notification method: ${method}`);
      return;
    }
    this.client.setNotificationHandler(schema, async (notification) => {
      handler(notification.params);
    });
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
): Promise<SdkMcpClient> {
  const client = new SdkMcpClient(server);
  await client.start();
  return client;
}
