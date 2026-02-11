/**
 * MCP Integration - Minimal MCP client for tool discovery and execution
 *
 * Provides:
 * - Loading MCP server config from workspace
 * - Spawning MCP servers (stdio JSON-RPC)
 * - Listing tools and registering them into dynamic registry
 */

import { getPlatform } from "../../platform/platform.ts";
import type { PlatformCommandProcess } from "../../platform/types.ts";
import { ValidationError } from "../../common/error.ts";
import { parseJsonLine } from "../../common/jsonl.ts";
import { getErrorMessage, isObjectValue } from "../../common/utils.ts";
import { log } from "../api/log.ts";
import {
  registerTools,
  type ToolMetadata,
  unregisterTool,
} from "./registry.ts";

// ============================================================
// Types
// ============================================================

export interface McpServerConfig {
  name: string;
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface McpConfig {
  version: 1;
  servers: McpServerConfig[];
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// ============================================================
// Config Loading
// ============================================================

const MCP_FILE_NAME = "mcp.json";
const MCP_DIR_NAME = ".hlvm";
const PLAYWRIGHT_SERVER_NAME = "playwright";
const PLAYWRIGHT_SERVER_SCRIPT = ["scripts", "mcp", "playwright-server.mjs"];

function getDefaultMcpPath(workspace: string): string {
  const platform = getPlatform();
  return platform.path.join(workspace, MCP_DIR_NAME, MCP_FILE_NAME);
}

export async function loadMcpConfig(
  workspace: string,
  configPath?: string,
): Promise<McpConfig | null> {
  const platform = getPlatform();
  const path = configPath ?? getDefaultMcpPath(workspace);

  let content: string;
  try {
    content = await platform.fs.readTextFile(path);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    log.warn(`MCP config JSON invalid (${path}): ${getErrorMessage(error)}`);
    return null;
  }

  if (!isObjectValue(parsed) || parsed.version !== 1) {
    log.warn(`MCP config invalid (${path}): expected version 1`);
    return null;
  }

  const servers = Array.isArray(parsed.servers)
    ? parsed.servers.filter(isMcpServerConfig)
    : [];

  if (servers.length === 0) return null;
  return { version: 1, servers };
}

export async function resolveBuiltinMcpServers(
  workspace: string,
): Promise<McpServerConfig[]> {
  const platform = getPlatform();
  const scriptPath = platform.path.join(workspace, ...PLAYWRIGHT_SERVER_SCRIPT);
  try {
    const stat = await platform.fs.stat(scriptPath);
    if (stat.isFile) {
      return [{
        name: PLAYWRIGHT_SERVER_NAME,
        command: ["node", scriptPath],
      }];
    }
  } catch {
    // Optional built-in server is unavailable in this workspace.
  }
  return [];
}

function dedupeServers(servers: McpServerConfig[]): McpServerConfig[] {
  const seenNames = new Set<string>();
  const deduped: McpServerConfig[] = [];
  for (const server of servers) {
    const key = server.name.trim().toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    deduped.push(server);
  }
  return deduped;
}

function isMcpServerConfig(value: unknown): value is McpServerConfig {
  if (!isObjectValue(value)) return false;
  if (typeof value.name !== "string") return false;
  if (!Array.isArray(value.command) || value.command.length === 0) return false;
  if (!value.command.every((c: unknown) => typeof c === "string")) return false;
  return true;
}

// ============================================================
// MCP Client (stdio JSON-RPC)
// ============================================================

class McpClient {
  private readonly server: McpServerConfig;
  private readonly platform = getPlatform();
  private readonly encoder = new TextEncoder();
  private process: PlatformCommandProcess | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private stderrReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readLoopPromise: Promise<void> | null = null;
  private stderrDrainPromise: Promise<void> | null = null;
  private buffer = "";
  private nextId = 1;
  private closed = false;
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  constructor(server: McpServerConfig) {
    this.server = server;
  }

  async start(): Promise<void> {
    if (this.process) return;
    const process = this.platform.command.run({
      cmd: this.server.command,
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
        log.warn(
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

    // Best-effort initialize handshake (ignore failures for compatibility)
    try {
      await this.request("initialize", {
        protocolVersion: "2024-11-05",
        clientInfo: { name: "hlvm", version: "0.0.0" },
        capabilities: { tools: {} },
      });
      await this.notify("initialized", {});
    } catch (error) {
      log.warn(
        `MCP initialize failed (${this.server.name}): ${
          getErrorMessage(error)
        }`,
      );
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

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.notify("shutdown", {});
    } catch {
      // ignore
    }
    this.closed = true;
    this.failPending(new ValidationError("MCP client closed", "mcp"));

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // ignore
      }
    }
    if (this.stderrReader) {
      try {
        await this.stderrReader.cancel();
      } catch {
        // ignore
      }
    }
    if (this.writer) {
      try {
        await this.writer.close();
      } catch {
        // ignore
      }
    }
    if (this.process?.kill) {
      try {
        this.process.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    if (this.process) {
      try {
        await this.process.status;
      } catch {
        // ignore
      }
    }
    if (this.readLoopPromise) {
      try {
        await this.readLoopPromise;
      } catch {
        // ignore
      }
    }
    if (this.stderrDrainPromise) {
      try {
        await this.stderrDrainPromise;
      } catch {
        // ignore
      }
    }
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = await this.request("tools/list", {});
    const tools = isObjectValue(result) ? result.tools : null;
    if (!Array.isArray(tools)) return [];
    return tools.filter(isMcpToolInfo);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return await this.request("tools/call", {
      name,
      arguments: args,
    });
  }

  private async notify(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    await this.send({ jsonrpc: "2.0", method, params });
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.closed) {
      throw new ValidationError("MCP client closed", "mcp");
    }
    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    await this.send(request);
    return await promise;
  }

  private async send(message: JsonRpcRequest): Promise<void> {
    if (this.closed) {
      throw new ValidationError("MCP client closed", "mcp");
    }
    if (!this.writer) {
      throw new ValidationError("MCP stdin not available", "mcp");
    }
    const data = this.encoder.encode(JSON.stringify(message) + "\n");
    await this.writer.write(data);
  }

  private async readLoop(): Promise<void> {
    if (!this.reader) return;
    const decoder = new TextDecoder();

    try {
      while (!this.closed) {
        const { done, value } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        this.buffer += decoder.decode(value);

        let index: number;
        while ((index = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.slice(0, index).trim();
          this.buffer = this.buffer.slice(index + 1);
          if (!line) continue;
          this.handleLine(line);
        }
      }
    } finally {
      try {
        this.reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  private handleLine(line: string): void {
    const parsed = parseJsonLine<JsonRpcResponse>(line);
    if (parsed === undefined) return;
    if (!parsed || typeof parsed.id !== "number") return;
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);
    if (parsed.error) {
      pending.reject(new ValidationError(parsed.error.message, "mcp"));
      return;
    }
    pending.resolve(parsed.result);
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}

function isMcpToolInfo(value: unknown): value is McpToolInfo {
  if (!isObjectValue(value)) return false;
  if (typeof value.name !== "string") return false;
  return true;
}

function buildArgsSchema(
  schema?: Record<string, unknown>,
): Record<string, string> {
  if (!schema || !isObjectValue(schema)) return {};
  const properties = isObjectValue(schema.properties)
    ? schema.properties as Record<string, unknown>
    : null;
  if (!properties) return {};

  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!isObjectValue(value)) {
      args[key] = "any - MCP tool argument";
      continue;
    }
    const type = typeof value.type === "string" ? value.type : "any";
    const description = typeof value.description === "string"
      ? value.description
      : "MCP tool argument";
    args[key] = `${type} - ${description}`;
  }
  return args;
}

// ============================================================
// MCP Tool Registration
// ============================================================

export interface McpLoadResult {
  tools: string[];
  dispose: () => Promise<void>;
}

export async function loadMcpTools(
  workspace: string,
  configPath?: string,
  extraServers?: McpServerConfig[],
): Promise<McpLoadResult> {
  const config = await loadMcpConfig(workspace, configPath);
  const servers = dedupeServers([
    ...(config?.servers ?? []),
    ...(extraServers ?? []),
  ]);
  if (servers.length === 0) {
    return { tools: [], dispose: async () => {} };
  }

  const clients: McpClient[] = [];
  const registered: string[] = [];

  for (const server of servers) {
    const client = new McpClient(server);
    try {
      await client.start();

      const tools = await client.listTools();
      const entries: Record<string, ToolMetadata> = {};
      for (const tool of tools) {
        const name = `mcp/${server.name}/${tool.name}`;
        const argsSchema = buildArgsSchema(tool.inputSchema);
        const skipValidation = Object.keys(argsSchema).length === 0;

        entries[name] = {
          fn: async (args: unknown) => {
            if (!isObjectValue(args)) {
              throw new ValidationError("args must be an object", "mcp");
            }
            return await client.callTool(
              tool.name,
              args as Record<string, unknown>,
            );
          },
          description: tool.description ?? `MCP tool ${tool.name}`,
          args: argsSchema,
          skipValidation,
          safetyLevel: "L2",
          safety: "External MCP tool (policy-gated by user confirmation).",
        };
      }

      const names = registerTools(entries);
      registered.push(...names);
      clients.push(client);
    } catch (error) {
      log.warn(
        `Skipping MCP server '${server.name}': ${getErrorMessage(error)}`,
      );
      try {
        await client.close();
      } catch {
        // Best-effort cleanup for partially started clients.
      }
    }
  }

  return {
    tools: registered,
    dispose: async () => {
      for (const name of registered) unregisterTool(name);
      for (const client of clients) await client.close();
    },
  };
}
