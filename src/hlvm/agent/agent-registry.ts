/**
 * Agent Registry - specialist profiles for delegation
 */

export interface AgentProfile {
  name: string;
  description: string;
  tools: string[];
}

const AGENT_PROFILES: AgentProfile[] = [
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
      "web_search",
      "research_web",
      "fetch_url",
      "web_fetch",
      "extract_url",
      "extract_html",
      "render_url",
      "mcp/playwright/render_url",
      "memory_add",
      "memory_search",
      "memory_list",
      "memory_clear",
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
      "web_search",
      "research_web",
      "fetch_url",
      "web_fetch",
      "extract_url",
      "extract_html",
      "render_url",
      "mcp/playwright/render_url",
    ],
  },
  {
    name: "memory",
    description: "Persistent memory specialist",
    tools: [
      "memory_add",
      "memory_search",
      "memory_list",
      "memory_clear",
    ],
  },
];

export function listAgentProfiles(): AgentProfile[] {
  return AGENT_PROFILES.map((profile) => ({
    name: profile.name,
    description: profile.description,
    tools: [...profile.tools],
  }));
}

export function getAgentProfile(name: string): AgentProfile | null {
  const normalized = name.trim().toLowerCase();
  const found = AGENT_PROFILES.find((profile) => profile.name === normalized);
  return found
    ? { name: found.name, description: found.description, tools: [...found.tools] }
    : null;
}
