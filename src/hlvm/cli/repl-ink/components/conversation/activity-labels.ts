import { truncate } from "../../../../../common/utils.ts";

const PATH_LIKE_TOOL_NAMES = new Set([
  "read_file",
  "list_files",
  "write_file",
  "edit_file",
  "make_directory",
  "move_path",
  "copy_path",
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

function summarizeShellActivity(
  argsSummary: string,
): string | undefined {
  const normalized = normalizeActivityText(argsSummary);
  if (!normalized) return undefined;
  const shellMatch = SHELL_COMMAND_LABELS.find(([re]) => re.test(normalized));
  if (shellMatch) {
    return shellMatch[1];
  }
  return "Running";
}

export function summarizeStatusLineToolLabel(
  tool: {
    name: string;
    displayName: string;
    argsSummary: string;
    progressText?: string;
    toolIndex: number;
    toolTotal: number;
  },
): string {
  const args = summarizeActivityArgs(tool.name, tool.argsSummary, 28);
  const suffix = tool.toolTotal > 1
    ? ` ${tool.toolIndex}/${tool.toolTotal}`
    : "";
  const progressText = normalizeActivityText(tool.progressText ?? "");
  const genericProgress = progressText.length > 0 && !args
    ? truncate(progressText, 44, "…")
    : undefined;

  switch (tool.name) {
    case "search_web":
    case "search_code":
      return args ? `Searching ${args}${suffix}` : genericProgress
        ? `${genericProgress}${suffix}`
        : `Searching${suffix}`;
    case "web_fetch":
    case "fetch_url":
      return args ? `Fetching ${args}${suffix}` : genericProgress
        ? `${genericProgress}${suffix}`
        : `Fetching${suffix}`;
    case "read_file":
      return args ? `Reading ${args}${suffix}` : genericProgress
        ? `${genericProgress}${suffix}`
        : `Reading${suffix}`;
    case "list_files":
      return args ? `Listing ${args}${suffix}` : genericProgress
        ? `${genericProgress}${suffix}`
        : `Listing${suffix}`;
    case "write_file":
      return args ? `Writing ${args}${suffix}` : genericProgress
        ? `${genericProgress}${suffix}`
        : `Writing${suffix}`;
    case "edit_file":
      return args ? `Editing ${args}${suffix}` : genericProgress
        ? `${genericProgress}${suffix}`
        : `Editing${suffix}`;
    case "make_directory":
      return args ? `Creating ${args}${suffix}` : genericProgress
        ? `${genericProgress}${suffix}`
        : `Creating${suffix}`;
    case "move_path":
      return args ? `Moving ${args}${suffix}` : genericProgress
        ? `${genericProgress}${suffix}`
        : `Moving${suffix}`;
    case "copy_path":
      return args ? `Copying ${args}${suffix}` : genericProgress
        ? `${genericProgress}${suffix}`
        : `Copying${suffix}`;
    case "open_path":
      return args ? `Opening ${args}${suffix}` : genericProgress
        ? `${genericProgress}${suffix}`
        : `Opening${suffix}`;
    case "reveal_path":
      return args ? `Revealing ${args}${suffix}` : genericProgress
        ? `${genericProgress}${suffix}`
        : `Revealing${suffix}`;
    case "move_to_trash":
      return args ? `Trashing ${args}${suffix}` : genericProgress
        ? `${genericProgress}${suffix}`
        : `Trashing${suffix}`;
    case "shell_exec":
    case "shell_script": {
      const shellLabel = summarizeShellActivity(tool.argsSummary);
      if (args && shellLabel) {
        return `${shellLabel} ${args}${suffix}`;
      }
      return genericProgress ? `${genericProgress}${suffix}` : shellLabel
        ? `${shellLabel}${suffix}`
        : `${tool.displayName}${suffix}`;
    }
    default:
      return args ? `${tool.displayName} ${args}${suffix}` : genericProgress
        ? `${genericProgress}${suffix}`
        : `${tool.displayName}${suffix}`;
  }
}
