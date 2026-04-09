import { truncate } from "../../../../../common/utils.ts";

const PATH_LIKE_TOOL_NAMES = new Set([
  "read_file",
  "list_files",
  "write_file",
  "edit_file",
  "open_path",
  "reveal_path",
  "move_to_trash",
]);

/**
 * Shared shell-command regex labels used by both plan-flow (live activity)
 * and turn-activity (completed-outcome summaries) to avoid duplication.
 */
export const SHELL_COMMAND_LABELS: ReadonlyArray<
  readonly [pattern: RegExp, liveLabel: string, completedLabel: string]
> = [
  [/^mkdir\b/i, "Creating directories", "Created directories"],
  [/^mv\b/i, "Moving files", "Moved files"],
  [/^cp\b/i, "Copying files", "Copied files"],
  [/^rm\b/i, "Removing files", "Removed files"],
] as const;

export function normalizeActivityText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function summarizePathLabel(input: string, maxLength = 48): string {
  const trimmed = normalizeActivityText(input).replace(/^['"]|['"]$/g, "");
  if (!trimmed) return "the target";
  const segments = trimmed.split(/[\\/]/).filter(Boolean);
  const lastSegment = segments.at(-1) ?? trimmed;
  return truncate(lastSegment, maxLength, "…");
}

export function summarizeActivityArgs(
  toolName: string,
  argsSummary: string,
  maxLength = 72,
): string {
  const normalized = normalizeActivityText(argsSummary);
  if (!normalized) return "";
  if (PATH_LIKE_TOOL_NAMES.has(toolName)) {
    return summarizePathLabel(normalized, Math.min(maxLength, 48));
  }
  return truncate(normalized, maxLength, "…");
}
