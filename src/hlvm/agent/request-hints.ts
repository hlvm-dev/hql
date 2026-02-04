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

const PATH_TOKEN = /(~\/[^\s"'`]+|\/[^\s"'`]+|\.\.?\/[^\s"'`]+|[A-Za-z]:\\[^\s"'`]+)/;

const NAMED_FOLDERS: Array<{ regex: RegExp; path: string }> = [
  { regex: /\bdownloads?\b/i, path: "~/Downloads" },
  { regex: /\bdesktop\b/i, path: "~/Desktop" },
  { regex: /\bdocuments?\b/i, path: "~/Documents" },
];

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?)]$/, "");
}

function extractExplicitPath(request: string): string | undefined {
  const match = request.match(PATH_TOKEN);
  if (!match) return undefined;
  return stripTrailingPunctuation(match[0]);
}

function inferNamedFolderPath(requestLower: string): string | undefined {
  for (const entry of NAMED_FOLDERS) {
    if (entry.regex.test(requestLower)) {
      return entry.path;
    }
  }
  return undefined;
}

function inferFilePattern(requestLower: string): string | undefined {
  if (/\bpdfs?\b/.test(requestLower) || /\.pdf\b/.test(requestLower)) {
    return "*.pdf";
  }
  return undefined;
}

function inferRecursive(requestLower: string): boolean | undefined {
  if (/\b(recursive|recursively|subfolders|sub-folders|all folders|all subfolders)\b/.test(requestLower)) {
    return true;
  }
  return undefined;
}

export function inferFileRequestHints(request: string): FileRequestHints | null {
  const requestLower = request.toLowerCase();
  const path = extractExplicitPath(request) ?? inferNamedFolderPath(requestLower);
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
