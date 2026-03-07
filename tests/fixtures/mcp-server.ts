#!/usr/bin/env -S deno run --quiet
/**
 * Full MCP test server (JSON-RPC over stdio, newline-delimited)
 *
 * Supports:
 * - initialize (with capabilities, version negotiation)
 * - notifications/initialized
 * - tools/list (with pagination), tools/call (echo)
 * - resources/list, resources/read, resources/subscribe, resources/unsubscribe
 * - resources/templates/list
 * - prompts/list, prompts/get
 * - completion/complete
 * - logging/setLevel
 * - ping
 * - Server-initiated requests (sampling, elicitation) via MCP_TEST_MODE env
 * - Notifications (logging, progress)
 *
 * Env vars:
 *   MCP_REPLY_PREFIX - prefix for echo tool responses
 *   MCP_TEST_MODE    - comma-separated: resources,prompts,logging,sampling,
 *                      elicitation,paginated,old_protocol,progress
 */

import { getPlatform } from "../../src/platform/platform.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const env = getPlatform().env;

let replyPrefix = "";
try {
  replyPrefix = env.get("MCP_REPLY_PREFIX") ?? "";
} catch {
  replyPrefix = "";
}

let testMode = "";
try {
  testMode = env.get("MCP_TEST_MODE") ?? "";
} catch {
  testMode = "";
}

let toolDelayMs = 0;
try {
  const rawDelay = env.get("MCP_TOOL_DELAY_MS");
  const parsed = rawDelay ? Number(rawDelay) : 0;
  toolDelayMs = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
} catch {
  toolDelayMs = 0;
}

let buffer = "";

function write(message: unknown) {
  const data = encoder.encode(JSON.stringify(message) + "\n");
  getPlatform().terminal.stdout.writeSync(data);
}

let nextServerRequestId = 1000;

function handleRequest(request: {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}) {
  // Handle notifications (no id) — just ignore silently
  if (request.id === undefined) return;

  if (request.method === "initialize") {
    // Reject 2025-11-25 if old_protocol mode is set
    if (testMode.includes("old_protocol")) {
      const reqVersion = (request.params as Record<string, unknown>)
        ?.protocolVersion;
      if (reqVersion === "2025-11-25") {
        write({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32600,
            message: "Unsupported protocol version 2025-11-25",
          },
        });
        return;
      }
    }

    // Determine capabilities based on test mode
    const capabilities: Record<string, unknown> = { tools: {} };
    if (testMode.includes("resources")) {
      capabilities.resources = { subscribe: true, listChanged: true };
    }
    if (testMode.includes("prompts")) {
      capabilities.prompts = { listChanged: true };
    }
    if (testMode.includes("logging")) {
      capabilities.logging = {};
    }

    const version = testMode.includes("old_protocol")
      ? "2024-11-05"
      : "2025-11-25";

    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: version,
        serverInfo: { name: "mcp-test", version: "0.2" },
        capabilities,
      },
    });

    // Server-initiated sampling request
    if (testMode.includes("sampling")) {
      setTimeout(() => {
        write({
          jsonrpc: "2.0",
          id: nextServerRequestId++,
          method: "sampling/createMessage",
          params: {
            messages: [
              {
                role: "user",
                content: { type: "text", text: "What is 2+2?" },
              },
            ],
            maxTokens: 100,
          },
        });
      }, 50);
    }

    // Server-initiated elicitation request
    if (testMode.includes("elicitation")) {
      setTimeout(() => {
        write({
          jsonrpc: "2.0",
          id: nextServerRequestId++,
          method: "elicitation/create",
          params: {
            message: "Please confirm deployment",
            requestedSchema: {
              type: "object",
              properties: {
                confirmed: { type: "boolean" },
              },
            },
          },
        });
      }, 50);
    }

    // Send progress notification
    if (testMode.includes("progress")) {
      setTimeout(() => {
        write({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: {
            progressToken: "test-progress-1",
            progress: 50,
            total: 100,
            message: "Halfway done",
          },
        });
      }, 30);
    }

    return;
  }

  if (request.method === "ping") {
    write({ jsonrpc: "2.0", id: request.id, result: {} });
    return;
  }

  if (request.method === "tools/list") {
    // Paginated mode: return tools in 2 pages
    if (testMode.includes("paginated")) {
      const cursor = (request.params as Record<string, unknown>)
        ?.cursor as string | undefined;
      if (!cursor) {
        // Page 1
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
                    message: {
                      type: "string",
                      description: "Message to echo",
                    },
                  },
                },
              },
            ],
            nextCursor: "page2",
          },
        });
      } else {
        // Page 2 (last page)
        write({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: [
              {
                name: "reverse",
                description: "Reverse a string",
                inputSchema: {
                  type: "object",
                  properties: {
                    text: {
                      type: "string",
                      description: "Text to reverse",
                    },
                  },
                },
              },
            ],
          },
        });
      }
      return;
    }

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
    const toolName = params?.name as string | undefined;
    const args = params?.arguments as Record<string, unknown> | undefined;

    if (toolName === "reverse") {
      const text = (args?.text as string) ?? "";
      const response = {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: text.split("").reverse().join("") }] },
      };
      if (toolDelayMs > 0) {
        setTimeout(() => write(response), toolDelayMs);
      } else {
        write(response);
      }
      return;
    }

    const response = {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [{ type: "text", text: `${replyPrefix}${args?.message ?? ""}` }],
      },
    };
    if (toolDelayMs > 0) {
      setTimeout(() => write(response), toolDelayMs);
    } else {
      write(response);
    }
    return;
  }

  if (request.method === "resources/list") {
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        resources: [
          {
            uri: "file:///test/readme.md",
            name: "README",
            description: "Test readme file",
            mimeType: "text/markdown",
          },
          {
            uri: "file:///test/config.json",
            name: "Config",
            description: "Test configuration",
            mimeType: "application/json",
          },
        ],
      },
    });
    return;
  }

  if (request.method === "resources/read") {
    const uri = (request.params as Record<string, unknown>)?.uri as string;
    let text = "Unknown resource";
    if (uri === "file:///test/readme.md") {
      text = "# Test README\nThis is a test resource.";
    } else if (uri === "file:///test/config.json") {
      text = '{"key": "value"}';
    }
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        contents: [{ uri, text }],
      },
    });
    return;
  }

  if (request.method === "resources/templates/list") {
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        resourceTemplates: [
          {
            uriTemplate: "file:///test/{filename}",
            name: "Test files",
            description: "Access test files by name",
          },
        ],
      },
    });
    return;
  }

  if (request.method === "resources/subscribe") {
    write({ jsonrpc: "2.0", id: request.id, result: {} });
    return;
  }

  if (request.method === "resources/unsubscribe") {
    write({ jsonrpc: "2.0", id: request.id, result: {} });
    return;
  }

  if (request.method === "prompts/list") {
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        prompts: [
          {
            name: "greeting",
            description: "Generate a greeting",
            arguments: [
              { name: "name", description: "Person to greet", required: true },
            ],
          },
          {
            name: "summarize",
            description: "Summarize text",
            arguments: [
              {
                name: "text",
                description: "Text to summarize",
                required: true,
              },
              { name: "style", description: "Summary style" },
            ],
          },
        ],
      },
    });
    return;
  }

  if (request.method === "prompts/get") {
    const params = request.params as Record<string, unknown> | undefined;
    const promptName = params?.name as string;
    const promptArgs = params?.arguments as
      | Record<string, string>
      | undefined;

    if (promptName === "greeting") {
      write({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Please greet ${promptArgs?.name ?? "World"}`,
              },
            },
          ],
        },
      });
      return;
    }

    if (promptName === "summarize") {
      write({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Summarize: ${promptArgs?.text ?? ""} (style: ${
                  promptArgs?.style ?? "default"
                })`,
              },
            },
          ],
        },
      });
      return;
    }

    write({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32602, message: `Unknown prompt: ${promptName}` },
    });
    return;
  }

  if (request.method === "logging/setLevel") {
    write({ jsonrpc: "2.0", id: request.id, result: {} });
    if (testMode.includes("logging")) {
      write({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          level: "info",
          logger: "test",
          data: "Log level set",
        },
      });
    }
    return;
  }

  if (request.method === "completion/complete") {
    const params = request.params as Record<string, unknown> | undefined;
    const argument = params?.argument as Record<string, unknown> | undefined;
    const value = (argument?.value as string) ?? "";
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        completion: {
          values: [`${value}completion1`, `${value}completion2`],
          hasMore: false,
          total: 2,
        },
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

async function* stdinStream(): AsyncGenerator<Uint8Array> {
  const buf = new Uint8Array(65536);
  const stdin = getPlatform().terminal.stdin;
  while (true) {
    const n = await stdin.read(buf);
    if (n === null) break;
    yield buf.slice(0, n);
  }
}

for await (const chunk of stdinStream()) {
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
