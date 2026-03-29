import { truncate } from "../../../../../common/utils.ts";

const PATH_LIKE_TOOL_NAMES = new Set([
  "read_file",
  "list_files",
  "write_file",
  "edit_file",
  "open_path",
]);

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
