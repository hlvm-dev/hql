/**
 * Agent Registry - specialist profiles for child agents
 */

import { ValidationError } from "../../common/error.ts";
import { splitFrontmatter } from "../../common/frontmatter.ts";
import { getPlatform } from "../../platform/platform.ts";
import { getUserAgentsDir } from "../../common/paths.ts";
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
}

/** Frozen profiles: immutable at runtime, safe to return by reference */
const AGENT_PROFILES: readonly AgentProfile[] = [
  {
    name: "general",
    description: "General-purpose local task specialist",
    tools: [
      "read_file",
      "write_file",
      "edit_file",
      "list_files",
      "move_to_trash",
      "reveal_path",
      "empty_trash",
      "file_metadata",
      "make_directory",
      "move_path",
      "copy_path",
      "open_path",
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
    ],
  },
  {
    name: "code",
    description: "Codebase and architecture analysis specialist",
    tools: [
      "search_code",
      "read_file",
      "list_files",
      "find_symbol",
      "get_structure",
    ],
    temperature: 0.2,
  },
  {
    name: "file",
    description: "File and folder operations specialist",
    tools: [
      "read_file",
      "write_file",
      "edit_file",
      "list_files",
      "move_to_trash",
      "reveal_path",
      "empty_trash",
      "file_metadata",
      "make_directory",
      "move_path",
      "copy_path",
      "open_path",
    ],
  },
  {
    name: "shell",
    description: "Local shell execution specialist",
    tools: [
      "shell_exec",
      "shell_script",
    ],
  },
  {
    name: "web",
    description: "Web research and source-gathering specialist",
    tools: [
      "search_web",
      "fetch_url",
      "web_fetch",
      "render_url",
      "mcp_playwright_render_url",
    ],
    maxTokens: 32_000,
  },
  {
    name: "memory",
    description: "Persistent memory and preference tracking specialist",
    tools: [
      "memory_write",
      "memory_search",
      "memory_edit",
    ],
  },
];

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

function normalizeAgentProfile(profile: AgentProfile): AgentProfile {
  return {
    ...profile,
    name: profile.name.trim().toLowerCase(),
    description: profile.description.trim(),
    tools: [
      ...new Set(profile.tools.map((tool) => tool.trim()).filter(Boolean)),
    ],
    ...(profile.model ? { model: profile.model.trim() } : {}),
    ...(profile.instructions?.trim()
      ? { instructions: profile.instructions.trim() }
      : {}),
  };
}

function validateUserAgentProfile(
  profile: AgentProfile,
  sourcePath: string,
  toolValidator?: (toolName: string) => boolean,
): AgentProfile {
  if (!profile.name) {
    throw new ValidationError(
      `User agent in ${sourcePath} is missing a non-empty name`,
      "agent_registry",
    );
  }
  if (!profile.description) {
    throw new ValidationError(
      `User agent "${profile.name}" in ${sourcePath} is missing a description`,
      "agent_registry",
    );
  }
  const unknownTools = toolValidator
    ? profile.tools.filter((tool) => !toolValidator(tool))
    : [];
  if (unknownTools.length > 0) {
    throw new ValidationError(
      `User agent "${profile.name}" in ${sourcePath} uses unknown tools: ${
        unknownTools.join(", ")
      }`,
      "agent_registry",
    );
  }
  if (
    typeof profile.temperature === "number" &&
    (Number.isNaN(profile.temperature) || profile.temperature < 0 ||
      profile.temperature > 2)
  ) {
    throw new ValidationError(
      `User agent "${profile.name}" in ${sourcePath} has invalid temperature`,
      "agent_registry",
    );
  }
  if (
    typeof profile.maxTokens === "number" &&
    (!Number.isInteger(profile.maxTokens) || profile.maxTokens <= 0)
  ) {
    throw new ValidationError(
      `User agent "${profile.name}" in ${sourcePath} has invalid maxTokens`,
      "agent_registry",
    );
  }
  return profile;
}

async function loadUserAgentProfileFile(
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

  return validateUserAgentProfile(
    normalizeAgentProfile({
      name: typeof record.name === "string" ? record.name : "",
      description: typeof record.description === "string"
        ? record.description
        : "",
      tools: Array.isArray(record.tools)
        ? record.tools.filter((tool): tool is string =>
          typeof tool === "string"
        )
        : [],
      model: typeof record.model === "string" ? record.model : undefined,
      temperature: typeof record.temperature === "number"
        ? record.temperature
        : undefined,
      maxTokens: typeof record.maxTokens === "number"
        ? record.maxTokens
        : undefined,
      instructions: instructionsParts.join("\n\n"),
    }),
    path,
    toolValidator,
  );
}

export async function loadAgentProfiles(
  _runtimeTarget?: string,
  options?: {
    toolValidator?: (toolName: string) => boolean;
  },
): Promise<readonly AgentProfile[]> {
  const platform = getPlatform();
  const agentsDir = getUserAgentsDir();
  if (!(await platform.fs.exists(agentsDir))) {
    return AGENT_PROFILES;
  }

  const builtInNames = new Set(AGENT_PROFILES.map((profile) => profile.name));
  const seenUserNames = new Set<string>();
  const userFiles: string[] = [];
  for await (const entry of platform.fs.readDir(agentsDir)) {
    if (!entry.isFile) continue;
    const ext = platform.path.extname(entry.name).toLowerCase();
    if (!MARKDOWN_EXTENSIONS.has(ext)) continue;
    userFiles.push(platform.path.join(agentsDir, entry.name));
  }
  userFiles.sort((a, b) => a.localeCompare(b));

  const userProfiles: AgentProfile[] = [];
  for (const file of userFiles) {
    const profile = await loadUserAgentProfileFile(
      file,
      options?.toolValidator,
    );
    if (builtInNames.has(profile.name)) {
      throw new ValidationError(
        `User agent "${profile.name}" in ${file} duplicates a built-in agent profile`,
        "agent_registry",
      );
    }
    if (seenUserNames.has(profile.name)) {
      throw new ValidationError(
        `Duplicate user agent profile "${profile.name}" detected in ${file}`,
        "agent_registry",
      );
    }
    seenUserNames.add(profile.name);
    userProfiles.push(profile);
  }

  return [...AGENT_PROFILES, ...userProfiles];
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
  const aliased = PROFILE_ALIASES[normalized];
  return profiles.find((p) => p.name === normalized) ??
    (aliased ? profiles.find((p) => p.name === aliased) : null) ??
    null;
}
