/**
 * Agent Definition Loading
 *
 * CC source: tools/AgentTool/loadAgentsDir.ts
 * Loads agent definitions from:
 * 1. Built-in agents (code-defined)
 * 2. User agents (~/.hlvm/agents/*.md)
 * 3. Project agents (.hlvm/agents/*.md)
 *
 * .md files use YAML frontmatter for configuration, body is the system prompt.
 */

import { parseFrontmatter } from "../../../common/frontmatter.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { getAgentLogger } from "../logger.ts";
import type {
  AgentDefinition,
  AgentDefinitionsResult,
  CustomAgentDefinition,
} from "./agent-types.ts";
import { getBuiltInAgents } from "./built-in-agents.ts";

const log = getAgentLogger();

// ============================================================
// Frontmatter Parsing (CC: parseAgentFromMarkdown)
// ============================================================

/**
 * Parse a .md file into a CustomAgentDefinition.
 * CC: parseAgentFromMarkdown() — simplified (no plugins, no memory, no hooks)
 *
 * Required frontmatter: name, description
 * Optional: tools, disallowedTools, model, maxTurns, background, isolation
 */
export function parseAgentFromMarkdown(
  filePath: string,
  content: string,
  source: "user" | "project",
): CustomAgentDefinition | null {
  try {
    const { meta, body } = parseFrontmatter<Record<string, unknown>>(content);
    if (!meta) return null;

    const agentType = meta["name"];
    const whenToUse = meta["description"];

    // Validate required fields — silently skip non-agent .md files
    if (!agentType || typeof agentType !== "string") return null;
    if (!whenToUse || typeof whenToUse !== "string") {
      log.debug(`Agent file ${filePath} missing 'description' in frontmatter`);
      return null;
    }

    // Parse optional fields (CC pattern: validate and log, don't throw)
    const modelRaw = meta["model"];
    let model: string | undefined;
    if (typeof modelRaw === "string" && modelRaw.trim().length > 0) {
      const trimmed = modelRaw.trim();
      model = trimmed.toLowerCase() === "inherit" ? "inherit" : trimmed;
    }

    // Parse tools
    const toolsRaw = meta["tools"];
    let tools: string[] | undefined;
    if (Array.isArray(toolsRaw)) {
      tools = toolsRaw.filter((t): t is string => typeof t === "string");
    }

    // Parse disallowedTools
    const disallowedToolsRaw = meta["disallowedTools"];
    let disallowedTools: string[] | undefined;
    if (Array.isArray(disallowedToolsRaw)) {
      disallowedTools = disallowedToolsRaw.filter(
        (t): t is string => typeof t === "string",
      );
    }

    // Parse maxTurns
    const maxTurnsRaw = meta["maxTurns"];
    let maxTurns: number | undefined;
    if (typeof maxTurnsRaw === "number" && Number.isInteger(maxTurnsRaw) && maxTurnsRaw > 0) {
      maxTurns = maxTurnsRaw;
    }

    // Parse background
    const backgroundRaw = meta["background"];
    const background =
      backgroundRaw === true || backgroundRaw === "true" ? true : undefined;

    // Parse isolation
    const isolationRaw = meta["isolation"];
    const isolation = isolationRaw === "worktree" ? "worktree" as const : undefined;

    // Parse omitClaudeMd
    const omitClaudeMdRaw = meta["omitClaudeMd"];
    const omitClaudeMd =
      omitClaudeMdRaw === true || omitClaudeMdRaw === "true" ? true : undefined;

    // Extract filename
    const parts = filePath.split("/");
    const filename = parts[parts.length - 1]?.replace(/\.md$/, "");

    // Body is the system prompt
    const systemPrompt = body.trim();

    return {
      agentType,
      whenToUse,
      ...(tools !== undefined ? { tools } : {}),
      ...(disallowedTools !== undefined ? { disallowedTools } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(background ? { background } : {}),
      ...(isolation ? { isolation } : {}),
      ...(omitClaudeMd ? { omitClaudeMd } : {}),
      getSystemPrompt: () => systemPrompt,
      source,
      baseDir: filePath.substring(0, filePath.lastIndexOf("/")),
      filename,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.debug(`Error parsing agent from ${filePath}: ${msg}`);
    return null;
  }
}

// ============================================================
// Agent Discovery (CC: getAgentDefinitionsWithOverrides)
// ============================================================

/**
 * Load all agent definitions from built-in + filesystem.
 * CC: getAgentDefinitionsWithOverrides() — simplified (no plugins, no policy, no memoize)
 *
 * Searches:
 * - ~/.hlvm/agents/*.md (user agents)
 * - .hlvm/agents/*.md in workspace (project agents)
 */
export async function loadAgentDefinitions(
  workspace: string,
): Promise<AgentDefinitionsResult> {
  const fs = getPlatform().fs;
  const failedFiles: Array<{ path: string; error: string }> = [];
  const customAgents: CustomAgentDefinition[] = [];

  // Load user agents (~/.hlvm/agents/)
  const homeDir = getPlatform().env.get("HOME") ?? "";
  const userAgentsDir = `${homeDir}/.hlvm/agents`;
  await loadAgentsFromDir(userAgentsDir, "user", customAgents, failedFiles, fs);

  // Load project agents (.hlvm/agents/ in workspace)
  const projectAgentsDir = `${workspace}/.hlvm/agents`;
  await loadAgentsFromDir(projectAgentsDir, "project", customAgents, failedFiles, fs);

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

/**
 * Load .md agent files from a directory.
 */
async function loadAgentsFromDir(
  dir: string,
  source: "user" | "project",
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
        const agent = parseAgentFromMarkdown(filePath, content, source);
        if (agent) {
          agents.push(agent);
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

// ============================================================
// Priority Resolution (CC: getActiveAgentsFromList)
// ============================================================

/**
 * Deduplicate agents by agentType. Later sources override earlier.
 * CC: getActiveAgentsFromList() — same logic
 *
 * Priority order (last wins): built-in → user → project
 */
export function getActiveAgentsFromList(
  allAgents: AgentDefinition[],
): AgentDefinition[] {
  const builtIn = allAgents.filter((a) => a.source === "built-in");
  const user = allAgents.filter((a) => a.source === "user");
  const project = allAgents.filter((a) => a.source === "project");

  // CC pattern: iterate groups in order, Map.set overwrites → last wins
  const agentMap = new Map<string, AgentDefinition>();

  for (const agents of [builtIn, user, project]) {
    for (const agent of agents) {
      agentMap.set(agent.agentType, agent);
    }
  }

  return Array.from(agentMap.values());
}
