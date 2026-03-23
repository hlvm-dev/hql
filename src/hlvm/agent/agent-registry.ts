/**
 * Agent Registry - specialist profiles for delegation
 */

import { ValidationError } from "../../common/error.ts";
import { getPlatform } from "../../platform/platform.ts";
import { parse as parseYaml } from "npm:yaml@2.0.0-1";

export interface AgentProfile {
  name: string;
  description: string;
  tools: string[];
  /** Override model for this profile (e.g., "ollama/llama3.1:8b"). */
  model?: string;
  /** Override temperature (e.g., 0.2 for code, 0.7 for creative). */
  temperature?: number;
  /** Override max context tokens for child agent. */
  maxTokens?: number;
  /** Additional profile-specific instructions appended to child system notes. */
  instructions?: string;
  /** Maximum token budget for delegated child sessions. */
  maxTokenBudget?: number;
}

/** Team tools available to worker agents (claim tasks, send messages, read status). */
const TEAM_WORKER_TOOLS = [
  "team_task_read",
  "team_task_claim",
  "team_status_read",
  "team_message_send",
  "team_message_read",
  "ack_team_shutdown",
  "submit_team_plan",
];

/** Frozen profiles: immutable at runtime, safe to return by reference */
const AGENT_PROFILES: readonly AgentProfile[] = [
  {
    name: "general",
    description: "Generalist agent for mixed tasks",
    tools: [
      "read_file",
      "write_file",
      "edit_file",
      "list_files",
      "search_code",
      "find_symbol",
      "get_structure",
      "shell_exec",
      "shell_script",
      "search_web",
      "fetch_url",
      "web_fetch",
      "render_url",
      "mcp_playwright_render_url",
      "memory_write",
      "memory_search",
      "memory_edit",
      // Team worker tools + task creation for generalist
      ...TEAM_WORKER_TOOLS,
      "team_task_write",
    ],
  },
  {
    name: "code",
    description: "Code and architecture analysis specialist",
    tools: [
      "search_code",
      "read_file",
      "list_files",
      "find_symbol",
      "get_structure",
      ...TEAM_WORKER_TOOLS,
    ],
    temperature: 0.2,
  },
  {
    name: "file",
    description: "File operations specialist",
    tools: [
      "read_file",
      "write_file",
      "edit_file",
      "list_files",
      ...TEAM_WORKER_TOOLS,
    ],
  },
  {
    name: "shell",
    description: "Shell execution specialist",
    tools: [
      "shell_exec",
      "shell_script",
      ...TEAM_WORKER_TOOLS,
    ],
  },
  {
    name: "web",
    description: "Web research specialist",
    tools: [
      "search_web",
      "fetch_url",
      "web_fetch",
      "render_url",
      "mcp_playwright_render_url",
      ...TEAM_WORKER_TOOLS,
    ],
    maxTokens: 32_000,
  },
  {
    name: "memory",
    description: "Persistent memory specialist",
    tools: [
      "memory_write",
      "memory_search",
      "memory_edit",
    ],
  },
];

const PROJECT_AGENT_DIR = ".hlvm/agents";
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

function normalizeAgentProfile(profile: AgentProfile): AgentProfile {
  return {
    ...profile,
    name: profile.name.trim().toLowerCase(),
    description: profile.description.trim(),
    tools: [...new Set(profile.tools.map((tool) => tool.trim()).filter(Boolean))],
    ...(profile.model ? { model: profile.model.trim() } : {}),
    ...(profile.instructions?.trim()
      ? { instructions: profile.instructions.trim() }
      : {}),
  };
}

function splitFrontmatter(text: string): { frontmatter?: string; body: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { body: normalized.trim() };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    return { body: normalized.trim() };
  }
  return {
    frontmatter: normalized.slice(4, end),
    body: normalized.slice(end + 5).trim(),
  };
}

function validateProjectAgentProfile(
  profile: AgentProfile,
  sourcePath: string,
  toolValidator?: (toolName: string) => boolean,
): AgentProfile {
  if (!profile.name) {
    throw new ValidationError(
      `Project agent in ${sourcePath} is missing a non-empty name`,
      "agent_registry",
    );
  }
  if (!profile.description) {
    throw new ValidationError(
      `Project agent "${profile.name}" in ${sourcePath} is missing a description`,
      "agent_registry",
    );
  }
  if (profile.tools.length === 0) {
    throw new ValidationError(
      `Project agent "${profile.name}" in ${sourcePath} must declare at least one tool`,
      "agent_registry",
    );
  }
  const unknownTools = toolValidator
    ? profile.tools.filter((tool) => !toolValidator(tool))
    : [];
  if (unknownTools.length > 0) {
    throw new ValidationError(
      `Project agent "${profile.name}" in ${sourcePath} uses unknown tools: ${unknownTools.join(", ")}`,
      "agent_registry",
    );
  }
  if (typeof profile.temperature === "number" &&
    (Number.isNaN(profile.temperature) || profile.temperature < 0 || profile.temperature > 2)
  ) {
    throw new ValidationError(
      `Project agent "${profile.name}" in ${sourcePath} has invalid temperature`,
      "agent_registry",
    );
  }
  if (typeof profile.maxTokens === "number" &&
    (!Number.isInteger(profile.maxTokens) || profile.maxTokens <= 0)
  ) {
    throw new ValidationError(
      `Project agent "${profile.name}" in ${sourcePath} has invalid maxTokens`,
      "agent_registry",
    );
  }
  return profile;
}

async function loadProjectAgentProfileFile(
  path: string,
  toolValidator?: (toolName: string) => boolean,
): Promise<AgentProfile> {
  const platform = getPlatform();
  const content = await platform.fs.readTextFile(path);
  const { frontmatter, body } = splitFrontmatter(content);
  const parsed = frontmatter
    ? parseYaml(frontmatter) as Record<string, unknown> | null
    : null;
  const record = parsed && typeof parsed === "object" ? parsed : {};
  const instructionsParts = [
    typeof record.instructions === "string" ? record.instructions.trim() : "",
    body,
  ].filter((part) => part.length > 0);

  return validateProjectAgentProfile(
    normalizeAgentProfile({
      name: typeof record.name === "string" ? record.name : "",
      description: typeof record.description === "string" ? record.description : "",
      tools: Array.isArray(record.tools)
        ? record.tools.filter((tool): tool is string => typeof tool === "string")
        : [],
      model: typeof record.model === "string" ? record.model : undefined,
      temperature: typeof record.temperature === "number"
        ? record.temperature
        : undefined,
      maxTokens: typeof record.maxTokens === "number" ? record.maxTokens : undefined,
      instructions: instructionsParts.join("\n\n"),
    }),
    path,
    toolValidator,
  );
}

export async function loadAgentProfiles(
  workspace?: string,
  options?: {
    toolValidator?: (toolName: string) => boolean;
  },
): Promise<readonly AgentProfile[]> {
  if (!workspace) return AGENT_PROFILES;
  const platform = getPlatform();
  const agentsDir = platform.path.join(workspace, PROJECT_AGENT_DIR);
  if (!(await platform.fs.exists(agentsDir))) {
    return AGENT_PROFILES;
  }

  const builtInNames = new Set(AGENT_PROFILES.map((profile) => profile.name));
  const seenProjectNames = new Set<string>();
  const projectFiles: string[] = [];
  for await (const entry of platform.fs.readDir(agentsDir)) {
    if (!entry.isFile) continue;
    const ext = platform.path.extname(entry.name).toLowerCase();
    if (!MARKDOWN_EXTENSIONS.has(ext)) continue;
    projectFiles.push(platform.path.join(agentsDir, entry.name));
  }
  projectFiles.sort((a, b) => a.localeCompare(b));

  const projectProfiles: AgentProfile[] = [];
  for (const file of projectFiles) {
    const profile = await loadProjectAgentProfileFile(file, options?.toolValidator);
    if (builtInNames.has(profile.name)) {
      throw new ValidationError(
        `Project agent "${profile.name}" in ${file} duplicates a built-in agent profile`,
        "agent_registry",
      );
    }
    if (seenProjectNames.has(profile.name)) {
      throw new ValidationError(
        `Duplicate project agent profile "${profile.name}" detected in ${file}`,
        "agent_registry",
      );
    }
    seenProjectNames.add(profile.name);
    projectProfiles.push(profile);
  }

  return [...AGENT_PROFILES, ...projectProfiles];
}

export function listAgentProfiles(
  profiles: readonly AgentProfile[] = AGENT_PROFILES,
): readonly AgentProfile[] {
  return profiles;
}

/** Common aliases LLMs use for built-in profile names. */
const PROFILE_ALIASES: Record<string, string> = {
  "general-purpose": "general",
  "generalist": "general",
};

export function getAgentProfile(
  name: string,
  profiles: readonly AgentProfile[] = AGENT_PROFILES,
): AgentProfile | null {
  const normalized = name.trim().toLowerCase();
  // Try exact match first, then alias
  return profiles.find((p) => p.name === normalized)
    ?? profiles.find((p) => p.name === (PROFILE_ALIASES[normalized] ?? normalized))
    ?? null;
}
