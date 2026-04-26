import {
  type FormattedToolTranscriptResult,
  getTool,
  hasTool,
  type ToolProgressTone,
  type ToolTranscriptAdapter,
  type ToolTranscriptCallSummary,
  type ToolTranscriptProgressEvent,
  type ToolTranscriptResultEvent,
} from "../../../../agent/registry.ts";
import {
  FETCH_URL_TRANSCRIPT_ADAPTER,
  WEB_FETCH_TRANSCRIPT_ADAPTER,
  WEB_SEARCH_TRANSCRIPT_ADAPTER,
} from "../../../../agent/tools/web-tools.ts";
import {
  getBundledSkillsDir,
  getUserSkillsDir,
} from "../../../../../common/paths.ts";
import { summarizePathLabel } from "./activity-labels.ts";

type InvocationToolLike = {
  name: string;
  displayName?: string;
  argsSummary: string;
};

const FALLBACK_TRANSCRIPT_ADAPTERS = new Map<string, ToolTranscriptAdapter>([
  ["read_file", { displayName: "Read" }],
  ["list_files", { displayName: "List" }],
  ["search_code", { displayName: "Search" }],
  ["write_file", { displayName: "Write" }],
  ["edit_file", { displayName: "Edit" }],
  ["open_path", { displayName: "Open" }],
  ["reveal_path", { displayName: "Reveal" }],
  ["move_path", { displayName: "Move" }],
  ["copy_path", { displayName: "Copy" }],
  ["make_directory", { displayName: "Make Directory" }],
  ["move_to_trash", { displayName: "Trash" }],
  ["search_web", WEB_SEARCH_TRANSCRIPT_ADAPTER],
  ["web_fetch", WEB_FETCH_TRANSCRIPT_ADAPTER],
  ["fetch_url", FETCH_URL_TRANSCRIPT_ADAPTER],
  ["pw_goto", { displayName: "Browser" }],
  ["pw_back", { displayName: "Browser Back" }],
  ["pw_click", { displayName: "Browser Click" }],
  ["pw_fill", { displayName: "Browser Fill" }],
  ["pw_type", { displayName: "Browser Type" }],
  ["pw_content", { displayName: "Browser Read" }],
  ["pw_hover", { displayName: "Browser Hover" }],
  ["pw_links", { displayName: "Browser Links" }],
  ["pw_wait_for", { displayName: "Browser Wait" }],
  ["pw_screenshot", { displayName: "Browser Screenshot" }],
  ["pw_evaluate", { displayName: "Browser Eval" }],
  ["pw_scroll", { displayName: "Browser Scroll" }],
  ["pw_snapshot", { displayName: "Browser Snapshot" }],
  ["pw_download", { displayName: "Browser Download" }],
  ["pw_select_option", { displayName: "Browser Select" }],
  ["pw_upload_file", { displayName: "Browser Upload" }],
  ["pw_tabs", { displayName: "Browser Tabs" }],
  ["pw_promote", { displayName: "Browser Promote" }],
]);

function getTranscriptAdapter(
  toolName: string,
  ownerId?: string,
): ToolTranscriptAdapter | undefined {
  if (hasTool(toolName, ownerId)) {
    return getTool(toolName, ownerId).transcript ??
      FALLBACK_TRANSCRIPT_ADAPTERS.get(toolName);
  }
  return FALLBACK_TRANSCRIPT_ADAPTERS.get(toolName);
}

function resolveAdapterDisplayName(
  adapter: ToolTranscriptAdapter | undefined,
): string | undefined {
  const displayName = adapter?.displayName;
  if (typeof displayName === "function") {
    const resolved = displayName(undefined);
    return resolved?.trim() ? resolved.trim() : undefined;
  }
  return displayName?.trim() ? displayName.trim() : undefined;
}

function sanitizeQuotedArg(value: string): string {
  return value.replaceAll('"', "'");
}

function sanitizeParenthesizedArg(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const PATH_ARGUMENT_TOOL_NAMES = new Set([
  "read_file",
  "list_files",
  "write_file",
  "edit_file",
  "open_path",
  "reveal_path",
  "move_path",
  "copy_path",
  "make_directory",
  "move_to_trash",
]);

const TILDE_USER_SKILLS_PREFIX = "~/.hlvm/skills/";
const TILDE_BUNDLED_SKILLS_PREFIX = "~/.hlvm/.runtime/bundled-skills/";
const SKILL_FILE_SUFFIX_PATTERN = /^([^/]+)\/SKILL\.md$/i;

function normalizeToolPath(path: string): string {
  return path.trim().replaceAll("\\", "/");
}

function extractSkillNameFromSkillFilePath(path: string): string | undefined {
  const normalized = normalizeToolPath(path);
  const resolvedUserSkillsPrefix = `${
    normalizeToolPath(getUserSkillsDir()).replace(/\/+$/, "")
  }/`;
  const resolvedBundledSkillsPrefix = `${
    normalizeToolPath(getBundledSkillsDir()).replace(/\/+$/, "")
  }/`;
  const relativePath = normalized.startsWith(TILDE_USER_SKILLS_PREFIX)
    ? normalized.slice(TILDE_USER_SKILLS_PREFIX.length)
    : normalized.startsWith(TILDE_BUNDLED_SKILLS_PREFIX)
    ? normalized.slice(TILDE_BUNDLED_SKILLS_PREFIX.length)
    : normalized.startsWith(resolvedUserSkillsPrefix)
    ? normalized.slice(resolvedUserSkillsPrefix.length)
    : normalized.startsWith(resolvedBundledSkillsPrefix)
    ? normalized.slice(resolvedBundledSkillsPrefix.length)
    : undefined;
  if (!relativePath) return undefined;
  const match = relativePath.match(SKILL_FILE_SUFFIX_PATTERN);
  return match?.[1]?.trim() || undefined;
}

function extractReadSkillName(
  toolName: string,
  argsSummary: string,
): string | undefined {
  return toolName === "read_file"
    ? extractSkillNameFromSkillFilePath(argsSummary)
    : undefined;
}

export function resolveSkillToolDisplayName(
  toolName: string,
  argsSummary: string,
): string | undefined {
  const skillName = extractReadSkillName(toolName, argsSummary);
  return skillName ? `Skill(${skillName})` : undefined;
}

export function resolveToolTranscriptDisplayName(
  toolName: string,
  ownerId?: string,
): string {
  return resolveAdapterDisplayName(getTranscriptAdapter(toolName, ownerId)) ??
    toolName;
}

export function buildToolTranscriptInvocationLabel(
  tool: InvocationToolLike,
): string {
  const displayName = tool.displayName?.trim() || tool.name;
  const argsSummary = tool.argsSummary.trim();
  if (!argsSummary) return displayName;

  const skillDisplayName = resolveSkillToolDisplayName(tool.name, argsSummary);
  if (skillDisplayName) return skillDisplayName;

  if (
    tool.name === "search_web" ||
    tool.name === "web_fetch" ||
    tool.name === "fetch_url" ||
    tool.name === "ask_user" ||
    tool.name === "pw_goto" ||
    tool.name === "pw_download"
  ) {
    return `${displayName}("${sanitizeQuotedArg(argsSummary)}")`;
  }

  if (
    tool.name === "shell_exec" || tool.name === "shell_script" ||
    tool.name.startsWith("pw_") ||
    tool.name === "read_file" ||
    tool.name === "list_files" ||
    tool.name === "write_file" ||
    tool.name === "edit_file" ||
    tool.name === "open_path" ||
    tool.name === "reveal_path" ||
    tool.name === "move_path" ||
    tool.name === "copy_path" ||
    tool.name === "make_directory" ||
    tool.name === "move_to_trash" ||
    tool.name === "search_code"
  ) {
    const compactArgs = PATH_ARGUMENT_TOOL_NAMES.has(tool.name)
      ? summarizePathLabel(argsSummary)
      : sanitizeParenthesizedArg(argsSummary);
    return `${displayName}(${compactArgs})`;
  }

  return `${displayName} ${argsSummary}`;
}

export function resolveToolTranscriptProgress(
  toolName: string,
  event: ToolTranscriptProgressEvent,
  ownerId?: string,
): { message: string; tone: ToolProgressTone } | undefined {
  const adapter = getTranscriptAdapter(toolName, ownerId);
  const formatted = adapter?.formatProgress?.(event) ?? null;
  if (formatted?.message?.trim()) {
    return {
      message: formatted.message.trim(),
      tone: formatted.tone ?? event.tone,
    };
  }
  const fallbackMessage = event.message.trim();
  return fallbackMessage
    ? { message: fallbackMessage, tone: event.tone }
    : undefined;
}

export function resolveToolTranscriptResult(
  toolName: string,
  event: ToolTranscriptResultEvent,
  ownerId?: string,
): FormattedToolTranscriptResult {
  if (extractReadSkillName(toolName, event.argsSummary)) {
    return {
      summaryText: "Successfully loaded skill",
      detailText: "Successfully loaded skill",
    };
  }

  const adapter = getTranscriptAdapter(toolName, ownerId);
  const formatted = adapter?.formatResult?.(event) ?? null;
  if (formatted) {
    return {
      summaryText: formatted.summaryText ?? event.summary ?? event.content,
      detailText: formatted.detailText ?? event.content,
    };
  }
  return {
    summaryText: event.summary ?? event.content,
    detailText: event.content,
  };
}

export function resolveToolTranscriptGroupSummary(
  toolName: string,
  calls: readonly ToolTranscriptCallSummary[],
  ownerId?: string,
): string | undefined {
  const adapter = getTranscriptAdapter(toolName, ownerId);
  const summary = adapter?.formatGroupSummary?.(calls) ?? null;
  if (summary?.trim()) {
    return summary.trim();
  }

  const count = calls.length;
  if (count <= 0) return undefined;

  const displayName = resolveToolTranscriptDisplayName(toolName, ownerId);
  switch (toolName) {
    case "read_file":
      return `Read ${count} file${count === 1 ? "" : "s"}`;
    case "list_files":
      return `Listed ${count} entr${count === 1 ? "y" : "ies"}`;
    case "search_code":
      return `Searched ${count} code quer${count === 1 ? "y" : "ies"}`;
    case "shell_exec":
    case "shell_script":
      return `Ran ${count} command${count === 1 ? "" : "s"}`;
    case "write_file":
      return `Wrote ${count} file${count === 1 ? "" : "s"}`;
    case "edit_file":
      return `Edited ${count} file${count === 1 ? "" : "s"}`;
    case "open_path":
      return `Opened ${count} path${count === 1 ? "" : "s"}`;
    default:
      return count === 1 ? displayName : `${displayName} ×${count}`;
  }
}
