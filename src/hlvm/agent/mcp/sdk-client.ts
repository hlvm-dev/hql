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

  async listTools(): Promise<McpToolInfo[]> {
    const result = await this.client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return await this.client.callTool({ name, arguments: args });
  }

  // ============================================================
  // Resource Operations
  // ============================================================

  async listResources(): Promise<McpResourceInfo[]> {
    const result = await this.client.listResources();
    return result.resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
  }

  async readResource(uri: string): Promise<McpResourceContent[]> {
    const result = await this.client.readResource({ uri });
    return result.contents.map((c) => ({
      uri: c.uri,
      mimeType: c.mimeType,
      text: "text" in c ? c.text as string : undefined,
      blob: "blob" in c ? c.blob as string : undefined,
    }));
  }

  async listResourceTemplates(): Promise<McpResourceTemplate[]> {
    const result = await this.client.listResourceTemplates();
    return result.resourceTemplates.map((t) => ({
      uriTemplate: t.uriTemplate,
      name: t.name,
      description: t.description,
      mimeType: t.mimeType,
    }));
  }

  async subscribeResource(uri: string): Promise<void> {
    await this.client.subscribeResource({ uri });
  }

  async unsubscribeResource(uri: string): Promise<void> {
    await this.client.unsubscribeResource({ uri });
  }

  // ============================================================
  // Prompt Operations
  // ============================================================

  async listPrompts(): Promise<McpPromptInfo[]> {
    const result = await this.client.listPrompts();
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
  ): Promise<McpPromptMessage[]> {
    const result = await this.client.getPrompt({ name, arguments: args });
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
  ): Promise<string[]> {
    const result = await this.client.complete({ ref, argument });
    return result.completion.values;
  }

  // ============================================================
  // Logging
  // ============================================================

  async setLogLevel(level: string): Promise<void> {
    await this.client.setLoggingLevel(level as
      | "debug"
      | "info"
      | "notice"
      | "warning"
      | "error"
      | "critical"
      | "alert"
      | "emergency");
  }

  // ============================================================
  // Ping
  // ============================================================

  async ping(): Promise<void> {
    await this.client.ping();
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

  /** Cancel all pending requests — SDK handles via AbortController internally */
  cancelAllPending(_reason?: string): void {
    // The SDK doesn't expose cancelAllPending directly.
    // When using setSignal, the AbortSignal is wired to close().
    // For graceful cancellation, close() is the mechanism.
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
