/**
 * MCP Tool Registration — Registers MCP server tools, resources, and prompts
 * into the HLVM dynamic tool registry.
 */

import { pooledMap } from "@std/async";
import { formatBytes } from "../../../common/limits.ts";
import { ValidationError } from "../../../common/error.ts";
import {
  generateUUID,
  getErrorMessage,
  isObjectValue,
} from "../../../common/utils.ts";
import { getAttachmentDisplayName } from "../../attachments/metadata.ts";
import { registerUploadedAttachment } from "../../attachments/service.ts";
import { getAgentLogger } from "../logger.ts";
import {
  type FormattedToolResult,
  registerTools,
  type ToolExecutionOptions,
  type ToolMetadata,
  type ToolPresentationKind,
  unregisterTool,
} from "../registry.ts";
import { sanitizeToolName } from "../tool-schema.ts";
import { createSdkMcpClient, SdkMcpClient } from "./sdk-client.ts";
import {
  dedupeServers,
  formatServerEntry,
  loadMcpConfigMultiScope,
  type McpScope,
  type McpServerWithScope,
} from "./config.ts";
import { capMcpDescription, sanitizeMcpText } from "./text-utils.ts";
import type {
  McpAttachmentRef,
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
const MCP_SIMPLE_SCHEMA_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "integer",
  "null",
]);

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
    const type = typeof value.type === "string"
      ? value.type === "array" &&
          isObjectValue(value.items) &&
          typeof value.items.type === "string"
        ? `${value.items.type}[]`
        : value.type
      : "any";
    const description = typeof value.description === "string"
      ? value.description
      : "MCP tool argument";
    args[key] = requiredSet.has(key)
      ? `${type} - ${description}`
      : `${type} (optional) - ${description}`;
  }
  return args;
}

function isRepresentableMcpPropertySchema(
  value: Record<string, unknown>,
): boolean {
  if (
    "oneOf" in value || "anyOf" in value || "allOf" in value ||
    "patternProperties" in value || "not" in value
  ) {
    return false;
  }
  const type = typeof value.type === "string" ? value.type : undefined;
  if (!type) return false;
  if (MCP_SIMPLE_SCHEMA_TYPES.has(type)) {
    return true;
  }
  if (type === "array") {
    if (!value.items) return true;
    if (!isObjectValue(value.items)) return false;
    const itemType = typeof value.items.type === "string"
      ? value.items.type
      : undefined;
    return Boolean(itemType && MCP_SIMPLE_SCHEMA_TYPES.has(itemType));
  }
  if (type === "object") {
    return !("properties" in value) && !("additionalProperties" in value);
  }
  return false;
}

function supportsStrictMcpValidation(
  schema?: Record<string, unknown>,
): boolean {
  if (!schema || !isObjectValue(schema)) return false;
  if (
    schema.type !== "object" ||
    "oneOf" in schema ||
    "anyOf" in schema ||
    "allOf" in schema ||
    "patternProperties" in schema ||
    "not" in schema ||
    schema.additionalProperties === true
  ) {
    return false;
  }
  const properties = isObjectValue(schema.properties)
    ? schema.properties as Record<string, unknown>
    : null;
  if (!properties) return false;
  return Object.values(properties).every((value) =>
    isObjectValue(value) && isRepresentableMcpPropertySchema(value)
  );
}

function inferMcpPresentationKind(
  toolName: string,
  description?: string,
): ToolPresentationKind {
  const text = `${toolName} ${description ?? ""}`
    .toLowerCase()
    .replace(/[_/.-]+/g, " ");
  if (/\b(diff|patch)\b/.test(text)) return "diff";
  if (
    /\b(edit|write|create|update|delete|remove|modify|click|type|press|submit)\b/
      .test(text)
  ) {
    return "edit";
  }
  if (/\b(shell|terminal|command|exec|run)\b/.test(text)) {
    return "shell";
  }
  if (/\b(web|browser|url|page|render|screenshot|navigate)\b/.test(text)) {
    return "web";
  }
  if (/\b(search|find|query|grep|lookup)\b/.test(text)) {
    return "search";
  }
  if (/\b(read|list|get|fetch|inspect|describe|status)\b/.test(text)) {
    return "read";
  }
  return "meta";
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
// MCP Tool Call Wrappers
// ============================================================

const MCP_TOOL_TIMEOUT_MS = 60_000;
const MCP_TOOL_PROGRESS_INTERVAL_MS = 30_000;
const MCP_OUTPUT_MAX_TOKENS = 25_000;

async function registerMcpAttachment(
  source: McpAttachmentRef["source"],
  index: number,
  mimeType: string,
  data: string,
  resourceUri?: string,
): Promise<McpAttachmentRef | null> {
  try {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const record = await registerUploadedAttachment({
      fileName: `mcp-${source}-${index}`,
      bytes,
      mimeType,
    });
    return {
      attachmentId: record.id,
      fileName: record.fileName,
      mimeType: record.mimeType,
      kind: record.kind,
      size: record.size,
      source,
      label: getAttachmentDisplayName(record.kind, index),
      ...(resourceUri ? { resourceUri } : {}),
    };
  } catch (error) {
    getAgentLogger().debug(
      `MCP attachment materialization failed (${source}): ${
        getErrorMessage(error)
      }`,
    );
    return null;
  }
}

function formatAttachmentSummary(ref: McpAttachmentRef): string {
  return `${ref.label} ${ref.fileName} (${ref.mimeType}, ${
    formatBytes(ref.size)
  })`;
}

function nextAttachment(
  attachments: readonly McpAttachmentRef[] | undefined,
  cursor: { index: number },
): McpAttachmentRef | null {
  if (!attachments || cursor.index >= attachments.length) return null;
  const attachment = attachments[cursor.index];
  cursor.index += 1;
  return attachment ?? null;
}

async function materializeMcpContent(
  content: unknown,
): Promise<{ text: string; attachments: McpAttachmentRef[] }> {
  if (typeof content === "string") {
    return { text: sanitizeMcpText(content), attachments: [] };
  }
  if (!Array.isArray(content)) {
    return {
      text: typeof content === "object" && content !== null
        ? sanitizeMcpText(JSON.stringify(content))
        : sanitizeMcpText(String(content ?? "")),
      attachments: [],
    };
  }

  const lines: string[] = [];
  const attachments: McpAttachmentRef[] = [];
  let attachmentIndex = 1;

  for (const item of content) {
    if (!isObjectValue(item)) {
      lines.push(sanitizeMcpText(String(item)));
      continue;
    }
    const part = item as Record<string, unknown>;
    if (part.type === "text" && typeof part.text === "string") {
      lines.push(sanitizeMcpText(part.text));
      continue;
    }
    if (
      (part.type === "image" || part.type === "audio") &&
      typeof part.data === "string"
    ) {
      const mimeType = typeof part.mimeType === "string"
        ? part.mimeType
        : "application/octet-stream";
      const ref = await registerMcpAttachment(
        "tool",
        attachmentIndex,
        mimeType,
        part.data,
      );
      attachmentIndex += 1;
      if (ref) {
        attachments.push(ref);
        lines.push(formatAttachmentSummary(ref));
      } else {
        lines.push(`[attachment: ${mimeType}]`);
      }
      continue;
    }
    if (part.type === "resource") {
      const resource = isObjectValue(part.resource)
        ? part.resource as Record<string, unknown>
        : null;
      const uri = typeof resource?.uri === "string" ? resource.uri : "unknown";
      const text = typeof resource?.text === "string"
        ? sanitizeMcpText(resource.text)
        : "";
      const mimeType = typeof resource?.mimeType === "string"
        ? resource.mimeType
        : "application/octet-stream";
      const blob = typeof resource?.blob === "string" ? resource.blob : null;
      if (blob) {
        const ref = await registerMcpAttachment(
          "resource",
          attachmentIndex,
          mimeType,
          blob,
          uri,
        );
        attachmentIndex += 1;
        if (ref) {
          attachments.push(ref);
          lines.push(`[resource: ${uri}] ${formatAttachmentSummary(ref)}`);
        } else {
          lines.push(`[resource: ${uri}] [attachment: ${mimeType}]`);
        }
      }
      if (text) {
        lines.push(`[resource: ${uri}] ${text}`);
      } else if (!blob) {
        lines.push(`[resource: ${uri}]`);
      }
      continue;
    }
    lines.push(sanitizeMcpText(JSON.stringify(part)));
  }

  return { text: lines.join("\n"), attachments };
}

function formatMcpContentPreview(
  content: unknown,
  attachments?: readonly McpAttachmentRef[],
): string {
  if (typeof content === "string") return sanitizeMcpText(content);
  if (!Array.isArray(content)) {
    return typeof content === "object" && content !== null
      ? sanitizeMcpText(JSON.stringify(content))
      : sanitizeMcpText(String(content ?? ""));
  }
  const cursor = { index: 0 };
  return content.map((item) => {
    if (!isObjectValue(item)) return sanitizeMcpText(String(item));
    const part = item as Record<string, unknown>;
    if (part.type === "text" && typeof part.text === "string") {
      return sanitizeMcpText(part.text);
    }
    if (part.type === "image" || part.type === "audio") {
      const ref = nextAttachment(attachments, cursor);
      return ref
        ? formatAttachmentSummary(ref)
        : `[attachment: ${part.mimeType ?? "unknown"}]`;
    }
    if (part.type === "resource") {
      const resource = isObjectValue(part.resource)
        ? part.resource as Record<string, unknown>
        : null;
      const uri = typeof resource?.uri === "string" ? resource.uri : "unknown";
      const text = typeof resource?.text === "string"
        ? sanitizeMcpText(resource.text)
        : "";
      const blob = typeof resource?.blob === "string" ? resource.blob : null;
      const ref = blob ? nextAttachment(attachments, cursor) : null;
      const segments = [
        `[resource: ${uri}]`,
        ...(ref ? [formatAttachmentSummary(ref)] : []),
        ...(text ? [text] : []),
      ];
      return segments.join(" ").trim();
    }
    return sanitizeMcpText(JSON.stringify(part));
  }).join("\n");
}

async function materializeResourceContents(
  contents: Array<
    { uri: string; mimeType?: string; text?: string; blob?: string }
  >,
): Promise<{
  contents: Array<
    { uri: string; mimeType?: string; text?: string; blob?: string }
  >;
  attachments?: McpAttachmentRef[];
}> {
  const attachments: McpAttachmentRef[] = [];
  let attachmentIndex = 1;
  for (const content of contents) {
    if (!content.blob) continue;
    const ref = await registerMcpAttachment(
      "resource",
      attachmentIndex,
      content.mimeType ?? "application/octet-stream",
      content.blob,
      content.uri,
    );
    attachmentIndex += 1;
    if (ref) attachments.push(ref);
  }
  return {
    contents,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

async function materializePromptMessages(
  messages: McpPromptMessage[],
): Promise<{
  messages: McpPromptMessage[];
  attachments?: McpAttachmentRef[];
}> {
  const attachments: McpAttachmentRef[] = [];
  let attachmentIndex = 1;
  for (const message of messages) {
    const content = message.content;
    if (
      ("data" in content) &&
      (content.type === "image" || content.type === "audio")
    ) {
      const ref = await registerMcpAttachment(
        "prompt",
        attachmentIndex,
        content.mimeType,
        content.data,
      );
      attachmentIndex += 1;
      if (ref) attachments.push(ref);
      continue;
    }
    if ("resource" in content && typeof content.resource.blob === "string") {
      const ref = await registerMcpAttachment(
        "resource",
        attachmentIndex,
        content.resource.mimeType ?? "application/octet-stream",
        content.resource.blob,
        content.resource.uri,
      );
      attachmentIndex += 1;
      if (ref) attachments.push(ref);
    }
  }
  return {
    messages,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function formatPromptMessages(
  messages: McpPromptMessage[],
  attachments?: readonly McpAttachmentRef[],
): string {
  const cursor = { index: 0 };
  return messages
    .map((message) => {
      const content = message.content;
      if ("text" in content) {
        return `[${message.role}] ${sanitizeMcpText(content.text)}`;
      }
      if (
        ("data" in content) &&
        (content.type === "image" || content.type === "audio")
      ) {
        const ref = nextAttachment(attachments, cursor);
        return `[${message.role}] ${
          ref
            ? formatAttachmentSummary(ref)
            : `[attachment: ${content.mimeType}]`
        }`;
      }
      if ("resource" in content) {
        const text = typeof content.resource.text === "string"
          ? sanitizeMcpText(content.resource.text)
          : "";
        const ref = typeof content.resource.blob === "string"
          ? nextAttachment(attachments, cursor)
          : null;
        const segments = [
          `[${message.role}] [resource: ${content.resource.uri}]`,
          ...(ref ? [formatAttachmentSummary(ref)] : []),
          ...(text ? [text] : []),
        ];
        return segments.join(" ").trim();
      }
      return `[${message.role}] (unknown content)`;
    })
    .join("\n");
}

/** Truncate MCP output to stay within token budget (heuristic: 1 token ≈ 4 chars) */
function truncateMcpOutput(
  text: string,
  maxTokens = MCP_OUTPUT_MAX_TOKENS,
): string {
  const estimatedTokens = Math.ceil(text.length / 4);
  if (estimatedTokens <= maxTokens) return text;
  const maxChars = maxTokens * 4;
  return text.slice(0, maxChars) +
    `\n\n[Output truncated: ~${estimatedTokens} estimated tokens, limit ${maxTokens}]`;
}

interface McpToolResult {
  /** Formatted + truncated text for error messages */
  content: string;
  /** Raw SDK result object (preserved for backward-compatible tool results) */
  raw: unknown;
  isError?: boolean;
}

/** Call an MCP tool with timeout, progress logging, and output truncation */
async function callMcpToolWithTimeout(
  client: SdkMcpClient,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs = MCP_TOOL_TIMEOUT_MS,
): Promise<McpToolResult> {
  const logger = getAgentLogger();
  const progressInterval = setInterval(() => {
    logger.info(`MCP: Still waiting for "${toolName}"...`);
  }, MCP_TOOL_PROGRESS_INTERVAL_MS);

  try {
    const result = await Promise.race([
      client.callTool(toolName, args, signal),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `MCP tool "${toolName}" timed out after ${timeoutMs}ms`,
              ),
            ),
          timeoutMs,
        )
      ),
    ]) as Record<string, unknown>;

    const materialized = await materializeMcpContent(result.content);
    const rawContent = materialized.text;
    const content = truncateMcpOutput(rawContent);
    const raw = materialized.attachments.length > 0
      ? { ...result, attachments: materialized.attachments }
      : result;

    return {
      content,
      raw,
      isError: result.isError === true ? true : undefined,
    };
  } finally {
    clearInterval(progressInterval);
  }
}

function extractMcpAttachments(
  result: unknown,
): McpAttachmentRef[] | undefined {
  if (!isObjectValue(result) || !Array.isArray(result.attachments)) {
    return undefined;
  }
  return result.attachments.filter((
    attachment,
  ): attachment is McpAttachmentRef =>
    isObjectValue(attachment) &&
    typeof attachment.attachmentId === "string" &&
    typeof attachment.fileName === "string" &&
    typeof attachment.mimeType === "string" &&
    typeof attachment.kind === "string" &&
    typeof attachment.size === "number" &&
    typeof attachment.source === "string" &&
    typeof attachment.label === "string"
  );
}

function summarizeMcpResult(
  text: string,
  attachments?: readonly McpAttachmentRef[],
): string {
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean);
  if (firstLine) return firstLine;
  if (attachments?.length) {
    return `MCP returned ${attachments.length} attachment(s).`;
  }
  return "MCP result";
}

function formatMcpToolExecutionResult(
  result: unknown,
): FormattedToolResult | null {
  if (!isObjectValue(result) || !("content" in result)) return null;
  const attachments = extractMcpAttachments(result);
  const body = truncateMcpOutput(
    formatMcpContentPreview(
      (result as Record<string, unknown>).content,
      attachments,
    ),
  );
  return {
    summaryDisplay: summarizeMcpResult(body, attachments),
    returnDisplay: body,
    llmContent: body,
  };
}

function formatMcpReadResourceResult(
  result: unknown,
): FormattedToolResult | null {
  if (!isObjectValue(result) || !Array.isArray(result.contents)) return null;
  const attachments = extractMcpAttachments(result);
  const body = truncateMcpOutput(
    result.contents.map((content) => {
      if (!isObjectValue(content)) return sanitizeMcpText(String(content));
      const uri = typeof content.uri === "string" ? content.uri : "unknown";
      const text = typeof content.text === "string"
        ? sanitizeMcpText(content.text)
        : "";
      if (typeof content.blob === "string") {
        const ref = attachments?.find((attachment) =>
          attachment.resourceUri === uri
        );
        return ref
          ? `[resource: ${uri}] ${formatAttachmentSummary(ref)}${
            text ? ` ${text}` : ""
          }`
          : `[resource: ${uri}]`;
      }
      return `[resource: ${uri}] ${text}`.trim();
    }).join("\n"),
  );
  return {
    summaryDisplay: summarizeMcpResult(body, attachments),
    returnDisplay: body,
    llmContent: body,
  };
}

function formatMcpPromptResult(
  result: unknown,
): FormattedToolResult | null {
  if (!isObjectValue(result) || !Array.isArray(result.messages)) return null;
  const attachments = extractMcpAttachments(result);
  const body = truncateMcpOutput(
    formatPromptMessages(result.messages as McpPromptMessage[], attachments),
  );
  return {
    summaryDisplay: summarizeMcpResult(body, attachments),
    returnDisplay: body,
    llmContent: body,
  };
}

// ============================================================
// Tool Entry Builder
// ============================================================

function buildToolEntry(
  client: SdkMcpClient,
  tool: McpToolInfo,
): ToolMetadata {
  const argsSchema = buildArgsSchema(tool.inputSchema);
  const skipValidation = Object.keys(argsSchema).length === 0 ||
    !supportsStrictMcpValidation(tool.inputSchema);
  const safetyLevel = inferMcpSafetyLevel(tool.name, tool.description);
  const presentationKind = inferMcpPresentationKind(
    tool.name,
    tool.description,
  );

  return {
    fn: async (
      args: unknown,
      _workspace: string,
      options?: ToolExecutionOptions,
    ) => {
      if (!isObjectValue(args)) {
        throw new ValidationError("args must be an object", "mcp");
      }
      const result = await callMcpToolWithTimeout(
        client,
        tool.name,
        args as Record<string, unknown>,
        options?.signal,
      );
      if (result.isError) {
        throw new ValidationError(
          `MCP tool "${tool.name}" returned error: ${result.content}`,
          "mcp",
        );
      }
      return result.raw;
    },
    description: capMcpDescription(tool.description) ?? `MCP tool ${tool.name}`,
    args: argsSchema,
    inputSchema: tool.inputSchema,
    skipValidation,
    execution: safetyLevel === "L0" ? { concurrencySafe: true } : undefined,
    presentation: { kind: presentationKind },
    safetyLevel,
    safety: inferMcpSafetyReason(safetyLevel),
    formatResult: formatMcpToolExecutionResult,
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
  disabledSet: Set<string> | null,
): void {
  const refreshRegisteredTools = async (): Promise<void> => {
    try {
      await refreshServerToolRegistration(
        client,
        server,
        registrationOwnerId,
        currentToolNames,
        disabledSet,
      );
    } catch {
      // Best-effort refresh.
    }
  };

  client.onReconnect(() => {
    void refreshRegisteredTools();
  });

  // tools/list_changed → re-list tools, unregister removed ones
  client.onNotification(
    "notifications/tools/list_changed",
    () => {
      void refreshRegisteredTools();
    },
  );

  // Resource/prompt list change notifications → refresh registered tools
  // (resources/prompts may contribute tool entries that need re-registration)
  client.onNotification("notifications/resources/list_changed", () => {
    getAgentLogger().debug(`MCP server '${server.name}' resources changed`);
    void refreshRegisteredTools();
  });
  client.onNotification("notifications/prompts/list_changed", () => {
    getAgentLogger().debug(`MCP server '${server.name}' prompts changed`);
    void refreshRegisteredTools();
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

function listEnabledMcpTools(
  allTools: readonly McpToolInfo[],
  server: McpServerConfig,
  disabledSet: Set<string> | null,
): McpToolInfo[] {
  if (!disabledSet) return [...allTools];
  const tools = allTools.filter((tool) => !disabledSet.has(tool.name));
  if (allTools.length !== tools.length) {
    getAgentLogger().debug(
      `MCP '${server.name}': filtered ${
        allTools.length - tools.length
      } disabled tool(s)`,
    );
  }
  return tools;
}

function buildMcpToolEntries(
  client: SdkMcpClient,
  server: McpServerConfig,
  tools: readonly McpToolInfo[],
): {
  entries: Record<string, ToolMetadata>;
  dynamicToolNames: Set<string>;
} {
  const entries: Record<string, ToolMetadata> = {};
  const dynamicToolNames = new Set<string>();
  for (const tool of tools) {
    const name = sanitizeToolName(`mcp_${server.name}_${tool.name}`);
    entries[name] = buildToolEntry(client, tool);
    dynamicToolNames.add(name);
  }
  return { entries, dynamicToolNames };
}

function reconcileRegisteredToolNames(
  registrationOwnerId: string,
  currentToolNames: Set<string>,
  nextToolNames: Set<string>,
): void {
  for (const old of currentToolNames) {
    if (!nextToolNames.has(old)) {
      unregisterTool(old, registrationOwnerId);
    }
  }
  currentToolNames.clear();
  for (const name of nextToolNames) {
    currentToolNames.add(name);
  }
}

async function refreshServerToolRegistration(
  client: SdkMcpClient,
  server: McpServerConfig,
  registrationOwnerId: string,
  currentToolNames: Set<string>,
  disabledSet: Set<string> | null,
): Promise<void> {
  const tools = listEnabledMcpTools(
    await client.listTools(),
    server,
    disabledSet,
  );
  const { entries, dynamicToolNames } = buildMcpToolEntries(
    client,
    server,
    tools,
  );
  reconcileRegisteredToolNames(
    registrationOwnerId,
    currentToolNames,
    dynamicToolNames,
  );
  registerTools(entries, registrationOwnerId);
}

// ============================================================
// Connection Timeout + Concurrency
// ============================================================

const MCP_CONNECT_TIMEOUT_MS = 5_000;
const MCP_CONNECT_CONCURRENCY = 3;

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  const error = new Error(
    typeof reason === "string" && reason.length > 0
      ? reason
      : "MCP operation aborted",
  );
  error.name = "AbortError";
  throw error;
}

/** Connect to an MCP server with a timeout. Returns null on timeout/error. */
async function connectWithTimeout(
  server: McpServerConfig,
  signal?: AbortSignal,
  options: { interactiveAuth?: boolean } = {},
): Promise<SdkMcpClient | null> {
  const timeoutMs = server.connection_timeout_ms ?? MCP_CONNECT_TIMEOUT_MS;
  throwIfAborted(signal);
  const connectPromise = createSdkMcpClient(server, signal, options);
  let didTimeout = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener = () => {};
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      didTimeout = true;
      reject(new Error(`MCP connect timeout (${timeoutMs}ms)`));
    }, timeoutMs);
  });
  const abortPromise = new Promise<never>((_, reject) => {
    if (!signal) return;
    const onAbort = () =>
      reject(signal.reason ?? new Error("MCP connect aborted"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });

  try {
    return await Promise.race([connectPromise, timeoutPromise, abortPromise]);
  } catch (error) {
    if (didTimeout || signal?.aborted) {
      // If connect eventually succeeds after timeout/abort, close immediately.
      void connectPromise.then((client) => client.close()).catch(() => {});
    }
    if (signal?.aborted) {
      throwIfAborted(signal);
    }
    warnMcpConnectSkip(server.name, error);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    removeAbortListener();
  }
}

/** Result of connecting and registering a single MCP server */
interface ServerRegistration {
  client: SdkMcpClient;
  names: string[];
  dynamicToolNames: Set<string>;
  connected: McpConnectedServer;
}

/** Connect to a server, list+register its tools/resources/prompts. */
async function connectAndRegisterServer(
  server: McpServerConfig,
  registrationOwnerId: string,
  signal?: AbortSignal,
): Promise<ServerRegistration | null> {
  const client = await connectWithTimeout(server, signal, {
    // Background tool discovery/execution must not surprise-open browser auth.
    interactiveAuth: false,
  });
  if (!client) return null;

  try {
    throwIfAborted(signal);
    const disabledSet = server.disabled_tools?.length
      ? new Set(server.disabled_tools)
      : null;
    const { entries, dynamicToolNames: serverToolNames } = buildMcpToolEntries(
      client,
      server,
      listEnabledMcpTools(
        await client.listTools(signal),
        server,
        disabledSet,
      ),
    );

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
          return await materializeResourceContents(contents);
        },
        description: `Read a resource by URI from MCP server '${server.name}'`,
        args: { uri: "string - Resource URI to read" },
        safetyLevel: "L0",
        safety: MCP_L0_SAFETY,
        formatResult: formatMcpReadResourceResult,
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
          return await materializePromptMessages(messages);
        },
        description:
          `Get a rendered prompt by name from MCP server '${server.name}'. Pass prompt arguments as additional fields.`,
        args: { name: "string - Prompt name" },
        skipValidation: true,
        safetyLevel: "L0",
        safety: MCP_L0_SAFETY,
        formatResult: formatMcpPromptResult,
      };
    }

    throwIfAborted(signal);
    const names = registerTools(entries, registrationOwnerId);
    return {
      client,
      names,
      dynamicToolNames: serverToolNames,
      connected: { name: server.name, toolCount: names.length },
    };
  } catch (error) {
    if (signal?.aborted) {
      await client.close().catch(() => {});
      throwIfAborted(signal);
    }
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
  signal?: AbortSignal,
): Promise<McpLoadResult> {
  const configServers = await loadMcpConfigMultiScope();
  const servers = dedupeServers([
    ...configServers,
    ...(extraServers ?? []),
  ]);
  return await loadMcpToolsForServers(servers, ownerId, signal);
}

function createEmptyMcpLoadResult(ownerId: string): McpLoadResult {
  return {
    tools: [],
    ownerId,
    connectedServers: [],
    dispose: async () => {},
    setHandlers: () => {},
    setSignal: () => {},
  };
}

export async function loadMcpToolsForServers(
  servers: readonly McpServerConfig[],
  ownerId?: string,
  signal?: AbortSignal,
): Promise<McpLoadResult> {
  const registrationOwnerId = ownerId ?? `mcp:${generateUUID()}`;
  if (servers.length === 0) {
    return createEmptyMcpLoadResult(registrationOwnerId);
  }

  const clients: SdkMcpClient[] = [];
  const registered: string[] = [];
  const dynamicToolSets: Set<string>[] = [];
  const connectedServers: McpConnectedServer[] = [];

  try {
    throwIfAborted(signal);

    // Connect servers with bounded concurrency and per-server timeout
    const results = pooledMap(
      MCP_CONNECT_CONCURRENCY,
      servers,
      (server) => connectAndRegisterServer(server, registrationOwnerId, signal),
    );
    for await (const result of results) {
      throwIfAborted(signal);
      if (result) {
        clients.push(result.client);
        registered.push(...result.names);
        dynamicToolSets.push(result.dynamicToolNames);
        connectedServers.push(result.connected);
      }
    }
  } catch (error) {
    for (const name of registered) unregisterTool(name, registrationOwnerId);
    for (const names of dynamicToolSets) {
      for (const name of names) unregisterTool(name, registrationOwnerId);
      names.clear();
    }
    for (const client of clients) {
      await client.close().catch(() => undefined);
    }
    clients.length = 0;
    throw error;
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
      // Unregister all tools (static + dynamically refreshed)
      for (const name of registered) unregisterTool(name, registrationOwnerId);
      for (const names of dynamicToolSets) {
        for (const name of names) unregisterTool(name, registrationOwnerId);
        names.clear();
      }
      // Close all clients (with timeout protection from 1E)
      for (const client of clients) await client.close();
      clients.length = 0;
    },
    setHandlers,
    setSignal,
  };
}
