/**
 * MCP Transports — Stdio and HTTP transport implementations.
 *
 * McpTransport is the abstract interface; StdioTransport manages a child
 * process, and HttpTransport (Phase 5) handles POST/SSE.
 */

import { getPlatform } from "../../../platform/platform.ts";
import type { PlatformCommandProcess } from "../../../platform/types.ts";
import { getErrorMessage, TEXT_ENCODER } from "../../../common/utils.ts";
import { ValidationError } from "../../../common/error.ts";
import { getAgentLogger } from "../logger.ts";
import type { JsonRpcMessage, McpServerConfig, McpTransport } from "./types.ts";
import { http } from "../../../common/http-client.ts";
import {
  getMcpOAuthAuthorizationHeader,
  parseBearerChallengeHeader,
  recoverMcpOAuthFromUnauthorized,
} from "./oauth.ts";

// ============================================================
// Stdio Transport
// ============================================================

export class StdioTransport implements McpTransport {
  private readonly server: McpServerConfig;
  private process: PlatformCommandProcess | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private stderrReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readLoopPromise: Promise<void> | null = null;
  private stderrDrainPromise: Promise<void> | null = null;
  private buffer = "";
  private closed = false;
  private messageHandler: ((message: JsonRpcMessage) => void) | null = null;

  constructor(server: McpServerConfig) {
    this.server = server;
  }

  setMessageHandler(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    if (this.process) return;
    const platform = getPlatform();
    const process = platform.command.run({
      cmd: this.server.command!,
      cwd: this.server.cwd,
      env: this.server.env,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    this.process = process;

    if (process.stdout) {
      this.reader = (process.stdout as ReadableStream<Uint8Array>).getReader();
      this.readLoopPromise = this.readLoop().catch((error) => {
        getAgentLogger().warn(
          `MCP read loop failed (${this.server.name}): ${
            getErrorMessage(error)
          }`,
        );
      });
    }

    if (process.stderr) {
      this.stderrReader = (process.stderr as ReadableStream<Uint8Array>)
        .getReader();
      this.stderrDrainPromise = this.drainReader(this.stderrReader);
    }

    if (process.stdin) {
      this.writer = (process.stdin as WritableStream<Uint8Array>).getWriter();
    }
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (this.closed || !this.writer) return;
    const data = TEXT_ENCODER.encode(JSON.stringify(message) + "\n");
    await this.writer.write(data);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch { /* ignore */ }
    }
    if (this.stderrReader) {
      try {
        await this.stderrReader.cancel();
      } catch { /* ignore */ }
    }
    if (this.writer) {
      try {
        await this.writer.close();
      } catch { /* ignore */ }
    }
    if (this.process?.kill) {
      try {
        this.process.kill("SIGTERM");
      } catch { /* ignore */ }
    }
    if (this.process) {
      try {
        await this.process.status;
      } catch { /* ignore */ }
    }
    if (this.readLoopPromise) {
      try {
        await this.readLoopPromise;
      } catch { /* ignore */ }
    }
    if (this.stderrDrainPromise) {
      try {
        await this.stderrDrainPromise;
      } catch { /* ignore */ }
    }
  }

  private async readLoop(): Promise<void> {
    if (!this.reader) return;
    const decoder = new TextDecoder();

    try {
      while (!this.closed) {
        const { done, value } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        this.buffer += decoder.decode(value, { stream: true });

        let index: number;
        while ((index = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.slice(0, index).trim();
          this.buffer = this.buffer.slice(index + 1);
          if (!line) continue;
          try {
            const parsed = JSON.parse(line) as JsonRpcMessage;
            if (this.messageHandler) this.messageHandler(parsed);
          } catch {
            // Ignore malformed lines
          }
        }
      }
    } finally {
      try {
        this.reader.releaseLock();
      } catch { /* ignore */ }
    }
  }

  private async drainReader(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> {
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // ignore
    } finally {
      reader.releaseLock();
    }
  }
}

// ============================================================
// HTTP Transport (Streamable HTTP + SSE)
// ============================================================

export class HttpTransport implements McpTransport {
  private readonly server: McpServerConfig;
  private sessionId?: string;
  private protocolVersion?: string;
  private closed = false;
  private messageHandler: ((message: JsonRpcMessage) => void) | null = null;

  constructor(server: McpServerConfig) {
    this.server = server;
  }

  setMessageHandler(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandler = handler;
  }

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
  }

  async start(): Promise<void> {
    // HTTP transport: no-op start; session begins on first POST
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (this.closed) return;
    const url = this.server.url!;
    const headers = await this.buildHeaders();
    let response = await http.fetchRaw(url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });

    // OAuth recovery path: refresh and retry once on 401 Bearer challenge.
    if (response.status === 401) {
      const challenge = parseBearerChallengeHeader(
        response.headers.get("WWW-Authenticate"),
      );
      const recovered = challenge
        ? await recoverMcpOAuthFromUnauthorized(
          this.server,
          response.headers.get("WWW-Authenticate"),
        )
        : false;
      if (recovered) {
        const retryHeaders = await this.buildHeaders();
        response = await http.fetchRaw(url, {
          method: "POST",
          headers: retryHeaders,
          body: JSON.stringify(message),
        });
      } else if (challenge) {
        throw new ValidationError(
          `MCP OAuth required for server '${this.server.name}'. Run: hlvm mcp login ${this.server.name}`,
          "mcp",
        );
      }
    }

    if (response.status >= 400) {
      const body = await this.safeReadText(response);
      throw new ValidationError(
        `MCP HTTP request failed (${this.server.name}): ${response.status} ${response.statusText}${
          body ? ` - ${body}` : ""
        }`,
        "mcp",
      );
    }

    // Store session ID from response header
    const newSessionId = response.headers.get("Mcp-Session-Id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    const contentType = response.headers.get("Content-Type") ?? "";

    if (contentType.includes("text/event-stream")) {
      // Parse SSE stream
      await this.consumeSSEStream(response);
    } else if (contentType.includes("application/json")) {
      // Parse single JSON response
      const body = await response.json();
      if (this.messageHandler && body) {
        // Could be a single response or an array (batch)
        if (Array.isArray(body)) {
          for (const msg of body) this.messageHandler(msg as JsonRpcMessage);
        } else {
          this.messageHandler(body as JsonRpcMessage);
        }
      }
    } else {
      // For notifications (no response body expected), just consume
      await response.body?.cancel();
    }
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.server.headers ?? {}),
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    if (this.protocolVersion) {
      headers["MCP-Protocol-Version"] = this.protocolVersion;
    }
    if (!headers.Authorization && !headers.authorization) {
      const authHeader = await getMcpOAuthAuthorizationHeader(this.server);
      if (authHeader) {
        headers.Authorization = authHeader;
      }
    }
    return headers;
  }

  private async safeReadText(response: Response): Promise<string> {
    try {
      return (await response.text()).trim();
    } catch {
      return "";
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Send DELETE with session ID to terminate server session
    if (this.sessionId) {
      try {
        const headers: Record<string, string> = {
          ...(this.server.headers ?? {}),
          "Mcp-Session-Id": this.sessionId,
        };
        const resp = await http.fetchRaw(this.server.url!, {
          method: "DELETE",
          headers,
        });
        // Consume response body to prevent resource leaks
        await resp.body?.cancel();
      } catch {
        // Best-effort cleanup
      }
    }
  }

  private async consumeSSEStream(response: Response): Promise<void> {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentData = "";

    try {
      while (!this.closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        let index: number;
        while ((index = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);

          if (line === "" || line === "\r") {
            // Blank line = event boundary; dispatch if we have data
            if (currentData) {
              try {
                const parsed = JSON.parse(currentData) as JsonRpcMessage;
                if (this.messageHandler) this.messageHandler(parsed);
              } catch {
                // Ignore malformed SSE data
              }
              currentData = "";
            }
          } else if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            currentData += (currentData ? "\n" : "") + data;
          }
          // Ignore event:, id:, retry: fields (not needed for MCP)
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch { /* ignore */ }
    }
  }
}

// ============================================================
// Transport Factory
// ============================================================

export function createTransport(server: McpServerConfig): McpTransport {
  if (server.url || server.transport === "http") {
    return new HttpTransport(server);
  }
  return new StdioTransport(server);
}
