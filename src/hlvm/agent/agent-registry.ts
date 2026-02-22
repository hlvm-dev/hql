/**
 * Agent Registry - specialist profiles for delegation
 */

export interface AgentProfile {
  name: string;
  description: string;
  tools: string[];
}

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
    ],
  },
  {
    name: "file",
    description: "File operations specialist",
    tools: [
      "read_file",
      "write_file",
      "edit_file",
      "list_files",
    ],
  },
  {
    name: "shell",
    description: "Shell execution specialist",
    tools: [
      "shell_exec",
      "shell_script",
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
    ],
  },
  {
    name: "memory",
    description: "Persistent memory specialist",
    tools: [
      "memory_write",
      "memory_search",
    ],
  },
];

export function listAgentProfiles(): readonly AgentProfile[] {
  return AGENT_PROFILES;
}

export function getAgentProfile(name: string): AgentProfile | null {
  const normalized = name.trim().toLowerCase();
  return AGENT_PROFILES.find((profile) => profile.name === normalized) ?? null;
}
