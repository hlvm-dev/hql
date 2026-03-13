/**
 * Phase-aware tool pruning — proactively narrow tool schemas based on
 * conversation phase inferred from recent tool usage patterns.
 *
 * Unlike tool_search (reactive, user-driven), this is automatic and
 * only activates when tool_search hasn't already narrowed the set.
 */

export type ConversationPhase = "explore" | "edit" | "validate" | "finish";

/** Tools always available regardless of phase. */
const BASELINE_TOOLS = [
  "ask_user",
  "complete_task",
  "tool_search",
  "read_file",
  "list_files",
  "memory_write",
  "memory_search",
];

const PHASE_TOOLS: Record<ConversationPhase, readonly string[]> = {
  explore: [
    "search_code",
    "search_web",
    "fetch_page",
    "shell_exec",
  ],
  edit: [
    "write_file",
    "edit_file",
    "undo_edit",
    "shell_exec",
    "search_code",
  ],
  validate: [
    "write_file",
    "edit_file",
    "undo_edit",
    "shell_exec",
    "shell_script",
    "search_code",
  ],
  finish: [], // All tools — phase pruning disabled
};

const EDIT_TOOLS = new Set(["write_file", "edit_file"]);
const FINISH_TOOLS = new Set(["complete_task", "report_result"]);

/** Infer conversation phase from recent tool call history. */
export function inferConversationPhase(
  recentToolNames: string[],
  currentPhase?: ConversationPhase,
): ConversationPhase {
  if (recentToolNames.length === 0) return "explore";

  // Check finish signals first (highest priority)
  if (recentToolNames.some((name) => FINISH_TOOLS.has(name))) {
    return "finish";
  }

  // Look at the last 5 tool calls for phase signals
  const window = recentToolNames.slice(-5);
  const hasEdits = window.some((name) => EDIT_TOOLS.has(name));
  const hasShellAfterEdit = hasEdits &&
    window.indexOf("shell_exec") >
      Math.max(
        window.lastIndexOf("write_file"),
        window.lastIndexOf("edit_file"),
      ) &&
    window.includes("shell_exec");

  // validate: shell_exec appeared after the last edit tool
  if (hasShellAfterEdit && currentPhase === "edit") {
    return "validate";
  }

  // edit: recent window contains write/edit tools
  if (hasEdits) {
    return "edit";
  }

  return currentPhase ?? "explore";
}

/**
 * Build a phase-appropriate tool allowlist.
 * Returns null if tool_search has already narrowed (don't override).
 */
export function buildPhaseAllowlist(
  phase: ConversationPhase,
  existingAllowlist?: string[],
): string[] | null {
  // Don't override tool_search narrowing
  if (existingAllowlist && existingAllowlist.length > 0) return null;

  // "finish" phase: disable pruning entirely
  if (phase === "finish") return null;

  const phaseTools = PHASE_TOOLS[phase];
  return [...new Set([...BASELINE_TOOLS, ...phaseTools])];
}
