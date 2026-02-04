/**
 * Wire Mode - Structured JSON-RPC protocol for agent engine
 *
 * Provides a stable, deterministic interface for:
 * - External UIs (TUI/IDE)
 * - Test harnesses
 * - Automation scripts
 */

import { getPlatform } from "../../platform/platform.ts";
import { getAllTools } from "./registry.ts";
import { runReActLoop, type TraceEvent } from "./orchestrator.ts";
import { createAgentSession } from "./session.ts";
import { createDelegateHandler } from "./delegation.ts";
import { DEFAULT_MODEL_ID } from "../../common/config/types.ts";
import { ValidationError } from "../../common/error.ts";

// ============================================================
// Types
// ============================================================

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface WireServerOptions {
  workspace: string;
  model?: string;
  engineProfile?: "normal" | "strict";
  policyPath?: string;
  mcpConfigPath?: string;
}

// ============================================================
// Wire Server
// ============================================================

export async function runWireServer(options: WireServerOptions): Promise<void> {
  const platform = getPlatform();
  const encoder = new TextEncoder();

  const send = async (message: JsonRpcResponse | { jsonrpc: "2.0"; method: string; params: unknown }) => {
    const data = encoder.encode(JSON.stringify(message) + "\n");
    await platform.terminal.stdout.write(data);
  };

  for await (const line of readLines(platform.terminal.stdin)) {
    if (!line) continue;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      await send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      continue;
    }

    await handleWireRequest(request, options, send);
  }
}

export async function handleWireRequest(
  request: JsonRpcRequest,
  options: WireServerOptions,
  send: (message: JsonRpcResponse | { jsonrpc: "2.0"; method: string; params: unknown }) => Promise<void>,
): Promise<void> {
  const id = request.id ?? null;

  switch (request.method) {
    case "tools.list": {
      const tools = getAllTools();
      await send({
        jsonrpc: "2.0",
        id,
        result: Object.entries(tools).map(([name, meta]) => ({
          name,
          description: meta.description,
          args: meta.args,
          safetyLevel: meta.safetyLevel ?? "L2",
        })),
      });
      return;
    }
    case "agent.run": {
      if (!request.params || typeof request.params.task !== "string") {
        await send({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Missing task parameter" },
        });
        return;
      }

      const task = request.params.task as string;
      const model = (request.params.model as string | undefined)
        ?? options.model
        ?? DEFAULT_MODEL_ID;

      const maxCalls = typeof request.params.maxCalls === "number"
        ? request.params.maxCalls as number
        : undefined;
      const engineProfile = (request.params.engineProfile as "normal" | "strict" | undefined)
        ?? options.engineProfile;
      const failOnContextOverflow = request.params.failOnContextOverflow === true;
      const fixturePath = typeof request.params.llmFixture === "string"
        ? request.params.llmFixture as string
        : undefined;

      const session = await createAgentSession({
        workspace: options.workspace,
        model,
        fixturePath,
        engineProfile,
        failOnContextOverflow,
        policyPath: options.policyPath,
        mcpConfigPath: options.mcpConfigPath,
      });

      const onTrace = (event: TraceEvent) =>
        send({
          jsonrpc: "2.0",
          method: "agent.event",
          params: { id, event },
        });

      try {
        const delegate = createDelegateHandler(session.llm, {
          policy: session.policy,
          autoApprove: false,
          autoWeb: false,
        });
        const result = await runReActLoop(
          task,
          {
            workspace: options.workspace,
            context: session.context,
            maxToolCalls: maxCalls,
            policy: session.policy,
            onTrace,
            delegate,
          },
          session.llm,
        );

        await send({
          jsonrpc: "2.0",
          id,
          result: { final: result },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await send({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message },
        });
      } finally {
        await session.dispose();
      }
      return;
    }
    default: {
      await send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      });
    }
  }
}

// ============================================================
// Line Reader
// ============================================================

async function* readLines(
  stdin: { read(buffer: Uint8Array): Promise<number | null> },
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const buf = new Uint8Array(1024);
  let buffer = "";

  while (true) {
    const n = await stdin.read(buf);
    if (n === null) break;
    if (n === 0) continue;
    buffer += decoder.decode(buf.subarray(0, n));
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) {
        yield line;
      }
    }
  }
}
