/**
 * Request Hints
 *
 * Deterministic hints inferred from the user request to improve tool arguments
 * and reduce ambiguity for file-related tasks.
 */

export interface FileRequestHints {
  path?: string;
  pathRoots: string[];
  pattern?: string;
  recursive?: boolean;
}

export interface RequestHints {
  file?: FileRequestHints;
}

import {
  extractPathToken,
  inferFilePattern,
  inferNamedFolderPath,
} from "./request-patterns.ts";

function inferRecursive(requestLower: string): boolean | undefined {
  if (/\b(recursive|recursively|subfolders|sub-folders|all folders|all subfolders)\b/.test(requestLower)) {
    return true;
  }
  return undefined;
}

export function inferFileRequestHints(request: string): FileRequestHints | null {
  const requestLower = request.toLowerCase();
  const path = extractPathToken(request) ?? inferNamedFolderPath(requestLower);
  const pattern = inferFilePattern(requestLower);
  const recursive = inferRecursive(requestLower);
  const pathRoots = path ? [path] : [];

  if (!path && !pattern && recursive === undefined) {
    return null;
  }

  return {
    path: path || undefined,
    pathRoots,
    pattern,
    recursive,
  };
}

export function inferRequestHints(request: string): RequestHints {
  const file = inferFileRequestHints(request);
  return file ? { file } : {};
}

export function applyRequestHintsToToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  hints?: RequestHints,
): Record<string, unknown> {
  if (!hints?.file) return args;
  if (toolName !== "list_files") return args;

  let changed = false;
  const merged: Record<string, unknown> = { ...args };
  const currentPath = typeof merged.path === "string"
    ? merged.path.trim()
    : undefined;
  const normalizedPath = currentPath
    ? currentPath.replace(/[\\/]+$/, "").toLowerCase()
    : "";
  const isBareFolder = !!currentPath &&
    !currentPath.startsWith(".") &&
    !currentPath.startsWith("~") &&
    !currentPath.includes("/") &&
    !currentPath.includes("\\");
  const shouldOverridePath = !currentPath ||
    isBareFolder ||
    normalizedPath === "/downloads" ||
    normalizedPath === "/documents" ||
    normalizedPath === "/desktop";

  if (hints.file.path && shouldOverridePath) {
    merged.path = hints.file.path;
    changed = true;
  }

  if ((merged.pattern === undefined || merged.pattern === "") && hints.file.pattern) {
    merged.pattern = hints.file.pattern;
    changed = true;
  }

  if (merged.recursive === undefined && hints.file.recursive !== undefined) {
    merged.recursive = hints.file.recursive;
    changed = true;
  }

  return changed ? merged : args;
}
