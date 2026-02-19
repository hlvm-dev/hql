/**
 * Shared test helpers for MCP conformance tests.
 * Provides MockTransport and factory functions for deterministic client testing.
 */

import { McpClient } from "../../../src/hlvm/agent/mcp/client.ts";
import type {
  JsonRpcMessage,
  McpTransport,
} from "../../../src/hlvm/agent/mcp/types.ts";

/** In-memory transport that lets tests inject server messages */
export class MockTransport implements McpTransport {
  private handler: ((message: JsonRpcMessage) => void) | null = null;
  /** All messages sent by the client — inspectable by tests */
  readonly sent: JsonRpcMessage[] = [];
  /** Track whether close() was called */
  closeCalled = false;
  /** Track whether start() was called */
  startCalled = false;
  /** Pending response resolvers keyed by method name */
  private autoResponders = new Map<
    string,
    (msg: JsonRpcMessage) => JsonRpcMessage | null
  >();
  /** If set, start() will hang (never resolve) — for timeout tests */
  hangOnStart = false;
  /** If set, send() will throw — for transport failure tests */
  failOnSend = false;

  setMessageHandler(handler: (message: JsonRpcMessage) => void): void {
    this.handler = handler;
  }

  setProtocolVersion(_version: string): void {
    // Track for testing if needed
  }

  async start(): Promise<void> {
    this.startCalled = true;
    if (this.hangOnStart) {
      await new Promise<void>(() => {}); // never resolves
    }
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (this.failOnSend) {
      throw new Error("Transport send failure");
    }
    this.sent.push(message);
    // Check auto-responders
    if (message.method) {
      const responder = this.autoResponders.get(message.method);
      if (responder) {
        const response = responder(message);
        if (response && this.handler) {
          // Async dispatch to simulate real transport
          queueMicrotask(() => this.handler!(response));
        }
      }
    }
  }

  async close(): Promise<void> {
    this.closeCalled = true;
  }

  /** Inject a message as if it came from the server */
  injectMessage(msg: JsonRpcMessage): void {
    if (this.handler) this.handler(msg);
  }

  /** Auto-respond to a method with a result */
  onMethod(
    method: string,
    fn: (msg: JsonRpcMessage) => JsonRpcMessage | null,
  ): void {
    this.autoResponders.set(method, fn);
  }

  /** Set up basic initialize + initialized auto-respond */
  setupInitialize(
    capabilities: Record<string, unknown> = { tools: {} },
    version = "2025-11-25",
  ): void {
    this.onMethod("initialize", (msg) => ({
      jsonrpc: "2.0",
      id: msg.id!,
      result: {
        protocolVersion: version,
        serverInfo: { name: "mock", version: "0.1" },
        capabilities,
      },
    }));
  }

  /** Get sent messages by method name */
  sentByMethod(method: string): JsonRpcMessage[] {
    return this.sent.filter((m) => m.method === method);
  }

  /** Get sent requests (messages with both method and id) */
  sentRequests(): JsonRpcMessage[] {
    return this.sent.filter(
      (m) => m.method !== undefined && m.id !== undefined,
    );
  }

  /** Get sent notifications (messages with method but no id) */
  sentNotifications(): JsonRpcMessage[] {
    return this.sent.filter(
      (m) => m.method !== undefined && m.id === undefined,
    );
  }

  /** Get sent responses (messages with id but no method) */
  sentResponses(): JsonRpcMessage[] {
    return this.sent.filter(
      (m) => m.id !== undefined && m.method === undefined,
    );
  }
}

/** Create a MockTransport + McpClient pair with auto-responding initialize */
export function createMockClient(
  capabilities?: Record<string, unknown>,
  version?: string,
): { client: McpClient; transport: MockTransport } {
  const transport = new MockTransport();
  transport.setupInitialize(capabilities, version);
  const client = new McpClient(
    { name: "mock", command: ["mock"] },
    transport,
  );
  return { client, transport };
}

/** Create a raw MockTransport + McpClient pair (no auto-responders) */
export function createRawClient(): {
  client: McpClient;
  transport: MockTransport;
} {
  const transport = new MockTransport();
  const client = new McpClient(
    { name: "mock", command: ["mock"] },
    transport,
  );
  return { client, transport };
}
