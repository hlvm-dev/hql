import { parseFrontmatter } from "../../../common/frontmatter.ts";
import { PERMISSION_MODES_SET } from "../../../common/config/types.ts";
import { getErrorMessage, isObjectValue } from "../../../common/utils.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { getUserAgentsDir } from "../../../common/paths.ts";
import { getAgentLogger } from "../logger.ts";
import type { AgentExecutionMode } from "../execution-mode.ts";
import type {
  AgentDefinition,
  AgentDefinitionsResult,
  AgentMcpServerSpec,
  CustomAgentDefinition,
} from "./agent-types.ts";
import { getBuiltInAgents } from "./built-in-agents.ts";
import type { McpServerConfig } from "../mcp/types.ts";

const log = getAgentLogger();

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function normalizeStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!isObjectValue(value)) return undefined;
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, entryValue]) => [key, entryValue.trim()] as const)
    .filter((entry) => entry[1].length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeMcpServerConfig(
  value: unknown,
): Omit<McpServerConfig, "name"> | null {
  if (!isObjectValue(value)) return null;

  const command = normalizeStringArray(value.command);
  const url = typeof value.url === "string" && value.url.trim().length > 0
    ? value.url.trim()
    : undefined;
  if (!command && !url) {
    return null;
  }

  const cwd = typeof value.cwd === "string" && value.cwd.trim().length > 0
    ? value.cwd.trim()
    : undefined;
  const transport = value.transport === "stdio" || value.transport === "http" ||
      value.transport === "sse"
    ? value.transport
    : undefined;
  const headers = normalizeStringRecord(value.headers);
  const env = normalizeStringRecord(value.env);
  const disabled_tools = normalizeStringArray(value.disabled_tools);
  const connection_timeout_ms =
    typeof value.connection_timeout_ms === "number" &&
      Number.isFinite(value.connection_timeout_ms) &&
      value.connection_timeout_ms > 0
      ? Math.floor(value.connection_timeout_ms)
      : undefined;

  return {
    ...(command ? { command } : {}),
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {}),
    ...(url ? { url } : {}),
    ...(transport ? { transport } : {}),
    ...(headers ? { headers } : {}),
    ...(disabled_tools ? { disabled_tools } : {}),
    ...(connection_timeout_ms ? { connection_timeout_ms } : {}),
  };
}

function normalizeAgentMcpServerSpec(
  value: unknown,
): AgentMcpServerSpec | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (!isObjectValue(value)) return null;

  const entries = Object.entries(value);
  if (entries.length !== 1) return null;
  const [serverName, serverConfig] = entries[0]!;
  if (serverName.trim().length === 0) return null;

  const normalizedConfig = normalizeMcpServerConfig(serverConfig);
  if (!normalizedConfig) return null;
  return { [serverName.trim()]: normalizedConfig };
}

// ============================================================
// Frontmatter Parsing (CC: parseAgentFromMarkdown)
// ============================================================

/**
 * Parse a .md file into a CustomAgentDefinition.
 * CC: parseAgentFromMarkdown() — simplified (no plugins, no memory, no hooks)
 *
 * Required frontmatter: name, description
 * Optional: tools, disallowedTools, model, maxTurns, background, isolation,
 * initialPrompt, permissionMode, mcpServers
 */
type ParseAgentResult =
  | { ok: true; agent: CustomAgentDefinition }
  | { ok: false; reason: string };

function parseAgentFromMarkdownDetailed(
  filePath: string,
  content: string,
  source: "user",
): ParseAgentResult {
  try {
    const { meta, body } = parseFrontmatter<Record<string, unknown>>(content);
    if (!meta) {
      return { ok: false, reason: "frontmatter YAML failed to parse" };
    }

    const agentType = meta["name"];
    const whenToUse = meta["description"];

    if (!agentType || typeof agentType !== "string") {
      return {
        ok: false,
        reason: "missing or non-string 'name' in frontmatter",
      };
    }
    if (!whenToUse || typeof whenToUse !== "string") {
      return {
        ok: false,
        reason: "missing or non-string 'description' in frontmatter",
      };
    }

    // Parse optional fields (CC pattern: validate and log, don't throw)
    const modelRaw = meta["model"];
    let model: string | undefined;
    if (typeof modelRaw === "string" && modelRaw.trim().length > 0) {
      const trimmed = modelRaw.trim();
      model = trimmed.toLowerCase() === "inherit" ? "inherit" : trimmed;
    }

    // Parse tools / disallowedTools
    const tools = normalizeStringArray(meta["tools"]);
    const disallowedTools = normalizeStringArray(meta["disallowedTools"]);

    // Parse maxTurns
    const maxTurnsRaw = meta["maxTurns"];
    let maxTurns: number | undefined;
    if (
      typeof maxTurnsRaw === "number" && Number.isInteger(maxTurnsRaw) &&
      maxTurnsRaw > 0
    ) {
      maxTurns = maxTurnsRaw;
    }

    // Parse background
    const backgroundRaw = meta["background"];
    const background = backgroundRaw === true || backgroundRaw === "true"
      ? true
      : undefined;

    // Parse isolation
    const isolationRaw = meta["isolation"];
    const isolation = isolationRaw === "worktree"
      ? "worktree" as const
      : undefined;

    // Parse permissionMode
    const permissionModeRaw = meta["permissionMode"];
    const permissionMode = typeof permissionModeRaw === "string" &&
        PERMISSION_MODES_SET.has(permissionModeRaw)
      ? permissionModeRaw as AgentExecutionMode
      : undefined;
    if (permissionModeRaw !== undefined && permissionMode === undefined) {
      log.debug(
        `Agent file ${filePath} has invalid permissionMode '${
          String(permissionModeRaw)
        }'`,
      );
    }

    // Parse initialPrompt
    const initialPromptRaw = meta["initialPrompt"];
    const initialPrompt =
      typeof initialPromptRaw === "string" && initialPromptRaw.trim().length > 0
        ? initialPromptRaw
        : undefined;

    // Parse mcpServers
    const mcpServersRaw = meta["mcpServers"];
    let mcpServers: AgentMcpServerSpec[] | undefined;
    if (Array.isArray(mcpServersRaw)) {
      const parsedSpecs = mcpServersRaw
        .map((spec) => normalizeAgentMcpServerSpec(spec))
        .filter((spec): spec is AgentMcpServerSpec => spec !== null);
      if (parsedSpecs.length > 0) {
        mcpServers = parsedSpecs;
      }
      if (parsedSpecs.length !== mcpServersRaw.length) {
        log.debug(`Agent file ${filePath} has invalid mcpServers entries`);
      }
    }

    // Extract filename
    const parts = filePath.split("/");
    const filename = parts[parts.length - 1]?.replace(/\.md$/, "");

    // Body is the system prompt
    const systemPrompt = body.trim();

    return {
      ok: true,
      agent: {
        agentType,
        whenToUse,
        ...(tools !== undefined ? { tools } : {}),
        ...(disallowedTools !== undefined ? { disallowedTools } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(maxTurns !== undefined ? { maxTurns } : {}),
        ...(background ? { background } : {}),
        ...(isolation ? { isolation } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(initialPrompt ? { initialPrompt } : {}),
        ...(mcpServers ? { mcpServers } : {}),
        getSystemPrompt: () => systemPrompt,
        source,
        baseDir: filePath.substring(0, filePath.lastIndexOf("/")),
        filename,
      },
    };
  } catch (error) {
    const msg = getErrorMessage(error);
    log.debug(`Error parsing agent from ${filePath}: ${msg}`);
    return { ok: false, reason: msg };
  }
}

export async function loadAgentDefinitions(
  _runtimeTarget?: string,
): Promise<AgentDefinitionsResult> {
  const fs = getPlatform().fs;
  const failedFiles: Array<{ path: string; error: string }> = [];
  const customAgents: CustomAgentDefinition[] = [];

  const userAgentsDir = getUserAgentsDir();
  await loadAgentsFromDir(userAgentsDir, "user", customAgents, failedFiles, fs);

  const builtInAgents = getBuiltInAgents();

  // Merge all agents
  const allAgents: AgentDefinition[] = [
    ...builtInAgents,
    ...customAgents,
  ];

  // Deduplicate with priority: CC pattern (last wins per agentType)
  const activeAgents = getActiveAgentsFromList(allAgents);

  return {
    activeAgents,
    allAgents,
    failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
  };
}

async function loadAgentsFromDir(
  dir: string,
  source: "user",
  agents: CustomAgentDefinition[],
  failedFiles: Array<{ path: string; error: string }>,
  fs: ReturnType<typeof getPlatform>["fs"],
): Promise<void> {
  try {
    const entries = await fs.readDir(dir);
    for await (const entry of entries) {
      if (!entry.name.endsWith(".md")) continue;
      const filePath = `${dir}/${entry.name}`;
      try {
        const content = await fs.readTextFile(filePath);
        const result = parseAgentFromMarkdownDetailed(
          filePath,
          content,
          source,
        );
        if (result.ok) {
          agents.push(result.agent);
        } else {
          failedFiles.push({ path: filePath, error: result.reason });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failedFiles.push({ path: filePath, error: msg });
      }
    }
  } catch {
    // Directory doesn't exist — that's fine
  }
}

function getActiveAgentsFromList(
  allAgents: AgentDefinition[],
): AgentDefinition[] {
  const agentMap = new Map<string, AgentDefinition>();
  for (const agent of allAgents) {
    if (agent.source === "built-in") agentMap.set(agent.agentType, agent);
  }
  for (const agent of allAgents) {
    if (agent.source === "user") agentMap.set(agent.agentType, agent);
  }
  return Array.from(agentMap.values());
}
