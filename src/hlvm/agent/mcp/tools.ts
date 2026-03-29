/**
 * MCP Tool Registration — Registers MCP server tools, resources, and prompts
 * into the HLVM dynamic tool registry.
 */

import { pooledMap } from "@std/async";
import { ValidationError } from "../../../common/error.ts";
import {
  generateUUID,
  getErrorMessage,
  isObjectValue,
} from "../../../common/utils.ts";
import { getAgentLogger } from "../logger.ts";
import {
  registerTools,
  type ToolExecutionOptions,
  type ToolMetadata,
  unregisterTool,
} from "../registry.ts";
import {
  readSemanticCapabilitiesFromMetadata,
  type SemanticCapabilityId,
} from "../semantic-capabilities.ts";
import { sanitizeToolName } from "../tool-schema.ts";
import { createSdkMcpClient, SdkMcpClient } from "./sdk-client.ts";
import {
  dedupeServers,
  formatServerEntry,
  loadMcpConfigMultiScope,
  type McpScope,
  type McpServerWithScope,
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

const MCP_READ_ONLY_RE =
  /\b(read|list|get|fetch|search|find|query|inspect|describe|status|render|screenshot|echo)\b/;
const MCP_MUTATING_RE =
  /\b(write|create|update|delete|remove|destroy|drop|insert|modify|post|put|patch|send|execute|run|start|stop|kill|restart|click|type|press|submit)\b/;

export function inferMcpSafetyLevel(
  toolName: string,
  description?: string,
): "L0" | "L1" | "L2" {
  const text = `${toolName} ${description ?? ""}`
    .toLowerCase()
    .replace(/[_/.-]+/g, " ");
  if (MCP_MUTATING_RE.test(text)) return "L2";
  if (MCP_READ_ONLY_RE.test(text)) return "L0";
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
const MCP_CONNECT_WARNING_MAX_CHARS = 240;

// Process-lifetime de-duplication for noisy startup/connect warnings.
const seenMcpConnectWarnings = new Set<string>();

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

function summarizeConnectError(error: unknown): string {
  const normalized = getErrorMessage(error).replace(/\s+/g, " ").trim();
  if (normalized.length <= MCP_CONNECT_WARNING_MAX_CHARS) return normalized;
  return `${normalized.slice(0, MCP_CONNECT_WARNING_MAX_CHARS)}...`;
}

/** Emit a deduplicated warning (or debug) for an MCP server connect/register failure. */
function warnMcpConnectSkip(serverName: string, error: unknown): void {
  const summary = summarizeConnectError(error);
  const warningKey = `${serverName}::${summary}`;
  if (!seenMcpConnectWarnings.has(warningKey)) {
    seenMcpConnectWarnings.add(warningKey);
    getAgentLogger().warn(
      `Skipping MCP server '${serverName}': ${summary}`,
    );
  } else {
    getAgentLogger().debug(
      `MCP server '${serverName}' skip repeated`,
    );
  }
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
  const semanticCapabilities = resolveMcpSemanticCapabilities(tool);

  return {
    fn: async (
      args: unknown,
      _workspace: string,
      options?: ToolExecutionOptions,
    ) => {
      if (!isObjectValue(args)) {
        throw new ValidationError("args must be an object", "mcp");
      }
      return await client.callTool(
        tool.name,
        args as Record<string, unknown>,
        options?.signal,
      );
    },
    description: tool.description ?? `MCP tool ${tool.name}`,
    args: argsSchema,
    skipValidation,
    safetyLevel,
    safety: inferMcpSafetyReason(safetyLevel),
    semanticCapabilities,
  };
}

function resolveMcpSemanticCapabilities(
  tool: Pick<McpToolInfo, "metadata" | "annotations">,
): SemanticCapabilityId[] | undefined {
  return readSemanticCapabilitiesFromMetadata(tool.metadata) ??
    readSemanticCapabilitiesFromMetadata(tool.annotations);
}

// ============================================================
// Notification Handlers Registration
// ============================================================

function registerNotificationHandlers(
  client: SdkMcpClient,
  server: McpServerConfig,
  registrationOwnerId: string,
  currentToolNames: Set<string>,
  disabledSet: Set<string> | null,
): void {
  // tools/list_changed → re-list tools, unregister removed ones
  client.onNotification(
    "notifications/tools/list_changed",
    async () => {
      try {
        const allTools = await client.listTools();
        const newTools = disabledSet
          ? allTools.filter((t) => !disabledSet.has(t.name))
          : allTools;
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
// Connection Timeout + Concurrency
// ============================================================

const MCP_CONNECT_TIMEOUT_MS = 5_000;
const MCP_CONNECT_CONCURRENCY = 3;

/** Connect to an MCP server with a timeout. Returns null on timeout/error. */
async function connectWithTimeout(
  server: McpServerConfig,
): Promise<SdkMcpClient | null> {
  const timeoutMs = server.connection_timeout_ms ?? MCP_CONNECT_TIMEOUT_MS;
  const connectPromise = createSdkMcpClient(server);
  let didTimeout = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      didTimeout = true;
      reject(new Error(`MCP connect timeout (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([connectPromise, timeoutPromise]);
  } catch (error) {
    if (didTimeout) {
      // If connect eventually succeeds after timeout, close immediately.
      void connectPromise.then((client) => client.close()).catch(() => {});
    }
    warnMcpConnectSkip(server.name, error);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Result of connecting and registering a single MCP server */
interface ServerRegistration {
  client: SdkMcpClient;
  names: string[];
  connected: McpConnectedServer;
}

export interface McpCapabilityInspectionTool {
  rawToolName: string;
  registeredToolName: string;
  semanticCapabilities: SemanticCapabilityId[];
}

export interface McpCapabilityInspectionServer {
  name: string;
  scope: McpScope;
  scopeLabel: string;
  transport: "http" | "stdio";
  target: string;
  reachable: boolean;
  toolCount: number;
  contributingTools: McpCapabilityInspectionTool[];
  reason?: string;
}

/** Connect to a server, list+register its tools/resources/prompts. */
async function connectAndRegisterServer(
  server: McpServerConfig,
  registrationOwnerId: string,
): Promise<ServerRegistration | null> {
  const client = await connectWithTimeout(server);
  if (!client) return null;

  try {
    // List tools (filter disabled_tools if configured)
    const allTools = await client.listTools();
    const disabledSet = server.disabled_tools?.length
      ? new Set(server.disabled_tools)
      : null;
    const tools = disabledSet
      ? allTools.filter((t) => !disabledSet.has(t.name))
      : allTools;
    if (disabledSet && allTools.length !== tools.length) {
      getAgentLogger().debug(
        `MCP '${server.name}': filtered ${
          allTools.length - tools.length
        } disabled tool(s)`,
      );
    }

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
      disabledSet,
    );

    // Conditionally register resource tools
    if (client.hasCapability("resources")) {
      entries[sanitizeToolName(`mcp_${server.name}_list_resources`)] = {
        fn: async (
          _args: unknown,
          _workspace: string,
          options?: ToolExecutionOptions,
        ) => {
          const resources = await client.listResources(options?.signal);
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
        fn: async (
          args: unknown,
          _workspace: string,
          options?: ToolExecutionOptions,
        ) => {
          if (!isObjectValue(args)) {
            throw new ValidationError("args must be an object", "mcp");
          }
          const a = args as Record<string, unknown>;
          if (typeof a.uri !== "string") {
            throw new ValidationError("uri must be a string", "mcp");
          }
          const contents = await client.readResource(a.uri, options?.signal);
          return { contents };
        },
        description: `Read a resource by URI from MCP server '${server.name}'`,
        args: { uri: "string - Resource URI to read" },
        safetyLevel: "L0",
        safety: MCP_L0_SAFETY,
      };
    }

    // Conditionally register prompt tools
    if (client.hasCapability("prompts")) {
      entries[sanitizeToolName(`mcp_${server.name}_list_prompts`)] = {
        fn: async (
          _args: unknown,
          _workspace: string,
          options?: ToolExecutionOptions,
        ) => {
          const prompts = await client.listPrompts(options?.signal);
          return { prompts };
        },
        description: `List available prompts from MCP server '${server.name}'`,
        args: {},
        skipValidation: true,
        safetyLevel: "L0",
        safety: MCP_L0_SAFETY,
      };
      entries[sanitizeToolName(`mcp_${server.name}_get_prompt`)] = {
        fn: async (
          args: unknown,
          _workspace: string,
          options?: ToolExecutionOptions,
        ) => {
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
            options?.signal,
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
    return {
      client,
      names,
      connected: { name: server.name, toolCount: names.length },
    };
  } catch (error) {
    // Tool listing/registration failed after connect — clean up client
    await client.close().catch(() => {});
    warnMcpConnectSkip(server.name, error);
    return null;
  }
}

// ============================================================
// Main Load Function
// ============================================================

export async function loadMcpTools(
  _workspace: string,
  extraServers?: McpServerConfig[],
  ownerId?: string,
): Promise<McpLoadResult> {
  const registrationOwnerId = ownerId ?? `mcp:${generateUUID()}`;
  const configServers = await loadMcpConfigMultiScope();
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

  // Connect servers with bounded concurrency and per-server timeout
  const results = pooledMap(
    MCP_CONNECT_CONCURRENCY,
    servers,
    (server) => connectAndRegisterServer(server, registrationOwnerId),
  );
  for await (const result of results) {
    if (result) {
      clients.push(result.client);
      registered.push(...result.names);
      connectedServers.push(result.connected);
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
    if (signal.aborted) {
      onAbort();
      return;
    }
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

async function inspectMcpServer(
  server: McpServerWithScope,
): Promise<McpCapabilityInspectionServer> {
  const entry = formatServerEntry(server);
  const fallback: McpCapabilityInspectionServer = {
    name: server.name,
    scope: server.scope,
    scopeLabel: entry.scopeLabel,
    transport: server.url ? "http" : "stdio",
    target: entry.target,
    reachable: false,
    toolCount: 0,
    contributingTools: [],
    reason: "connection unavailable",
  };
  const client = await connectWithTimeout(server);
  if (!client) return fallback;

  try {
    const disabledSet = server.disabled_tools?.length
      ? new Set(server.disabled_tools)
      : null;
    const allTools = await client.listTools();
    const tools = disabledSet
      ? allTools.filter((tool) => !disabledSet.has(tool.name))
      : allTools;
    const contributingTools = tools.flatMap((tool) => {
      const semanticCapabilities = resolveMcpSemanticCapabilities(tool);
      if (!semanticCapabilities?.length) return [];
      return [{
        rawToolName: tool.name,
        registeredToolName: sanitizeToolName(`mcp_${server.name}_${tool.name}`),
        semanticCapabilities,
      }];
    });

    return {
      name: server.name,
      scope: server.scope,
      scopeLabel: entry.scopeLabel,
      transport: server.url ? "http" : "stdio",
      target: entry.target,
      reachable: true,
      toolCount: tools.length,
      contributingTools,
    };
  } catch (error) {
    warnMcpConnectSkip(server.name, error);
    return {
      ...fallback,
      reason: summarizeConnectError(error),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function inspectMcpServersForCapabilities(
  extraServers?: McpServerConfig[],
): Promise<McpCapabilityInspectionServer[]> {
  const configServers = await loadMcpConfigMultiScope();
  const merged = dedupeServers([
    ...configServers,
    ...(extraServers ?? []).map((server) => ({
      ...server,
      scope: "user" as const,
    })),
  ]);
  if (merged.length === 0) return [];

  const results = pooledMap(
    MCP_CONNECT_CONCURRENCY,
    merged,
    (server) => inspectMcpServer(server as McpServerWithScope),
  );
  const servers: McpCapabilityInspectionServer[] = [];
  for await (const result of results) {
    servers.push(result);
  }
  return servers;
}
