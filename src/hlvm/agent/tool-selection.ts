/**
 * Tool Selection Helpers
 *
 * Choose a minimal tool allowlist for a given request to reduce tool hallucination
 * and keep prompts small. Also decides when tool usage should be required.
 */

import { getToolsByCategory } from "./registry.ts";

export interface ToolSelectionOptions {
  autoWeb?: boolean;
}

const FILE_KEYWORDS = [
  "file",
  "files",
  "folder",
  "folders",
  "directory",
  "directories",
  "path",
  "paths",
  "download",
  "downloads",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "json",
  "log",
  "read",
  "write",
  "edit",
  "rename",
  "move",
  "copy",
  "delete",
  "list",
];

const CODE_KEYWORDS = [
  "code",
  "source",
  "function",
  "class",
  "symbol",
  "definition",
  "search",
  "find",
  "grep",
  "regex",
  "todo",
];

const SHELL_KEYWORDS = [
  "shell",
  "command",
  "terminal",
  "bash",
  "zsh",
  "sh",
  "cli",
  "execute",
  "run",
];

const WEB_KEYWORDS = [
  "http",
  "https",
  "www",
  "website",
  "web",
  "browser",
  "url",
  "link",
  "news",
  "search",
];

const MEMORY_KEYWORDS = [
  "remember",
  "memory",
  "save this",
  "recall",
  "forget",
];

const AGENT_KEYWORDS = [
  "delegate",
  "agent",
  "sub-agent",
  "specialist",
];

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function hasPathLike(text: string): boolean {
  return /(~\/|\.\/|\.\.\/|\/|\\|[A-Za-z]:\\)/.test(text);
}

function hasFileExtension(text: string): boolean {
  return /\.[a-z0-9]{2,4}\b/.test(text);
}

export function selectToolAllowlist(
  request: string,
  options: ToolSelectionOptions = {},
): string[] | undefined {
  const lower = request.toLowerCase();
  const categories = getToolsByCategory();
  const selected = new Set<string>(categories.meta);

  const wantsFiles = hasPathLike(lower) ||
    hasFileExtension(lower) ||
    hasAnyKeyword(lower, FILE_KEYWORDS);
  const wantsCode = hasAnyKeyword(lower, CODE_KEYWORDS);
  const wantsShell = hasAnyKeyword(lower, SHELL_KEYWORDS);
  const wantsWeb = options.autoWeb || hasAnyKeyword(lower, WEB_KEYWORDS);
  const wantsMemory = hasAnyKeyword(lower, MEMORY_KEYWORDS);
  const wantsAgent = hasAnyKeyword(lower, AGENT_KEYWORDS);

  if (wantsFiles) {
    for (const tool of categories.file) selected.add(tool);
  }
  if (wantsCode) {
    for (const tool of categories.code) selected.add(tool);
  }
  if (wantsShell) {
    for (const tool of categories.shell) selected.add(tool);
  }
  if (wantsWeb) {
    for (const tool of categories.web) selected.add(tool);
  }
  if (wantsMemory) {
    for (const tool of categories.memory) selected.add(tool);
  }
  if (wantsAgent) {
    for (const tool of categories.agent) selected.add(tool);
  }

  const nonMetaSelected = selected.size > categories.meta.length;
  if (!nonMetaSelected) {
    return undefined;
  }

  return Array.from(selected).sort();
}

export function shouldRequireToolCalls(
  allowlist: string[] | undefined,
): boolean {
  if (!allowlist || allowlist.length === 0) return false;
  const { meta } = getToolsByCategory();
  const metaSet = new Set(meta);
  return allowlist.some((tool) => !metaSet.has(tool));
}
