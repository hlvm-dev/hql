/** The tool name exposed to the brain */
export const AGENT_TOOL_NAME = "Agent";

export const AGENT_MAX_TURNS = 200;

export const ALL_AGENT_DISALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "ask_user", // Sub-agents can't prompt the user
  "complete_task", // Sub-agents don't control session lifecycle
  AGENT_TOOL_NAME, // Prevent nested spawning by default
]);

export const CUSTOM_AGENT_DISALLOWED_TOOLS: ReadonlySet<string> = new Set([
  ...ALL_AGENT_DISALLOWED_TOOLS,
]);

export const ASYNC_AGENT_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "write_file",
  "edit_file",
  "list_files",
  "move_path",
  "copy_path",
  "search_code",
  "find_symbol",
  "get_structure",
  "shell_exec",
  "shell_script",
  "search_web",
  "fetch_url",
  "web_fetch",
  "git_status",
  "git_diff",
  "git_log",
  "git_commit",
  "tool_search",
]);

/** Built-in one-shot agents whose result skips the continuation trailer to save tokens. */
export const ONE_SHOT_AGENT_TYPES: ReadonlySet<string> = new Set([
  "Explore",
  "Plan",
]);
