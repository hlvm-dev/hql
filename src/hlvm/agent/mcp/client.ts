/**
 * MCP Client — JSON-RPC multiplexer with bidirectional protocol support.
 *
 * Transport-agnostic: works with any McpTransport (stdio, HTTP).
 * Handles: response routing, server requests, notifications,
 * capability tracking, and handler registry.
 */

import { ValidationError } from "../../../common/error.ts";
import { getErrorMessage, isObjectValue } from "../../../common/utils.ts";
import { getAgentLogger } from "../logger.ts";
import type {
  JsonRpcMessage,
  McpPromptInfo,
  McpPromptMessage,
  McpResourceContent,
  McpResourceInfo,
  McpResourceTemplate,
  McpServerConfig,
  McpToolInfo,
  McpTransport,
} from "./types.ts";

/** Timeout for individual MCP JSON-RPC requests (30 seconds) */
const MCP_REQUEST_TIMEOUT_MS = 30_000;

/** Timeout for transport.start() (10 seconds) */
const TRANSPORT_START_TIMEOUT_MS = 10_000;

/** Timeout for transport.close() (5 seconds) — resolves on timeout to avoid blocking cleanup */
const TRANSPORT_CLOSE_TIMEOUT_MS = 5_000;

// ============================================================
// Type Guards
// ============================================================

export function isMcpToolInfo(value: unknown): value is McpToolInfo {
  if (!isObjectValue(value)) return false;
  return typeof value.name === "string";
}

export function isMcpResourceInfo(value: unknown): value is McpResourceInfo {
  if (!isObjectValue(value)) return false;
  return typeof value.uri === "string" && typeof value.name === "string";
}

export function isMcpResourceContent(
  value: unknown,
): value is McpResourceContent {
  if (!isObjectValue(value)) return false;
  return typeof value.uri === "string";
}

export function isMcpResourceTemplate(
  value: unknown,
): value is McpResourceTemplate {
  if (!isObjectValue(value)) return false;
  return typeof value.uriTemplate === "string" &&
    typeof value.name === "string";
}

export function isMcpPromptInfo(value: unknown): value is McpPromptInfo {
  if (!isObjectValue(value)) return false;
  return typeof value.name === "string";
}

// ============================================================
// McpClient
// ============================================================

export class McpClient {
  private readonly server: McpServerConfig;
  private readonly transport: McpTransport;
  private nextId = 1;
  private initRequestId = -1;
  private closed = false;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private serverCapabilities: Record<string, unknown> = {};
  private notificationHandlers = new Map<
    string,
    (params: unknown) => void
  >();
  private requestHandlers = new Map<
    string,
    (params: unknown) => Promise<unknown>
  >();
  /** Queue for server requests that arrived before a handler was registered.
   *  Only requests for deferrable methods (sampling, elicitation, roots) are queued;
   *  unknown methods still get an immediate -32601 error. */
  private pendingServerRequests: { method: string; id: number; params: unknown }[] = [];
  /** Methods eligible for deferred handler registration */
  private static readonly DEFERRABLE_METHODS = new Set([
    "sampling/createMessage",
    "elicitation/create",
    "roots/list",
  ]);

  constructor(server: McpServerConfig, transport: McpTransport) {
    this.server = server;
    this.transport = transport;
    this.transport.setMessageHandler((msg) => this.handleMessage(msg));
  }

  /** Register a handler for server notifications */
  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notificationHandlers.set(method, handler);
  }

  /** Register a handler for server-initiated requests.
   *  Replays any queued requests that arrived before this handler was registered. */
  onRequest(
    method: string,
    handler: (params: unknown) => Promise<unknown>,
  ): void {
    this.requestHandlers.set(method, handler);

    // Replay queued requests for this method (handles race: server fired before handler registered)
    const queued = this.pendingServerRequests.filter((r) => r.method === method);
    this.pendingServerRequests = this.pendingServerRequests.filter((r) => r.method !== method);
    for (const req of queued) {
      handler(req.params)
        .then((result) => this.sendResponse(req.id, result).catch(() => {}))
        .catch((err) =>
          this.sendError(req.id, -32603, getErrorMessage(err)).catch(() => {})
        );
    }
  }

  /** Check if server declared a capability */
  hasCapability(name: string): boolean {
    return name in this.serverCapabilities;
  }

  async start(
    clientCapabilities?: Record<string, unknown>,
  ): Promise<void> {
    {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.transport.start(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new ValidationError("Transport start timed out", "mcp")),
              TRANSPORT_START_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }

    // Initialize handshake — try 2025-11-25, handle version negotiation per spec
    const caps = clientCapabilities ?? { tools: {} };
    const clientInfo = { name: "hlvm", version: "0.1.0" };
    this.initRequestId = this.nextId; // Track init ID — spec forbids cancelling it
    try {
      const initResult = await this.request("initialize", {
        protocolVersion: "2025-11-25",
        clientInfo,
        capabilities: caps,
      });
      // Spec: if server responds with a different protocolVersion, it means it
      // doesn't support ours but offers its own. Accept if it's a known version.
      const serverVersion = this.extractProtocolVersion(initResult);
      if (serverVersion && serverVersion !== "2025-11-25") {
        // Server negotiated down — accept if we support it (2024-11-05)
        if (serverVersion === "2024-11-05" || serverVersion === "2025-03-26") {
          this.extractCapabilities(initResult);
          this.setTransportProtocolVersion(serverVersion);
          await this.notify("notifications/initialized", {});
          return;
        }
        // Unknown version — disconnect per spec (SHOULD disconnect)
        getAgentLogger().warn(
          `MCP server '${this.server.name}' offered unsupported version: ${serverVersion}`,
        );
        this.closed = true;
        await this.transport.close();
        return;
      }
      this.extractCapabilities(initResult);
      this.setTransportProtocolVersion(serverVersion ?? "2025-11-25");
      await this.notify("notifications/initialized", {});
    } catch (error) {
      // Some servers send errors instead of version negotiation (non-spec but common)
      const errMsg = getErrorMessage(error);
      if (
        errMsg.includes("version") || errMsg.includes("protocol") ||
        errMsg.includes("unsupported")
      ) {
        try {
          const fallbackResult = await this.request("initialize", {
            protocolVersion: "2024-11-05",
            clientInfo,
            capabilities: caps,
          });
          this.extractCapabilities(fallbackResult);
          const fallbackVersion = this.extractProtocolVersion(fallbackResult) ?? "2024-11-05";
          this.setTransportProtocolVersion(fallbackVersion);
          await this.notify("notifications/initialized", {});
        } catch (fallbackError) {
          this.closed = true;
          getAgentLogger().warn(
            `MCP initialize failed (${this.server.name}): ${
              getErrorMessage(fallbackError)
            }`,
          );
        }
      } else {
        this.closed = true;
        getAgentLogger().warn(
          `MCP initialize failed (${this.server.name}): ${errMsg}`,
        );
      }
    }
  }

  private extractProtocolVersion(initResult: unknown): string | null {
    if (isObjectValue(initResult)) {
      const r = initResult as Record<string, unknown>;
      if (typeof r.protocolVersion === "string") return r.protocolVersion;
    }
    return null;
  }

  private extractCapabilities(initResult: unknown): void {
    if (isObjectValue(initResult)) {
      const r = initResult as Record<string, unknown>;
      if (isObjectValue(r.capabilities)) {
        this.serverCapabilities = r.capabilities as Record<string, unknown>;
      }
    }
  }

  private setTransportProtocolVersion(version: string): void {
    this.transport.setProtocolVersion?.(version);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failPending(new ValidationError("MCP client closed", "mcp"));
    // Timeout resolves (not rejects) to avoid blocking cleanup
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.transport.close(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, TRANSPORT_CLOSE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  // ============================================================
  // Generic Paginated List (DRY helper)
  // ============================================================

  private async paginatedList<T>(
    method: string,
    resultKey: string,
    filter: (value: unknown) => value is T,
  ): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | undefined;
    do {
      const params: Record<string, unknown> = {};
      if (cursor) params.cursor = cursor;
      const result = await this.request(method, params);
      if (!isObjectValue(result)) break;
      const r = result as Record<string, unknown>;
      const items = r[resultKey];
      if (Array.isArray(items)) {
        all.push(...items.filter(filter));
      }
      cursor = typeof r.nextCursor === "string" ? r.nextCursor : undefined;
    } while (cursor);
    return all;
  }

  // ============================================================
  // Tool Operations
  // ============================================================

  async listTools(): Promise<McpToolInfo[]> {
    return this.paginatedList("tools/list", "tools", isMcpToolInfo);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return await this.request("tools/call", { name, arguments: args });
  }

  // ============================================================
  // Resource Operations
  // ============================================================

  async listResources(): Promise<McpResourceInfo[]> {
    return this.paginatedList(
      "resources/list",
      "resources",
      isMcpResourceInfo,
    );
  }

  async readResource(uri: string): Promise<McpResourceContent[]> {
    const result = await this.request("resources/read", { uri });
    if (!isObjectValue(result)) return [];
    const contents = (result as Record<string, unknown>).contents;
    if (!Array.isArray(contents)) return [];
    return contents.filter(isMcpResourceContent);
  }

  async listResourceTemplates(): Promise<McpResourceTemplate[]> {
    return this.paginatedList(
      "resources/templates/list",
      "resourceTemplates",
      isMcpResourceTemplate,
    );
  }

  async subscribeResource(uri: string): Promise<void> {
    await this.request("resources/subscribe", { uri });
  }

  async unsubscribeResource(uri: string): Promise<void> {
    await this.request("resources/unsubscribe", { uri });
  }

  // ============================================================
  // Prompt Operations
  // ============================================================

  async listPrompts(): Promise<McpPromptInfo[]> {
    return this.paginatedList("prompts/list", "prompts", isMcpPromptInfo);
  }

  async getPrompt(
    name: string,
    args?: Record<string, string>,
  ): Promise<McpPromptMessage[]> {
    const params: Record<string, unknown> = { name };
    if (args) params.arguments = args;
    const result = await this.request("prompts/get", params);
    if (!isObjectValue(result)) return [];
    const messages = (result as Record<string, unknown>).messages;
    if (!Array.isArray(messages)) return [];
    return messages as McpPromptMessage[];
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
    const result = await this.request("completion/complete", { ref, argument });
    if (!isObjectValue(result)) return [];
    const completion = (result as Record<string, unknown>).completion;
    if (!isObjectValue(completion)) return [];
    const values = (completion as Record<string, unknown>).values;
    if (!Array.isArray(values)) return [];
    return values.filter((v): v is string => typeof v === "string");
  }

  // ============================================================
  // Logging
  // ============================================================

  async setLogLevel(level: string): Promise<void> {
    await this.request("logging/setLevel", { level });
  }

  // ============================================================
  // Ping
  // ============================================================

  async ping(): Promise<void> {
    await this.request("ping", {});
  }

  // ============================================================
  // Cancellation
  // ============================================================

  sendCancellation(requestId: number, reason?: string): void {
    this.notify("notifications/cancelled", {
      requestId,
      reason: reason ?? "Client cancelled",
    }).catch(() => {/* ignore */});
  }

  cancelAllPending(reason?: string): void {
    for (const id of this.pending.keys()) {
      // Spec: MUST NOT cancel the initialize request
      if (id === this.initRequestId) continue;
      this.sendCancellation(id, reason);
    }
  }

  getPendingRequestIds(): number[] {
    return [...this.pending.keys()];
  }

  // ============================================================
  // JSON-RPC Core
  // ============================================================

  async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.closed) {
      throw new ValidationError("MCP client closed", "mcp");
    }
    const id = this.nextId++;
    const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    await this.transport.send(message);

    const timeoutMs = MCP_REQUEST_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        // Remove from pending so late responses are ignored
        this.pending.delete(id);
        reject(
          new ValidationError(
            `MCP request '${method}' timed out after ${timeoutMs}ms`,
            "mcp",
          ),
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async notify(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    await this.transport.send({ jsonrpc: "2.0", method, params });
  }

  private async sendResponse(id: number, result: unknown): Promise<void> {
    await this.transport.send({ jsonrpc: "2.0", id, result });
  }

  private async sendError(
    id: number,
    code: number,
    message: string,
  ): Promise<void> {
    await this.transport.send({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    } as unknown as JsonRpcMessage);
  }

  /**
   * 3-way JSON-RPC message routing:
   * 1. Response (has id + result/error, no method) → resolve pending
   * 2. Server request (has id + method) → dispatch to requestHandlers
   * 3. Server notification (has method, no id) → dispatch to notificationHandlers
   */
  private handleMessage(msg: JsonRpcMessage): void {
    const hasId = typeof msg.id === "number";
    const hasMethod = typeof msg.method === "string";

    // Case 1: Response
    if (hasId && !hasMethod) {
      const pending = this.pending.get(msg.id!);
      if (!pending) return;
      this.pending.delete(msg.id!);
      if (msg.error) {
        pending.reject(new ValidationError(msg.error.message, "mcp"));
        return;
      }
      pending.resolve(msg.result);
      return;
    }

    // Case 2: Server-initiated request
    if (hasMethod && hasId) {
      const handler = this.requestHandlers.get(msg.method!);
      if (handler) {
        handler(msg.params)
          .then((result) => this.sendResponse(msg.id!, result).catch(() => {}))
          .catch((err) =>
            this.sendError(msg.id!, -32603, getErrorMessage(err)).catch(() => {})
          );
      } else if (McpClient.DEFERRABLE_METHODS.has(msg.method!)) {
        // Queue deferrable requests — handler may be registered later via onRequest()
        // (e.g., sampling/createMessage arriving before setHandlers is called)
        this.pendingServerRequests.push({
          method: msg.method!,
          id: msg.id!,
          params: msg.params,
        });
      } else {
        this.sendError(
          msg.id!,
          -32601,
          `Method not found: ${msg.method}`,
        ).catch(() => {});
      }
      return;
    }

    // Case 3: Server notification
    if (hasMethod && !hasId) {
      const handler = this.notificationHandlers.get(msg.method!);
      if (handler) {
        try {
          handler(msg.params);
        } catch (err) {
          getAgentLogger().warn(
            `MCP notification handler error (${msg.method}): ${getErrorMessage(err)}`,
          );
        }
      }
      return;
    }
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}
