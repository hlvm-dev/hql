/**
 * MCP Tool Registration — Registers MCP server tools, resources, and prompts
 * into the HLVM dynamic tool registry.
 */

import { ValidationError } from "../../../common/error.ts";
import {
  generateUUID,
  getErrorMessage,
  isObjectValue,
} from "../../../common/utils.ts";
import { getAgentLogger } from "../logger.ts";
import {
  registerTools,
  type ToolMetadata,
  unregisterTool,
} from "../registry.ts";
import { sanitizeToolName } from "../tool-schema.ts";
import { SdkMcpClient, createSdkMcpClient } from "./sdk-client.ts";
import {
  dedupeServers,
  loadMcpConfig,
  loadMcpConfigMultiScope,
} from "./config.ts";
import type {
  McpConnectedServer,
  McpElicitationRequest,
  McpHandlers,
  McpLoadResult,
  McpPromptMessage,
  McpSamplingRequest,
  McpServerConfig,
  McpToolInfo,
} from "./types.ts";

// ============================================================
// Safety Heuristics
// ============================================================

const MCP_READ_ONLY_HINTS = [
  /\bread\b/,
  /\blist\b/,
  /\bget\b/,
  /\bfetch\b/,
  /\bsearch\b/,
  /\bfind\b/,
  /\bquery\b/,
  /\binspect\b/,
  /\bdescribe\b/,
  /\bstatus\b/,
  /\brender\b/,
  /\bscreenshot\b/,
  /\becho\b/,
];

const MCP_MUTATING_HINTS = [
  /\bwrite\b/,
  /\bcreate\b/,
  /\bupdate\b/,
  /\bdelete\b/,
  /\bremove\b/,
  /\bdestroy\b/,
  /\bdrop\b/,
  /\binsert\b/,
  /\bmodify\b/,
  /\bpost\b/,
  /\bput\b/,
  /\bpatch\b/,
  /\bsend\b/,
  /\bexecute\b/,
  /\brun\b/,
  /\bstart\b/,
  /\bstop\b/,
  /\bkill\b/,
  /\brestart\b/,
  /\bclick\b/,
  /\btype\b/,
  /\bpress\b/,
  /\bsubmit\b/,
];

export function inferMcpSafetyLevel(
  toolName: string,
  description?: string,
): "L0" | "L1" | "L2" {
  const text = `${toolName} ${description ?? ""}`
    .toLowerCase()
    .replace(/[_/.-]+/g, " ");
  if (MCP_MUTATING_HINTS.some((p) => p.test(text))) return "L2";
  if (MCP_READ_ONLY_HINTS.some((p) => p.test(text))) return "L0";
  return "L1";
}

function inferMcpSafetyReason(level: "L0" | "L1" | "L2"): string {
  if (level === "L0") return "External MCP read-only tool (auto-approved).";
  if (level === "L1") {
    return "External MCP tool with low risk (confirm once per session).";
  }
  return "External MCP tool with possible side effects (always confirm).";
}

const MCP_L0_SAFETY = inferMcpSafetyReason("L0");

// ============================================================
// Schema Helpers
// ============================================================

function buildArgsSchema(
  schema?: Record<string, unknown>,
): Record<string, string> {
  if (!schema || !isObjectValue(schema)) return {};
  const properties = isObjectValue(schema.properties)
    ? schema.properties as Record<string, unknown>
    : null;
  if (!properties) return {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((v): v is string => typeof v === "string")
    : [];
  const requiredSet = new Set(required);

  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!isObjectValue(value)) {
      args[key] = requiredSet.has(key)
        ? "any - MCP tool argument"
        : "any (optional) - MCP tool argument";
      continue;
    }
    const type = typeof value.type === "string" ? value.type : "any";
    const description = typeof value.description === "string"
      ? value.description
      : "MCP tool argument";
    args[key] = requiredSet.has(key)
      ? `${type} - ${description}`
      : `${type} (optional) - ${description}`;
  }
  return args;
}

/** Format prompt messages into a readable string for tool results */
function formatPromptMessages(messages: McpPromptMessage[]): string {
  return messages
    .map((m) => {
      const content = m.content;
      if ("text" in content) return `[${m.role}] ${content.text}`;
      if ("data" in content) return `[${m.role}] [image: ${content.mimeType}]`;
      if ("resource" in content) {
        return `[${m.role}] [resource: ${content.resource.uri}] ${
          content.resource.text ?? "(binary)"
        }`;
      }
      return `[${m.role}] (unknown content)`;
    })
    .join("\n");
}

// ============================================================
// Tool Entry Builder
// ============================================================

function buildToolEntry(
  client: SdkMcpClient,
  tool: McpToolInfo,
): ToolMetadata {
  const argsSchema = buildArgsSchema(tool.inputSchema);
  const skipValidation = Object.keys(argsSchema).length === 0;
  const safetyLevel = inferMcpSafetyLevel(tool.name, tool.description);

  return {
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
    safetyLevel,
    safety: inferMcpSafetyReason(safetyLevel),
  };
}

// ============================================================
// Notification Handlers Registration
// ============================================================

function registerNotificationHandlers(
  client: SdkMcpClient,
  server: McpServerConfig,
  registrationOwnerId: string,
  currentToolNames: Set<string>,
): void {
  // tools/list_changed → re-list tools, unregister removed ones
  client.onNotification(
    "notifications/tools/list_changed",
    async () => {
      try {
        const newTools = await client.listTools();
        const entries: Record<string, ToolMetadata> = {};
        const newNames = new Set<string>();
        for (const tool of newTools) {
          const name = sanitizeToolName(`mcp_${server.name}_${tool.name}`);
          entries[name] = buildToolEntry(client, tool);
          newNames.add(name);
        }
        // Unregister tools that were removed from the server
        for (const old of currentToolNames) {
          if (!newNames.has(old)) {
            unregisterTool(old, registrationOwnerId);
          }
        }
        registerTools(entries, registrationOwnerId);
        // Update tracked names
        currentToolNames.clear();
        for (const n of newNames) currentToolNames.add(n);
      } catch {
        // Best-effort re-list
      }
    },
  );

  // Resource/prompt list change notifications (informational)
  client.onNotification("notifications/resources/list_changed", () => {
    getAgentLogger().debug(`MCP server '${server.name}' resources changed`);
  });
  client.onNotification("notifications/prompts/list_changed", () => {
    getAgentLogger().debug(`MCP server '${server.name}' prompts changed`);
  });

  // Logging notification
  client.onNotification("notifications/message", (params: unknown) => {
    if (!isObjectValue(params)) return;
    const p = params as Record<string, unknown>;
    const level = typeof p.level === "string" ? p.level : "info";
    const data = typeof p.data === "string" ? p.data : JSON.stringify(p.data);
    const logger = getAgentLogger();
    const prefix = `[MCP:${server.name}]`;
    switch (level) {
      case "error":
      case "critical":
      case "alert":
      case "emergency":
        logger.error(`${prefix} ${data}`);
        break;
      case "warning":
        logger.warn(`${prefix} ${data}`);
        break;
      case "debug":
        logger.debug(`${prefix} ${data}`);
        break;
      default:
        logger.info(`${prefix} ${data}`);
    }
  });

  // Progress notification
  client.onNotification("notifications/progress", (params: unknown) => {
    if (!isObjectValue(params)) return;
    const p = params as Record<string, unknown>;
    getAgentLogger().debug(
      `[MCP:${server.name}] progress: ${p.progress}/${p.total ?? "?"}${
        typeof p.message === "string" ? ` - ${p.message}` : ""
      }`,
    );
  });

  // Cancelled notification
  client.onNotification("notifications/cancelled", (params: unknown) => {
    if (!isObjectValue(params)) return;
    const p = params as Record<string, unknown>;
    if (typeof p.requestId === "number") {
      getAgentLogger().debug(
        `[MCP:${server.name}] server cancelled request ${p.requestId}`,
      );
    }
  });

  // Resource updated notification
  client.onNotification(
    "notifications/resources/updated",
    (params: unknown) => {
      if (!isObjectValue(params)) return;
      const p = params as Record<string, unknown>;
      getAgentLogger().debug(
        `[MCP:${server.name}] resource updated: ${p.uri}`,
      );
    },
  );

  // Server ping requests
  client.onRequest("ping", async () => await Promise.resolve({}));
}

// ============================================================
// Main Load Function
// ============================================================

export async function loadMcpTools(
  workspace: string,
  configPath?: string,
  extraServers?: McpServerConfig[],
  ownerId?: string,
): Promise<McpLoadResult> {
  const registrationOwnerId = ownerId ?? `mcp:${generateUUID()}`;

  // Use multi-scope loading (user + project + .mcp.json + claude-code) unless an explicit config path is given
  let configServers: McpServerConfig[];
  if (configPath) {
    const config = await loadMcpConfig(workspace, configPath);
    configServers = config?.servers ?? [];
  } else {
    configServers = await loadMcpConfigMultiScope(workspace);
  }
  const servers = dedupeServers([
    ...configServers,
    ...(extraServers ?? []),
  ]);
  if (servers.length === 0) {
    return {
      tools: [],
      ownerId: registrationOwnerId,
      connectedServers: [],
      dispose: async () => {},
      setHandlers: () => {},
      setSignal: () => {},
    };
  }

  const clients: SdkMcpClient[] = [];
  const registered: string[] = [];
  const connectedServers: McpConnectedServer[] = [];

  for (const server of servers) {
    try {
      const client = await createSdkMcpClient(server);

      // Register tools
      const tools = await client.listTools();
      const entries: Record<string, ToolMetadata> = {};
      const serverToolNames = new Set<string>();
      for (const tool of tools) {
        const name = sanitizeToolName(`mcp_${server.name}_${tool.name}`);
        entries[name] = buildToolEntry(client, tool);
        serverToolNames.add(name);
      }

      registerNotificationHandlers(
        client,
        server,
        registrationOwnerId,
        serverToolNames,
      );

      // Conditionally register resource tools
      if (client.hasCapability("resources")) {
        entries[sanitizeToolName(`mcp_${server.name}_list_resources`)] = {
          fn: async () => {
            const resources = await client.listResources();
            return { resources };
          },
          description:
            `List available resources from MCP server '${server.name}'`,
          args: {},
          skipValidation: true,
          safetyLevel: "L0",
          safety: MCP_L0_SAFETY,
        };
        entries[sanitizeToolName(`mcp_${server.name}_read_resource`)] = {
          fn: async (args: unknown) => {
            if (!isObjectValue(args)) {
              throw new ValidationError("args must be an object", "mcp");
            }
            const a = args as Record<string, unknown>;
            if (typeof a.uri !== "string") {
              throw new ValidationError("uri must be a string", "mcp");
            }
            const contents = await client.readResource(a.uri);
            return { contents };
          },
          description:
            `Read a resource by URI from MCP server '${server.name}'`,
          args: { uri: "string - Resource URI to read" },
          safetyLevel: "L0",
          safety: MCP_L0_SAFETY,
        };
      }

      // Conditionally register prompt tools
      if (client.hasCapability("prompts")) {
        entries[sanitizeToolName(`mcp_${server.name}_list_prompts`)] = {
          fn: async () => {
            const prompts = await client.listPrompts();
            return { prompts };
          },
          description:
            `List available prompts from MCP server '${server.name}'`,
          args: {},
          skipValidation: true,
          safetyLevel: "L0",
          safety: MCP_L0_SAFETY,
        };
        entries[sanitizeToolName(`mcp_${server.name}_get_prompt`)] = {
          fn: async (args: unknown) => {
            if (!isObjectValue(args)) {
              throw new ValidationError("args must be an object", "mcp");
            }
            const a = args as Record<string, unknown>;
            if (typeof a.name !== "string") {
              throw new ValidationError("name must be a string", "mcp");
            }
            const promptArgs: Record<string, string> = {};
            for (const [k, v] of Object.entries(a)) {
              if (k !== "name" && typeof v === "string") {
                promptArgs[k] = v;
              }
            }
            const messages = await client.getPrompt(
              a.name,
              Object.keys(promptArgs).length > 0 ? promptArgs : undefined,
            );
            return { messages: formatPromptMessages(messages) };
          },
          description:
            `Get a rendered prompt by name from MCP server '${server.name}'. Pass prompt arguments as additional fields.`,
          args: { name: "string - Prompt name" },
          skipValidation: true,
          safetyLevel: "L0",
          safety: MCP_L0_SAFETY,
        };
      }

      const names = registerTools(entries, registrationOwnerId);
      registered.push(...names);
      clients.push(client);
      connectedServers.push({ name: server.name, toolCount: names.length });
    } catch (error) {
      getAgentLogger().warn(
        `Skipping MCP server '${server.name}': ${getErrorMessage(error)}`,
      );
      // Client cleanup is handled by createSdkMcpClient on connect failure
    }
  }

  // Deferred handler setter for sampling, elicitation, roots
  const setHandlers = (handlers: McpHandlers) => {
    for (const client of clients) {
      if (handlers.onSampling) {
        const samplingHandler = handlers.onSampling;
        client.onRequest("sampling/createMessage", async (params: unknown) => {
          return await samplingHandler(params as McpSamplingRequest);
        });
      }
      if (handlers.onElicitation) {
        const elicitationHandler = handlers.onElicitation;
        client.onRequest("elicitation/create", async (params: unknown) => {
          return await elicitationHandler(params as McpElicitationRequest);
        });
      }
      if (handlers.roots && handlers.roots.length > 0) {
        const roots = handlers.roots;
        client.onRequest(
          "roots/list",
          async () =>
            await Promise.resolve({
              roots: roots.map((uri) => ({ uri })),
            }),
        );
      }
    }
  };

  // Wire AbortSignal to cancel all pending requests across all clients
  const setSignal = (signal: AbortSignal) => {
    const onAbort = () => {
      for (const client of clients) {
        client.cancelAllPending("Agent aborted");
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
  };

  return {
    tools: registered,
    ownerId: registrationOwnerId,
    connectedServers,
    dispose: async () => {
      for (const name of registered) unregisterTool(name, registrationOwnerId);
      for (const client of clients) await client.close();
    },
    setHandlers,
    setSignal,
  };
}
