/**
 * Agent System Constants
 *
 * Following CC's pattern exactly:
 * - AGENT_TOOL_NAME identifies the tool
 * - Tool disallow lists control what sub-agents can access
 * - ONE_SHOT types skip continuation trailers
 */

/** The tool name exposed to the brain */
export const AGENT_TOOL_NAME = "Agent";

/** Default max turns for sub-agents (CC uses 200) */
export const AGENT_MAX_TURNS = 200;

/** Default timeout for sub-agent execution (10 minutes) */
export const AGENT_TOTAL_TIMEOUT = 600_000;

/**
 * Tools that NO sub-agent can use.
 * CC: ALL_AGENT_DISALLOWED_TOOLS
 */
export const ALL_AGENT_DISALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "ask_user", // Sub-agents can't prompt the user
  "complete_task", // Sub-agents don't control session lifecycle
  AGENT_TOOL_NAME, // Prevent nested spawning by default
]);

/**
 * Tools that only built-in agents can use (custom agents are blocked).
 * CC: CUSTOM_AGENT_DISALLOWED_TOOLS
 * Currently same as ALL_AGENT_DISALLOWED_TOOLS.
 */
export const CUSTOM_AGENT_DISALLOWED_TOOLS: ReadonlySet<string> = new Set([
  ...ALL_AGENT_DISALLOWED_TOOLS,
]);

/**
 * Tools allowed for async (background) agents.
 * CC: ASYNC_AGENT_ALLOWED_TOOLS
 */
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
  "memory_write",
  "memory_search",
  "memory_edit",
  "tool_search",
  "skill",
]);

/**
 * Built-in agents that run once and return a report.
 * CC: ONE_SHOT_BUILTIN_AGENT_TYPES
 * Skip agentId/continuation trailer to save tokens.
 */
export const ONE_SHOT_AGENT_TYPES: ReadonlySet<string> = new Set([
  "Explore",
  "Plan",
]);
