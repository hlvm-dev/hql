#!/usr/bin/env -S deno run --quiet
/**
 * Minimal MCP test server (JSON-RPC over stdio, newline-delimited)
 *
 * Supports:
 * - initialize
 * - tools/list
 * - tools/call (echo)
 */

const decoder = new TextDecoder();
const encoder = new TextEncoder();
let replyPrefix = "";
try {
  replyPrefix = Deno.env.get("MCP_REPLY_PREFIX") ?? "";
} catch {
  replyPrefix = "";
}

let buffer = "";

function write(message: unknown) {
  const data = encoder.encode(JSON.stringify(message) + "\n");
  Deno.stdout.writeSync(data);
}

function handleRequest(request: {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}) {
  if (request.method === "initialize") {
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "mcp-test", version: "0.1" },
        capabilities: { tools: {} },
      },
    });
    return;
  }

  if (request.method === "tools/list") {
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echo back the input",
            inputSchema: {
              type: "object",
              properties: {
                message: { type: "string", description: "Message to echo" },
              },
            },
          },
        ],
      },
    });
    return;
  }

  if (request.method === "tools/call") {
    const params = request.params as Record<string, unknown> | undefined;
    const args = params?.arguments as Record<string, unknown> | undefined;
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: `${replyPrefix}${args?.message ?? ""}`,
      },
    });
    return;
  }

  // Default: method not found
  write({
    jsonrpc: "2.0",
    id: request.id,
    error: { code: -32601, message: "Method not found" },
  });
}

for await (const chunk of Deno.stdin.readable) {
  buffer += decoder.decode(chunk);
  let idx: number;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const request = JSON.parse(line) as {
        id?: number;
        method: string;
        params?: Record<string, unknown>;
      };
      handleRequest(request);
    } catch {
      // Ignore malformed input
    }
  }
}
