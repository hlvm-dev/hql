export const TOOL_NAMES = Object.freeze({
  COMPUTER_USE: "computer_use",
  PLAYWRIGHT: "playwright",
  CHROME_EXT: "chrome_ext",
  MCP: "mcp",
  AGENT: "agent",
  AGENT_WORKTREE: "agent_worktree",
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  EDIT_FILE: "edit_file",
  LIST_FILES: "list_files",
  MOVE_PATH: "move_path",
  COPY_PATH: "copy_path",
  REVEAL_PATH: "reveal_path",
  OPEN_PATH: "open_path",
  MAKE_DIRECTORY: "make_directory",
  MOVE_TO_TRASH: "move_to_trash",
  EMPTY_TRASH: "empty_trash",
  ARCHIVE_FILES: "archive_files",
  CU_REQUEST_ACCESS: "cu_request_access",
} as const);

export type ToolName = typeof TOOL_NAMES[keyof typeof TOOL_NAMES];
