/**
 * File Tools - SSOT-compliant file operations for AI agents
 *
 * Provides core file operations with security sandboxing:
 * 1. read_file - Read file contents
 * 2. write_file - Write/create file
 * 3. edit_file - Edit file using find/replace
 * 4. list_files - List directory contents
 * 5. open_path - Open file/folder in the system default app
 * 6. move_to_trash - Move files/folders to the OS trash
 * 7. reveal_path - Reveal a path in the system file manager
 * 8. empty_trash - Empty the OS trash
 * 9. make_directory - Create a directory for local organization work
 * 10. move_path - Move or rename a file/folder
 * 11. copy_path - Copy a file/folder
 * 12. archive_files - Create zip/tar archives from files or folders
 *
 * All operations:
 * - Use path sandboxing (validatePath)
 * - Use platform abstraction (getPlatform)
 * - Handle errors gracefully
 * - Return structured results
 */

import emptyTrashPackage from "npm:empty-trash@4.0.0";
import trashPackage from "npm:trash@10.1.1";
import { getPlatform } from "../../../platform/platform.ts";
import { isPathWithinRoot, SecurityError } from "../security/path-sandbox.ts";
import type { ToolExecutionOptions } from "../registry.ts";
import { createPolicyPathChecker, resolveToolPath } from "../path-utils.ts";
import { copyDirectoryRecursive } from "../../../common/fs-copy.ts";
import {
  GlobPatternError,
  globToRegex,
} from "../../../common/pattern-utils.ts";
import { isIgnored, loadGitignore } from "../../../common/file-utils.ts";
import { RESOURCE_LIMITS } from "../constants.ts";
import {
  assertMaxBytes,
  formatBytes,
  ResourceLimitError,
} from "../../../common/limits.ts";
import { throwIfAborted } from "../../../common/timeout-utils.ts";
import { failTool, formatToolError, okTool } from "../tool-results.ts";
import {
  isObjectValue,
  TEXT_ENCODER,
  truncate,
} from "../../../common/utils.ts";
import { getMimeTypeForExtension } from "../../../common/file-kinds.ts";
import { atomicWriteTextFile } from "../../../common/atomic-file.ts";

// ============================================================
// Types
// ============================================================

/** Result of a successful file operation */
interface FileOperationResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

/** Arguments for read_file tool */
export interface ReadFileArgs {
  path: string;
  maxBytes?: number;
}

/** Result of read_file operation */
interface ReadFileResult extends FileOperationResult {
  path?: string;
  content?: string;
  size?: number;
  truncated?: boolean;
}

/** Arguments for write_file tool */
export interface WriteFileArgs {
  path: string;
  content: string;
  createDirs?: boolean;
  maxBytes?: number;
}

/** Arguments for edit_file tool */
export interface EditFileArgs {
  path: string;
  find: string;
  replace: string;
  mode?: "literal" | "regex";
  maxBytes?: number;
}

/** Result of edit_file operation */
interface EditFileResult extends FileOperationResult {
  replacements?: number;
  preview?: string;
}

/** Arguments for list_files tool */
export interface ListFilesArgs {
  path: string;
  recursive?: boolean;
  pattern?: string;
  filePattern?: string;
  mimePrefix?: string;
  maxDepth?: number;
  maxEntries?: number;
  maxResults?: number | string;
}

/** File entry from list_files */
interface FileEntry {
  path: string;
  type: "file" | "directory";
  size?: number;
}

/** Result of list_files operation */
interface ListFilesResult extends FileOperationResult {
  entries?: FileEntry[];
  count?: number;
}

/** Arguments for open_path tool */
export interface OpenPathArgs {
  path: string;
}

/** Result of open_path operation */
interface OpenPathResult extends FileOperationResult {
  openedPath?: string;
}

/** Arguments for move_to_trash tool */
export interface MoveToTrashArgs {
  paths: string[];
}

/** Result of move_to_trash operation */
interface MoveToTrashResult extends FileOperationResult {
  trashedPaths?: string[];
  count?: number;
}

/** Arguments for reveal_path tool */
export interface RevealPathArgs {
  path: string;
}

/** Result of reveal_path operation */
interface RevealPathResult extends FileOperationResult {
  revealedPath?: string;
  fallbackPath?: string;
  exact?: boolean;
}

/** Arguments for empty_trash tool */
export interface EmptyTrashArgs {
  _?: never;
}

/** Result of empty_trash operation */
interface EmptyTrashResult extends FileOperationResult {
  emptied?: boolean;
}

/** Arguments for make_directory tool */
export interface MakeDirectoryArgs {
  path: string;
}

/** Result of make_directory operation */
interface MakeDirectoryResult extends FileOperationResult {
  createdPath?: string;
  alreadyExisted?: boolean;
}

/** Arguments for move_path tool */
export interface MovePathArgs {
  sourcePath: string;
  destinationPath: string;
}

/** Result of move_path operation */
interface MovePathResult extends FileOperationResult {
  sourcePath?: string;
  destinationPath?: string;
}

/** Arguments for copy_path tool */
export interface CopyPathArgs {
  sourcePath: string;
  destinationPath: string;
}

/** Result of copy_path operation */
interface CopyPathResult extends FileOperationResult {
  sourcePath?: string;
  destinationPath?: string;
}

/** Arguments for file_metadata tool */
export interface FileMetadataArgs {
  paths: string | string[];
}

/** Metadata for a single file or directory */
export interface FileMetadataEntry {
  path: string;
  exists: boolean;
  isFile?: boolean;
  isDirectory?: boolean;
  isSymlink?: boolean;
  size?: number;
  modified?: string;
  created?: string;
  mimeType?: string;
}

/** Result of file_metadata operation */
interface FileMetadataResult extends FileOperationResult {
  entries?: FileMetadataEntry[];
  count?: number;
}

/** Arguments for archive_files tool */
export interface ArchiveFilesArgs {
  paths: string[];
  outputPath: string;
  format?: "zip" | "tar.gz";
  overwrite?: boolean;
}

/** Result of archive_files operation */
interface ArchiveFilesResult extends FileOperationResult {
  outputPath?: string;
  inputCount?: number;
  format?: "zip" | "tar.gz";
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

interface FileToolRuntime {
  moveToTrash(paths: string[]): Promise<void>;
  emptyTrash(): Promise<void>;
}

const DEFAULT_FILE_TOOL_RUNTIME: FileToolRuntime = {
  moveToTrash: (paths: string[]) => trashPackage(paths, { glob: false }),
  emptyTrash: () => emptyTrashPackage(),
};

let fileToolRuntime: FileToolRuntime = DEFAULT_FILE_TOOL_RUNTIME;

export function setFileToolRuntimeForTest(
  runtime: Partial<FileToolRuntime> | null,
): void {
  fileToolRuntime = runtime
    ? { ...DEFAULT_FILE_TOOL_RUNTIME, ...runtime }
    : DEFAULT_FILE_TOOL_RUNTIME;
}

function normalizeListFilesArgs(args: ListFilesArgs): ListFilesArgs {
  const record: Record<string, unknown> = { ...args };
  const normalized: ListFilesArgs = { ...args };

  if (!normalized.pattern && typeof record.filePattern === "string") {
    normalized.pattern = record.filePattern;
  }

  if (typeof record.maxEntries === "string" && !normalized.maxEntries) {
    const parsed = Number.parseInt(record.maxEntries, 10);
    if (Number.isFinite(parsed)) {
      normalized.maxEntries = parsed;
    }
  }

  if (normalized.maxEntries === undefined && record.maxResults !== undefined) {
    const raw = record.maxResults;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      normalized.maxEntries = raw;
    } else if (typeof raw === "string") {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        normalized.maxEntries = parsed;
      }
    }
  }

  if (typeof normalized.pattern === "string") {
    normalized.pattern = normalizeExtensionPattern(normalized.pattern);
  }

  return normalized;
}

function normalizeExtensionPattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (!/[;,\s]/.test(trimmed)) return trimmed;
  if (trimmed.includes("{") || trimmed.includes("}")) return trimmed;

  const parts = trimmed
    .split(/[;,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return trimmed;
  const extensions: string[] = [];
  for (const part of parts) {
    const match = part.match(/^\*\.([a-z0-9]+)$/i) ?? part.match(/^\.(\w+)$/i);
    if (!match) {
      return trimmed;
    }
    extensions.push(match[1]);
  }
  const unique = [...new Set(extensions)];
  return `*.{${unique.join(",")}}`;
}

// ============================================================
// Tool 1: read_file
// ============================================================

/**
 * Read file contents
 *
 * Security: Uses path sandboxing to ensure file is within workspace
 *
 * @example
 * ```ts
 * const result = await readFile({
 *   path: "src/main.ts",
 * }, "/workspace");
 * ```
 */
export async function readFile(
  args: ReadFileArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<ReadFileResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();

    // Validate path security
    const validPath = await resolveToolPath(
      args.path,
      workspace,
      options?.policy ?? null,
    );

    // Check if file exists
    const stat = await platform.fs.stat(validPath);
    if (stat.isDirectory) {
      return failTool(`Path is a directory, not a file: ${args.path}`);
    }

    // Hard safety limit: reject files larger than system max (2MB)
    assertMaxBytes(
      "read_file size",
      stat.size ?? 0,
      RESOURCE_LIMITS.maxReadBytes,
    );

    // Read file contents
    const content = await platform.fs.readTextFile(validPath);

    const isPartialView = args.maxBytes !== undefined && args.maxBytes > 0 &&
      content.length > args.maxBytes;
    options?.fileStateCache?.trackRead({
      path: validPath,
      content,
      mtimeMs: stat.mtimeMs,
      isPartialView,
    });

    // User-specified maxBytes: truncate content (not reject)
    const userMax = args.maxBytes;
    if (userMax !== undefined && userMax > 0 && content.length > userMax) {
      const truncated = content.slice(0, userMax);
      return okTool({
        path: args.path,
        content: truncated,
        size: stat.size,
        truncated: true,
        message:
          `Read ${userMax} of ${stat.size} bytes from ${args.path} (truncated)`,
      });
    }

    return okTool({
      path: args.path,
      content,
      size: stat.size,
      message: `Read ${stat.size} bytes from ${args.path}`,
    });
  } catch (error) {
    if (error instanceof ResourceLimitError) {
      return failTool(
        `File too large to read. Limit: ${formatBytes(error.limit)}, actual: ${
          formatBytes(error.actual)
        }`,
      );
    }
    const { message } = formatToolError("Failed to read file", error);
    return failTool(message);
  }
}

// ============================================================
// Tool 2: write_file
// ============================================================

/**
 * Write content to file (creates file if it doesn't exist)
 *
 * Security: Uses path sandboxing to ensure file is within workspace
 *
 * @example
 * ```ts
 * const result = await writeFile({
 *   path: "src/new.ts",
 *   content: "export const x = 42;",
 *   createDirs: true
 * }, "/workspace");
 * ```
 */
export async function writeFile(
  args: WriteFileArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<FileOperationResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();

    // Validate path security
    const validPath = await resolveToolPath(
      args.path,
      workspace,
      options?.policy ?? null,
    );
    const parentDir = platform.path.dirname(validPath);

    // Create parent directories if requested
    if (args.createDirs) {
      await platform.fs.mkdir(parentDir, { recursive: true });
    } else if (!await platform.fs.exists(parentDir)) {
      return failTool(
        `Parent directory does not exist: ${platform.path.dirname(args.path)}`,
      );
    }

    // Enforce size limit (bytes)
    const byteLength = TEXT_ENCODER.encode(args.content).length;
    const maxBytes = Math.min(
      args.maxBytes ?? RESOURCE_LIMITS.maxWriteBytes,
      RESOURCE_LIMITS.maxWriteBytes,
    );
    assertMaxBytes("write_file size", byteLength, maxBytes);

    const fileExists = await platform.fs.exists(validPath);
    if (fileExists && options?.fileStateCache) {
      const currentStat = await platform.fs.stat(validPath);
      const currentContent = await platform.fs.readTextFile(validPath);
      const conflict = options.fileStateCache.checkConflict(validPath, {
        content: currentContent,
        mtimeMs: currentStat.mtimeMs,
      });
      if (!conflict.ok) {
        return failTool(
          conflict.reason ?? "File changed. Re-read before overwriting.",
        );
      }
    }

    await atomicWriteTextFile(validPath, args.content);
    options?.fileStateCache?.invalidate(validPath);

    return okTool({
      message: `Wrote ${args.content.length} bytes to ${args.path}`,
    });
  } catch (error) {
    if (error instanceof ResourceLimitError) {
      return failTool(
        `Content too large to write. Limit: ${
          formatBytes(error.limit)
        }, actual: ${formatBytes(error.actual)}`,
      );
    }
    const { message } = formatToolError("Failed to write file", error);
    return failTool(message);
  }
}

// ============================================================
// Tool 3: edit_file
// ============================================================

/**
 * Edit file using find/replace
 *
 * Security: Uses path sandboxing to ensure file is within workspace
 * Modes:
 * - literal: Exact string match and replace
 * - regex: Regular expression find and replace
 *
 * @example
 * ```ts
 * const result = await editFile({
 *   path: "src/config.ts",
 *   find: "DEBUG = false",
 *   replace: "DEBUG = true",
 *   mode: "literal"
 * }, "/workspace");
 * ```
 */
export async function editFile(
  args: EditFileArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<EditFileResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();

    // Validate path security
    const validPath = await resolveToolPath(
      args.path,
      workspace,
      options?.policy ?? null,
    );

    // Enforce size limit before reading
    const stat = await platform.fs.stat(validPath);
    const maxReadBytes = Math.min(
      args.maxBytes ?? RESOURCE_LIMITS.maxReadBytes,
      RESOURCE_LIMITS.maxReadBytes,
    );
    assertMaxBytes("edit_file read size", stat.size ?? 0, maxReadBytes);

    const editableView = options?.fileStateCache?.requireFullView(validPath);
    if (editableView && !editableView.ok) {
      return failTool(
        editableView.reason ?? "File must be re-read before editing.",
      );
    }

    // Read existing content
    const content = await platform.fs.readTextFile(validPath);
    throwIfAborted(options?.signal);
    if (options?.fileStateCache) {
      const conflict = options.fileStateCache.checkConflict(validPath, {
        content,
        mtimeMs: stat.mtimeMs,
      });
      if (!conflict.ok) {
        return failTool(
          conflict.reason ?? "File changed. Re-read before editing.",
        );
      }
    }

    // Validate find string is non-empty (empty string splits every character)
    if (!args.find) {
      return failTool("'find' parameter must be a non-empty string");
    }

    // Perform find/replace
    let newContent: string;
    let replacements = 0;

    if (args.mode === "regex") {
      // Regex mode
      try {
        const regex = new RegExp(args.find, "g");
        const matches = content.match(regex);
        replacements = matches ? matches.length : 0;
        newContent = content.replace(regex, args.replace);
      } catch (error) {
        const { message } = formatToolError("Invalid regex pattern", error);
        return failTool(message);
      }
    } else {
      // Literal mode (default)
      const parts = content.split(args.find);
      replacements = parts.length - 1;
      newContent = parts.join(args.replace);
    }

    // Check if any changes were made
    if (replacements === 0) {
      return failTool(`Pattern not found in file: ${args.find}`, {
        replacements: 0,
      });
    }

    // Enforce size limit before writing
    const byteLength = TEXT_ENCODER.encode(newContent).length;
    const maxWriteBytes = Math.min(
      args.maxBytes ?? RESOURCE_LIMITS.maxWriteBytes,
      RESOURCE_LIMITS.maxWriteBytes,
    );
    assertMaxBytes("edit_file write size", byteLength, maxWriteBytes);

    await atomicWriteTextFile(validPath, newContent);
    options?.fileStateCache?.invalidate(validPath);

    // Generate preview (first 200 chars of changes)
    const preview = truncate(newContent, 200);

    return okTool({
      message: `Made ${replacements} replacement(s) in ${args.path}`,
      replacements,
      preview,
    });
  } catch (error) {
    if (error instanceof ResourceLimitError) {
      return failTool(
        `File too large to edit. Limit: ${formatBytes(error.limit)}, actual: ${
          formatBytes(error.actual)
        }`,
      );
    }
    const { message } = formatToolError("Failed to edit file", error);
    return failTool(message);
  }
}

// ============================================================
// Tool 4: list_files
// ============================================================

/**
 * List files and directories in a path
 *
 * Security: Uses path sandboxing to ensure path is within workspace
 *
 * @example
 * ```ts
 * const result = await listFiles({
 *   path: "src",
 *   recursive: true,
 *   pattern: "*.ts",
 *   maxDepth: 3
 * }, "/workspace");
 * ```
 */
export async function listFiles(
  args: ListFilesArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<ListFilesResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();
    const normalizedArgs = normalizeListFilesArgs(args);

    // Validate path security
    const validPath = await resolveToolPath(
      normalizedArgs.path,
      workspace,
      options?.policy ?? null,
    );

    // Check if path exists and is a directory
    const stat = await platform.fs.stat(validPath);
    if (!stat.isDirectory) {
      return failTool(`Path is not a directory: ${normalizedArgs.path}`);
    }

    const entries: FileEntry[] = [];
    const isAllowedPath = createPolicyPathChecker(
      options?.policy ?? null,
      workspace,
    );

    // Load gitignore patterns to skip node_modules, .git, etc.
    const gitignorePatterns = normalizedArgs.recursive
      ? await loadGitignore(validPath)
      : null;

    // Compile glob pattern once (path-aware by default)
    let patternRegex: RegExp | null = null;
    let basenameRegex: RegExp | null = null;
    if (normalizedArgs.pattern) {
      try {
        patternRegex = globToRegex(normalizedArgs.pattern, { matchPath: true });

        // Back-compat: if pattern has no path separators, also match basenames
        if (
          normalizedArgs.recursive &&
          !normalizedArgs.pattern.includes("/") &&
          !normalizedArgs.pattern.includes("\\")
        ) {
          basenameRegex = globToRegex(normalizedArgs.pattern, {
            matchPath: false,
          });
        }
      } catch (error) {
        if (error instanceof GlobPatternError) {
          return failTool(error.message);
        }
        throw error;
      }
    }

    const matchesPattern = (relativePath: string, name: string): boolean => {
      if (!patternRegex) return true;
      if (patternRegex.test(relativePath)) return true;
      return basenameRegex ? basenameRegex.test(name) : false;
    };

    const mimePrefix = typeof normalizedArgs.mimePrefix === "string"
      ? normalizedArgs.mimePrefix.toLowerCase()
      : undefined;
    const matchesMime = (name: string): boolean => {
      if (!mimePrefix) return true;
      const ext = platform.path.extname(name);
      if (!ext) return false;
      const mime = getMimeTypeForExtension(ext);
      return mime ? mime.toLowerCase().startsWith(mimePrefix) : false;
    };

    const maxEntries = Math.min(
      normalizedArgs.maxEntries ?? RESOURCE_LIMITS.maxListEntries,
      RESOURCE_LIMITS.maxListEntries,
    );

    // Helper to walk directory
    const walk = async (dir: string, relativePath: string, depth: number) => {
      if (
        normalizedArgs.maxDepth !== undefined && depth > normalizedArgs.maxDepth
      ) {
        return;
      }

      for await (const entry of platform.fs.readDir(dir)) {
        throwIfAborted(options?.signal);
        if (entries.length >= maxEntries) {
          return;
        }
        const entryRelativePath = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;

        // Skip gitignored entries (node_modules, .git, build output, etc.)
        if (gitignorePatterns) {
          const checkPath = entry.isDirectory
            ? `${entryRelativePath}/`
            : entryRelativePath;
          if (isIgnored(checkPath, gitignorePatterns)) continue;
        }

        // Get entry info
        const entryPath = platform.path.join(dir, entry.name);
        let size: number | undefined;
        try {
          const entryStat = await platform.fs.lstat(entryPath);
          if (entryStat.isSymlink) {
            // Skip symlinks to avoid leaking info outside workspace
            continue;
          }
          size = entryStat.isFile ? entryStat.size : undefined;
        } catch {
          // Skip if can't stat
          continue;
        }

        // Check pattern match - ONLY for deciding whether to include in results
        // Do NOT block recursion based on pattern!
        const matchesCurrentPattern = matchesPattern(
          entryRelativePath,
          entry.name,
        );
        const matchesCurrentMime = !mimePrefix ||
          (entry.isFile && matchesMime(entry.name));

        // Enforce policy for this path before including
        if (!isAllowedPath(entryPath)) {
          // Skip disallowed paths entirely
          continue;
        }

        // Add to results only if matches pattern
        if (matchesCurrentPattern && matchesCurrentMime) {
          entries.push({
            path: entryRelativePath,
            type: entry.isDirectory ? "directory" : "file",
            size,
          });
          if (entries.length >= maxEntries) {
            return;
          }
        }

        // Recurse into directories if recursive mode enabled
        // ALWAYS recurse regardless of pattern match to find nested files
        if (normalizedArgs.recursive && entry.isDirectory) {
          throwIfAborted(options?.signal);
          // Re-validate with the same policy-aware path logic as the root path.
          try {
            await resolveToolPath(
              entryPath,
              workspace,
              options?.policy ?? null,
            );
            await walk(entryPath, entryRelativePath, depth + 1);
          } catch (error) {
            if (error instanceof SecurityError) {
              // Symlinked directory, disallowed root, or escape attempt - SKIP silently
              continue;
            }
            throw error; // Re-throw unexpected errors
          }
        }
      }
    };

    // Start walking from validated path
    await walk(validPath, "", 0);

    // Sort entries (directories first, then alphabetically)
    entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    });

    const truncated = entries.length >= maxEntries;

    return okTool({
      entries,
      count: entries.length,
      message: truncated
        ? `Found ${entries.length} entries (limit reached)`
        : `Found ${entries.length} entries in ${validPath}`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to list files", error);
    return failTool(message);
  }
}

// ============================================================
// Tool 5: open_path
// ============================================================

/**
 * Open a file or directory with the system default application.
 */
export async function openPath(
  args: OpenPathArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<OpenPathResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();
    const validPath = await resolveToolPath(
      args.path,
      workspace,
      options?.policy ?? null,
    );
    const openablePath = await resolveOpenPathAlias(validPath);

    await platform.openUrl(openablePath);
    return okTool({
      openedPath: openablePath,
      message: `Opened ${args.path}`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to open path", error);
    return failTool(message);
  }
}

async function resolveOpenPathAlias(path: string): Promise<string> {
  const platform = getPlatform();
  try {
    await platform.fs.lstat(path);
    return path;
  } catch {
    // Fall back to tolerant sibling lookup below.
  }

  const parentDir = platform.path.dirname(path);
  const requestedName = platform.path.basename(path);
  const normalizedRequested = normalizeFilenameWhitespace(requestedName);
  const matches: string[] = [];

  try {
    for await (const entry of platform.fs.readDir(parentDir)) {
      if (normalizeFilenameWhitespace(entry.name) === normalizedRequested) {
        matches.push(entry.name);
      }
    }
  } catch {
    return path;
  }

  if (matches.length === 1) {
    return platform.path.join(parentDir, matches[0]!);
  }
  return path;
}

function normalizeFilenameWhitespace(value: string): string {
  return value.normalize("NFC").replace(
    /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/gu,
    " ",
  );
}

interface ResolvedTransferPaths {
  sourcePath: string;
  destinationPath: string;
  sourceInfo: Awaited<
    ReturnType<ReturnType<typeof getPlatform>["fs"]["lstat"]>
  >;
}

async function resolveTransferPaths(
  args: MovePathArgs | CopyPathArgs,
  workspace: string,
  options: ToolExecutionOptions | undefined,
  actionVerb: "move" | "copy",
): Promise<ResolvedTransferPaths> {
  const platform = getPlatform();
  if (
    typeof args.sourcePath !== "string" || args.sourcePath.trim().length === 0
  ) {
    throw new Error("'sourcePath' must be a non-empty string");
  }
  if (
    typeof args.destinationPath !== "string" ||
    args.destinationPath.trim().length === 0
  ) {
    throw new Error("'destinationPath' must be a non-empty string");
  }

  const sourcePath = await resolveOpenPathAlias(
    await resolveToolPath(
      args.sourcePath,
      workspace,
      options?.policy ?? null,
    ),
  );
  const destinationPath = await resolveToolPath(
    args.destinationPath,
    workspace,
    options?.policy ?? null,
  );

  const sourceInfo = await platform.fs.lstat(sourcePath);
  if (sourceInfo.isSymlink) {
    throw new Error(
      `Refusing to ${actionVerb} symlink path: ${args.sourcePath}`,
    );
  }
  if (!sourceInfo.isFile && !sourceInfo.isDirectory) {
    throw new Error(
      `Only files and directories can be ${actionVerb}d: ${args.sourcePath}`,
    );
  }

  if (
    platform.path.normalize(sourcePath) ===
      platform.path.normalize(destinationPath)
  ) {
    throw new Error("sourcePath and destinationPath must be different");
  }

  if (sourceInfo.isDirectory && isPathWithinRoot(destinationPath, sourcePath)) {
    throw new Error(
      `destinationPath must not be inside source directory: ${args.sourcePath}`,
    );
  }

  if (await platform.fs.exists(destinationPath)) {
    throw new Error(
      `Destination already exists: ${args.destinationPath}`,
    );
  }

  const destinationParent = platform.path.dirname(destinationPath);
  if (!(await platform.fs.exists(destinationParent))) {
    throw new Error(
      `Destination parent directory does not exist: ${destinationParent}`,
    );
  }
  const parentInfo = await platform.fs.stat(destinationParent);
  if (!parentInfo.isDirectory) {
    throw new Error(
      `Destination parent is not a directory: ${destinationParent}`,
    );
  }

  return { sourcePath, destinationPath, sourceInfo };
}

function shouldFallbackToCopyAndRemove(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message}`.toLowerCase();
  return text.includes("exdev") || text.includes("cross-device");
}

async function copyResolvedPath(
  sourcePath: string,
  destinationPath: string,
  sourceInfo: { isDirectory: boolean; isFile: boolean },
): Promise<void> {
  const platform = getPlatform();
  if (sourceInfo.isDirectory) {
    await copyDirectoryRecursive(sourcePath, destinationPath);
    return;
  }
  if (sourceInfo.isFile) {
    await platform.fs.copyFile(sourcePath, destinationPath);
  }
}

async function moveResolvedPath(
  sourcePath: string,
  destinationPath: string,
  sourceInfo: { isDirectory: boolean; isFile: boolean },
): Promise<void> {
  const platform = getPlatform();
  try {
    await platform.fs.rename(sourcePath, destinationPath);
    return;
  } catch (error) {
    if (!shouldFallbackToCopyAndRemove(error)) {
      throw error;
    }
  }

  await copyResolvedPath(sourcePath, destinationPath, sourceInfo);
  await platform.fs.remove(sourcePath, {
    recursive: sourceInfo.isDirectory,
  });
}

// ============================================================
// Tool 6: move_to_trash
// ============================================================

/**
 * Move files or directories to the OS trash / recycle bin.
 */
export async function moveToTrash(
  args: MoveToTrashArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<MoveToTrashResult> {
  try {
    throwIfAborted(options?.signal);
    if (!Array.isArray(args.paths) || args.paths.length === 0) {
      return failTool("'paths' must be a non-empty array");
    }

    const platform = getPlatform();
    const resolvedPaths: string[] = [];
    const seen = new Set<string>();

    for (const rawPath of args.paths) {
      if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
        return failTool("Each path in 'paths' must be a non-empty string");
      }
      const validPath = await resolveToolPath(
        rawPath,
        workspace,
        options?.policy ?? null,
      );
      const trashablePath = await resolveOpenPathAlias(validPath);
      const stat = await platform.fs.lstat(trashablePath);
      if (stat.isSymlink) {
        return failTool(`Refusing to trash symlink path: ${rawPath}`);
      }
      if (seen.has(trashablePath)) {
        continue;
      }
      seen.add(trashablePath);
      resolvedPaths.push(trashablePath);
    }

    await fileToolRuntime.moveToTrash(resolvedPaths);
    return okTool({
      trashedPaths: resolvedPaths,
      count: resolvedPaths.length,
      message: `Moved ${resolvedPaths.length} item${
        resolvedPaths.length === 1 ? "" : "s"
      } to Trash`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to move items to Trash", error);
    return failTool(message);
  }
}

// ============================================================
// Tool 7: reveal_path
// ============================================================

/**
 * Reveal a path in the system file manager, selecting the exact target when supported.
 */
export async function revealPath(
  args: RevealPathArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<RevealPathResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();
    const validPath = await resolveToolPath(
      args.path,
      workspace,
      options?.policy ?? null,
    );
    const revealablePath = await resolveOpenPathAlias(validPath);
    const stat = await platform.fs.lstat(revealablePath);
    if (stat.isSymlink) {
      return failTool(`Refusing to reveal symlink path: ${args.path}`);
    }

    const fallbackPath = await revealResolvedPath(revealablePath);
    const exact = fallbackPath === undefined;
    return okTool({
      revealedPath: revealablePath,
      fallbackPath,
      exact,
      message: exact
        ? `Revealed ${args.path}`
        : `Opened parent directory for ${args.path}`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to reveal path", error);
    return failTool(message);
  }
}

function formatCommandOutput(
  result: { stdout: Uint8Array; stderr: Uint8Array; code: number },
  decoder: TextDecoder,
): string {
  return decoder.decode(result.stderr).trim() ||
    decoder.decode(result.stdout).trim();
}

function formatWindowsSelectArg(path: string): string {
  const normalized = path.replaceAll("/", "\\");
  return `/select,"${normalized}"`;
}

async function revealResolvedPath(path: string): Promise<string | undefined> {
  const platform = getPlatform();
  const decoder = new TextDecoder();

  if (platform.build.os === "darwin") {
    const result = await platform.command.output({
      cmd: ["open", "-R", path],
    });
    if (!result.success) {
      const output = formatCommandOutput(result, decoder);
      throw new Error(
        output ||
          `open -R failed with code ${result.code}`,
      );
    }
    return undefined;
  }

  if (platform.build.os === "windows") {
    const result = await platform.command.output({
      cmd: ["explorer.exe", formatWindowsSelectArg(path)],
    });
    const output = formatCommandOutput(result, decoder);
    // explorer.exe frequently returns a non-zero exit code even when the
    // selection succeeds, so treat quiet launches as success.
    if (!result.success && output !== "") {
      throw new Error(
        output ||
          `explorer.exe failed with code ${result.code}`,
      );
    }
    return undefined;
  }

  const parentPath = platform.path.dirname(path);
  await platform.openUrl(parentPath);
  return parentPath;
}

// ============================================================
// Tool 8: empty_trash
// ============================================================

/**
 * Empty the OS trash / recycle bin.
 */
export async function emptyTrash(
  _args: EmptyTrashArgs,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<EmptyTrashResult> {
  try {
    throwIfAborted(options?.signal);
    await fileToolRuntime.emptyTrash();
    return okTool({
      emptied: true,
      message: "Emptied Trash",
    });
  } catch (error) {
    const { message } = formatToolError("Failed to empty Trash", error);
    return failTool(message);
  }
}

// ============================================================
// Tool 9: make_directory
// ============================================================

/**
 * Create a directory for local organization work.
 */
export async function makeDirectory(
  args: MakeDirectoryArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<MakeDirectoryResult> {
  try {
    throwIfAborted(options?.signal);
    if (typeof args.path !== "string" || args.path.trim().length === 0) {
      return failTool("'path' must be a non-empty string");
    }

    const platform = getPlatform();
    const directoryPath = await resolveToolPath(
      args.path,
      workspace,
      options?.policy ?? null,
    );

    if (await platform.fs.exists(directoryPath)) {
      const info = await platform.fs.stat(directoryPath);
      if (!info.isDirectory) {
        return failTool(
          `Path already exists and is not a directory: ${args.path}`,
        );
      }
      return okTool({
        createdPath: directoryPath,
        alreadyExisted: true,
        message: `Directory already exists: ${args.path}`,
      });
    }

    await platform.fs.mkdir(directoryPath, { recursive: true });
    return okTool({
      createdPath: directoryPath,
      alreadyExisted: false,
      message: `Created directory ${args.path}`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to create directory", error);
    return failTool(message);
  }
}

// ============================================================
// Tool 10: move_path
// ============================================================

/**
 * Move or rename a file or directory.
 */
export async function movePath(
  args: MovePathArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<MovePathResult> {
  try {
    throwIfAborted(options?.signal);
    const { sourcePath, destinationPath, sourceInfo } =
      await resolveTransferPaths(
        args,
        workspace,
        options,
        "move",
      );

    await moveResolvedPath(sourcePath, destinationPath, sourceInfo);
    return okTool({
      sourcePath,
      destinationPath,
      message: `Moved ${args.sourcePath} to ${args.destinationPath}`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to move path", error);
    return failTool(message);
  }
}

// ============================================================
// Tool 11: copy_path
// ============================================================

/**
 * Copy a file or directory.
 */
export async function copyPath(
  args: CopyPathArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<CopyPathResult> {
  try {
    throwIfAborted(options?.signal);
    const { sourcePath, destinationPath, sourceInfo } =
      await resolveTransferPaths(
        args,
        workspace,
        options,
        "copy",
      );

    await copyResolvedPath(sourcePath, destinationPath, sourceInfo);
    return okTool({
      sourcePath,
      destinationPath,
      message: `Copied ${args.sourcePath} to ${args.destinationPath}`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to copy path", error);
    return failTool(message);
  }
}

// ============================================================
// Tool 12: file_metadata
// ============================================================

/**
 * Get metadata (size, dates, type) for one or more paths.
 */
export async function fileMetadata(
  args: FileMetadataArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<FileMetadataResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();
    const rawPaths = Array.isArray(args.paths) ? args.paths : [args.paths];
    if (rawPaths.length === 0) {
      return failTool("'paths' must be a non-empty string or array");
    }

    const entries: FileMetadataEntry[] = [];

    for (const rawPath of rawPaths) {
      if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
        entries.push({ path: String(rawPath), exists: false });
        continue;
      }

      let validPath: string;
      try {
        validPath = await resolveToolPath(
          rawPath,
          workspace,
          options?.policy ?? null,
        );
      } catch {
        entries.push({ path: rawPath, exists: false });
        continue;
      }

      try {
        const stat = await platform.fs.lstat(validPath);
        const ext = platform.path.extname(validPath).toLowerCase();
        const entry: FileMetadataEntry = {
          path: rawPath,
          exists: true,
          isFile: stat.isFile,
          isDirectory: stat.isDirectory,
          isSymlink: stat.isSymlink,
          size: stat.size,
        };
        if (stat.mtimeMs != null) {
          entry.modified = new Date(stat.mtimeMs).toISOString();
        }
        if (stat.isFile && ext) {
          const mime = getMimeTypeForExtension(ext);
          if (mime) entry.mimeType = mime;
        }
        entries.push(entry);
      } catch {
        entries.push({ path: rawPath, exists: false });
      }
    }

    return okTool({
      entries,
      count: entries.length,
      message: `Retrieved metadata for ${entries.length} path${
        entries.length === 1 ? "" : "s"
      }`,
    });
  } catch (error) {
    const { message } = formatToolError(
      "Failed to retrieve file metadata",
      error,
    );
    return failTool(message);
  }
}

// ============================================================
// Tool 13: archive_files
// ============================================================

/**
 * Create an archive (zip or tar.gz) from files/directories.
 */
export async function archiveFiles(
  args: ArchiveFilesArgs,
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<ArchiveFilesResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();
    const decoder = new TextDecoder();

    if (!Array.isArray(args.paths) || args.paths.length === 0) {
      return failTool("'paths' must be a non-empty array");
    }

    const format: "zip" | "tar.gz" = args.format ?? "zip";
    if (format !== "zip" && format !== "tar.gz") {
      return failTool(`Unsupported archive format: ${String(args.format)}`);
    }
    if (platform.build.os === "windows" && format === "tar.gz") {
      return failTool('tar.gz is not supported on Windows. Use format: "zip".');
    }

    const outputPath = await resolveToolPath(
      args.outputPath,
      workspace,
      options?.policy ?? null,
    );
    const inputPaths: string[] = [];
    for (const rawPath of args.paths) {
      if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
        return failTool("Each path in 'paths' must be a non-empty string");
      }
      const validPath = await resolveToolPath(
        rawPath,
        workspace,
        options?.policy ?? null,
      );
      if (!(await platform.fs.exists(validPath))) {
        return failTool(`Input path does not exist: ${rawPath}`);
      }
      inputPaths.push(validPath);
    }

    if (
      !args.overwrite &&
      await platform.fs.exists(outputPath)
    ) {
      return failTool(
        `Archive already exists at ${args.outputPath}. Set overwrite: true to replace it.`,
      );
    }

    for (const inputPath of inputPaths) {
      const stat = await platform.fs.stat(inputPath);
      if (
        stat.isDirectory && isPathWithinRoot(outputPath, inputPath)
      ) {
        return failTool(
          `outputPath must not be inside source directory: ${inputPath}`,
        );
      }
    }

    await platform.fs.mkdir(platform.path.dirname(outputPath), {
      recursive: true,
    });

    const cwd = platform.build.os === "windows"
      ? workspace
      : getCommonParentDirectory(inputPaths, platform);
    const relativeInputs = inputPaths.map((path) => {
      const rel = platform.path.relative(cwd, path);
      return rel === "" ? "." : rel;
    });
    const archiveInputs = platform.build.os === "windows"
      ? inputPaths
      : relativeInputs;
    const command = buildArchiveCommand(
      platform,
      format,
      outputPath,
      archiveInputs,
      args.overwrite === true,
    );

    const result = await platform.command.output({ cmd: command, cwd });
    throwIfAborted(options?.signal);

    const stdout = decoder.decode(result.stdout).trim();
    const stderr = decoder.decode(result.stderr).trim();
    if (!result.success) {
      return failTool(
        `Archive command failed with exit code ${result.code}`,
        { stdout, stderr, exitCode: result.code },
      );
    }

    return okTool({
      outputPath,
      inputCount: inputPaths.length,
      format,
      stdout,
      stderr,
      exitCode: result.code,
      message:
        `Created ${format} archive at ${args.outputPath} from ${inputPaths.length} path(s)`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to create archive", error);
    return failTool(message);
  }
}

function buildArchiveCommand(
  platform: ReturnType<typeof getPlatform>,
  format: "zip" | "tar.gz",
  outputPath: string,
  relativeInputs: string[],
  overwrite: boolean,
): string[] {
  if (platform.build.os === "windows") {
    const quotedPaths = relativeInputs.map(quotePowerShellString).join(", ");
    const force = overwrite ? " -Force" : "";
    const script =
      `$ErrorActionPreference='Stop'; Compress-Archive -Path @(${quotedPaths}) -DestinationPath ${
        quotePowerShellString(outputPath)
      }${force}`;
    return ["powershell", "-NoProfile", "-Command", script];
  }

  if (format === "tar.gz") {
    return ["tar", "-czf", outputPath, ...relativeInputs];
  }
  return ["zip", "-r", outputPath, ...relativeInputs];
}

function quotePowerShellString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function getCommonParentDirectory(
  paths: string[],
  platform: ReturnType<typeof getPlatform>,
): string {
  let common = platform.path.dirname(paths[0]);
  for (const path of paths.slice(1)) {
    while (!isPathWithinRoot(path, common)) {
      const parent = platform.path.dirname(common);
      if (parent === common) {
        return common;
      }
      common = parent;
    }
  }
  return common;
}

function formatListFilesResult(
  result: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!isObjectValue(result)) return null;
  if (result.success !== true) return null;
  const entriesRaw = (result as { entries?: unknown }).entries;
  if (!Array.isArray(entriesRaw)) return null;
  const message = typeof (result as { message?: unknown }).message === "string"
    ? String((result as { message?: unknown }).message)
    : `Found ${entriesRaw.length} entries`;

  const lines: string[] = [];
  for (const entry of entriesRaw) {
    if (!isObjectValue(entry)) continue;
    const path = typeof entry.path === "string" ? entry.path : "";
    if (!path) continue;
    const type = entry.type === "directory" ? "directory" : "file";
    lines.push(type === "directory" ? `${path}/` : path);
  }

  const display = lines.length > 0
    ? `${message}\n${lines.join("\n")}`
    : message;

  const llmEntries = entriesRaw
    .filter(isObjectValue)
    .map((entry) => ({
      path: typeof entry.path === "string" ? entry.path : undefined,
      type: entry.type === "directory" ? "directory" : "file",
      size: typeof entry.size === "number" ? entry.size : undefined,
    }));

  return {
    summaryDisplay: message,
    returnDisplay: display,
    llmContent: JSON.stringify(
      {
        message,
        entries: llmEntries,
        count: llmEntries.length,
      },
      null,
      2,
    ),
  };
}

function formatReadFileResult(
  result: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!isObjectValue(result) || result.success !== true) return null;
  const content = typeof result.content === "string"
    ? result.content
    : undefined;
  if (content === undefined) return null;
  const path = typeof result.path === "string" ? result.path : "file";
  const size = typeof result.size === "number" ? result.size : undefined;
  const message = typeof result.message === "string" && result.message.trim()
    ? result.message
    : `Read ${path}`;
  const detailLines = [`File: ${path}`];
  if (size !== undefined) {
    detailLines.push(`Size: ${size} bytes`);
  }
  detailLines.push("");
  detailLines.push(content);
  return {
    summaryDisplay: message,
    returnDisplay: detailLines.join("\n").trimEnd(),
    llmContent: detailLines.join("\n").trimEnd(),
  };
}

function formatOpenPathResult(
  result: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!isObjectValue(result) || result.success !== true) return null;
  const openedPath = typeof result.openedPath === "string"
    ? result.openedPath
    : undefined;
  if (!openedPath) return null;
  const message = typeof result.message === "string" && result.message.trim()
    ? result.message
    : `Opened ${openedPath}`;
  return {
    summaryDisplay: message,
    returnDisplay: `Opened ${openedPath}`,
    llmContent:
      `Opened ${openedPath}. The open action already succeeded. Do not retry opening the same path unless the user asks again.`,
  };
}

function formatMoveToTrashResult(
  result: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!isObjectValue(result) || result.success !== true) return null;
  const trashedPaths = Array.isArray(result.trashedPaths)
    ? result.trashedPaths.filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0
    )
    : [];
  const message = typeof result.message === "string" && result.message.trim()
    ? result.message
    : `Moved ${trashedPaths.length} item${
      trashedPaths.length === 1 ? "" : "s"
    } to Trash`;
  const detail = trashedPaths.length > 0
    ? `${message}\n${trashedPaths.join("\n")}`
    : message;
  return {
    summaryDisplay: message,
    returnDisplay: detail,
    llmContent:
      `${message}. The trash action already succeeded. Do not retry it unless the user asks again.`,
  };
}

function formatRevealPathResult(
  result: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!isObjectValue(result) || result.success !== true) return null;
  const revealedPath = typeof result.revealedPath === "string"
    ? result.revealedPath
    : undefined;
  if (!revealedPath) return null;
  const fallbackPath = typeof result.fallbackPath === "string"
    ? result.fallbackPath
    : undefined;
  const message = typeof result.message === "string" && result.message.trim()
    ? result.message
    : `Revealed ${revealedPath}`;
  const detailLines = [message, `Target: ${revealedPath}`];
  if (fallbackPath) {
    detailLines.push(`Opened: ${fallbackPath}`);
  }
  return {
    summaryDisplay: message,
    returnDisplay: detailLines.join("\n"),
    llmContent:
      `${message}. The reveal action already succeeded. Do not retry it unless the user asks again.`,
  };
}

function formatEmptyTrashResult(
  result: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!isObjectValue(result) || result.success !== true) return null;
  const message = typeof result.message === "string" && result.message.trim()
    ? result.message
    : "Emptied Trash";
  return {
    summaryDisplay: message,
    returnDisplay: message,
    llmContent:
      `${message}. The trash has already been emptied. Do not retry unless the user asks again.`,
  };
}

function formatMakeDirectoryResult(
  result: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!isObjectValue(result) || result.success !== true) return null;
  const createdPath = typeof result.createdPath === "string"
    ? result.createdPath
    : undefined;
  if (!createdPath) return null;
  const alreadyExisted = result.alreadyExisted === true;
  const message = typeof result.message === "string" && result.message.trim()
    ? result.message
    : alreadyExisted
    ? `Directory already exists: ${createdPath}`
    : `Created directory ${createdPath}`;
  return {
    summaryDisplay: message,
    returnDisplay: `${message}\nDirectory: ${createdPath}`,
    llmContent:
      `${message}. The directory step already succeeded. Do not retry it unless the user asks again.`,
  };
}

function formatMovePathResult(
  result: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!isObjectValue(result) || result.success !== true) return null;
  const sourcePath = typeof result.sourcePath === "string"
    ? result.sourcePath
    : undefined;
  const destinationPath = typeof result.destinationPath === "string"
    ? result.destinationPath
    : undefined;
  if (!sourcePath || !destinationPath) return null;
  const message = typeof result.message === "string" && result.message.trim()
    ? result.message
    : `Moved ${sourcePath} to ${destinationPath}`;
  return {
    summaryDisplay: message,
    returnDisplay: `${message}\nFrom: ${sourcePath}\nTo: ${destinationPath}`,
    llmContent:
      `${message}. The move already succeeded. Do not retry it unless the user asks again.`,
  };
}

function formatCopyPathResult(
  result: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!isObjectValue(result) || result.success !== true) return null;
  const sourcePath = typeof result.sourcePath === "string"
    ? result.sourcePath
    : undefined;
  const destinationPath = typeof result.destinationPath === "string"
    ? result.destinationPath
    : undefined;
  if (!sourcePath || !destinationPath) return null;
  const message = typeof result.message === "string" && result.message.trim()
    ? result.message
    : `Copied ${sourcePath} to ${destinationPath}`;
  return {
    summaryDisplay: message,
    returnDisplay: `${message}\nFrom: ${sourcePath}\nTo: ${destinationPath}`,
    llmContent:
      `${message}. The copy already succeeded. Do not retry it unless the user asks again.`,
  };
}

function formatFileMetadataResult(
  result: unknown,
):
  | { summaryDisplay: string; returnDisplay: string; llmContent?: string }
  | null {
  if (!isObjectValue(result) || result.success !== true) return null;
  const entriesRaw = (result as { entries?: unknown }).entries;
  if (!Array.isArray(entriesRaw)) return null;
  const message = typeof (result as { message?: unknown }).message === "string"
    ? String((result as { message?: unknown }).message)
    : `Retrieved metadata for ${entriesRaw.length} path(s)`;

  const lines: string[] = [];
  for (const entry of entriesRaw) {
    if (!isObjectValue(entry)) continue;
    const path = typeof entry.path === "string" ? entry.path : "?";
    if (entry.exists === false) {
      lines.push(`${path}: not found`);
      continue;
    }
    const parts: string[] = [path];
    if (entry.isDirectory === true) parts.push("directory");
    else if (entry.isFile === true) parts.push("file");
    if (typeof entry.size === "number") {
      parts.push(formatBytes(entry.size));
    }
    if (typeof entry.mimeType === "string") parts.push(entry.mimeType);
    if (typeof entry.modified === "string") {
      parts.push(`modified ${entry.modified}`);
    }
    lines.push(parts.join("  "));
  }

  return {
    summaryDisplay: message,
    returnDisplay: lines.length > 0
      ? `${message}\n${lines.join("\n")}`
      : message,
  };
}

// ============================================================
// Tool Registry
// ============================================================

/**
 * All file tools with metadata
 * Used by orchestrator to discover and invoke tools
 */
export const FILE_TOOLS = {
  read_file: {
    fn: readFile,
    description:
      "Read file contents for code, notes, configs, and documents. Use this for ALL file reading — never use shell_exec with cat/head/tail.",
    category: "read",
    replaces: "cat/head/tail",
    safetyLevel: "L0",
    args: {
      path:
        "string - Path to file (relative to workspace or absolute if allowed by policy)",
      maxBytes:
        "number (optional) - Max bytes to return; content is truncated if file exceeds this (capped at 2MB)",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      path: "string - File path (on success)",
      content: "string - File contents (on success)",
      size: "number - File size in bytes (on success)",
      truncated:
        "boolean - Whether content was truncated by maxBytes (on success)",
      message: "string - Human-readable result message",
    },
    formatResult: formatReadFileResult,
  },
  write_file: {
    fn: writeFile,
    description:
      "Write or overwrite a text file. Use this for notes, configs, generated content, and other direct file output.",
    category: "write",
    safetyLevel: "L1",
    args: {
      path:
        "string - Path to file (relative to workspace or absolute if allowed by policy)",
      content: "string - Content to write",
      createDirs:
        "boolean (optional) - Create parent directories (default: false)",
      maxBytes: "number (optional) - Max bytes to write (capped by limits)",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      message: "string - Human-readable result message",
    },
  },
  edit_file: {
    fn: editFile,
    description:
      "Edit a text file using find/replace. Use this for code, notes, configs, and other text updates instead of shell_exec with sed/awk.",
    category: "write",
    replaces: "sed/awk",
    safetyLevel: "L1",
    args: {
      path:
        "string - Path to file (relative to workspace or absolute if allowed by policy)",
      find: "string - Text to find",
      replace: "string - Replacement text",
      mode: "string (optional) - 'literal' or 'regex' (default: literal)",
      maxBytes:
        "number (optional) - Max bytes to read/write (capped by limits)",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      replacements: "number - Number of replacements made (on success)",
      preview: "string - Preview of updated content (on success)",
      message: "string - Human-readable result message",
    },
  },
  list_files: {
    fn: listFiles,
    description:
      `List files and directories in a path. Use this instead of shell_exec with ls/find.

IMPORTANT:
- For "all/every/entire" requests, set recursive: true
- For specific file types, use pattern with glob syntax (e.g., "*.pdf", "*.{jpg,png}", "*.ts")
- For common folders use "~/Downloads", "~/Desktop", "~/Documents"

Examples:
1. "list all TypeScript files in src"
   → list_files({path: "src", recursive: true, pattern: "*.ts"})
2. "show images in Downloads"
   → list_files({path: "~/Downloads", recursive: true, mimePrefix: "image/"})
3. "list videos on Desktop"
   → list_files({path: "~/Desktop", recursive: true, mimePrefix: "video/"})
4. "list PDF files in Documents"
   → list_files({path: "~/Documents", pattern: "*.pdf"})`,
    category: "read",
    replaces: "ls/find",
    safetyLevel: "L0",
    formatResult: formatListFilesResult,
    args: {
      path:
        "string - Path to directory. Use '.' for current, '~/Downloads' for user folders, or relative paths like 'src/components'",
      recursive:
        "boolean (optional) - Search subdirectories? Use true for 'all/every/entire' requests. Default: false",
      pattern:
        "string (optional) - Glob pattern to filter files. Examples: '*.ts', '*.{jpg,png}', '*.pdf'. Omit to list all files",
      filePattern: "string (optional) - Alias for pattern",
      mimePrefix:
        "string (optional) - MIME type prefix filter (e.g., 'image/', 'video/', 'application/pdf'). Use pattern instead for most cases",
      maxDepth: "number (optional) - Maximum recursion depth. Rarely needed",
      maxEntries: "number (optional) - Max entries to return. Rarely needed",
      maxResults: "number (optional) - Alias for maxEntries",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      entries: "FileEntry[] - Listed entries (on success)",
      count: "number - Number of entries returned (on success)",
      message: "string - Human-readable result message",
    },
  },
  open_path: {
    fn: openPath,
    description:
      "PREFERRED way to open any file, folder, or path. Opens in the system default app (Finder/Explorer/file manager). Use this instead of shell_exec 'open'. No permission required.",
    category: "meta",
    replaces: "open",
    safetyLevel: "L0",
    terminalOnSuccess: true,
    formatResult: formatOpenPathResult,
    args: {
      path:
        "string - Path to open (e.g., '~/Downloads', '~/.Trash', './notes.txt')",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      openedPath: "string - Resolved path that was opened (on success)",
      message: "string - Human-readable result message",
    },
    safety: "Read-only desktop action: opens path in default app.",
  },
  move_to_trash: {
    fn: moveToTrash,
    description:
      "Move files or folders to the OS Trash/Recycle Bin. Prefer this over shell deletion for reversible cleanup tasks.",
    category: "write",
    safetyLevel: "L1",
    formatResult: formatMoveToTrashResult,
    args: {
      paths:
        "string[] - Files or folders to move to Trash (relative to workspace or absolute if allowed by policy)",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      trashedPaths: "string[] - Resolved paths moved to Trash (on success)",
      count: "number - Number of items moved (on success)",
      message: "string - Human-readable result message",
    },
    safety:
      "Reversible cleanup action: moves items to the OS trash / recycle bin and requires one-time confirmation.",
  },
  reveal_path: {
    fn: revealPath,
    description:
      "Reveal a file or folder in the system file manager. Prefer this when the user wants to show or select an exact path instead of opening it.",
    category: "meta",
    replaces: "open -R/explorer /select",
    safetyLevel: "L0",
    terminalOnSuccess: true,
    formatResult: formatRevealPathResult,
    args: {
      path:
        "string - Path to reveal in the file manager (for example '~/Downloads/file.pdf' or './notes.txt')",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      revealedPath: "string - Resolved target path (on success)",
      fallbackPath:
        "string (optional) - Parent directory opened when exact reveal is unavailable",
      exact:
        "boolean - Whether the file manager revealed the exact target rather than a fallback directory",
      message: "string - Human-readable result message",
    },
    safety:
      "Read-only desktop action: shows a target in the system file manager without modifying it.",
  },
  empty_trash: {
    fn: emptyTrash,
    description:
      "Empty the OS Trash/Recycle Bin. Use this only when the user explicitly wants permanent deletion of trashed items.",
    category: "write",
    safetyLevel: "L2",
    formatResult: formatEmptyTrashResult,
    args: {},
    returns: {
      success: "boolean - Whether the operation succeeded",
      emptied: "boolean - True when the trash was emptied",
      message: "string - Human-readable result message",
    },
    safety:
      "Permanent deletion: empties the OS trash / recycle bin and always requires confirmation.",
  },
  make_directory: {
    fn: makeDirectory,
    description:
      "Create a directory for local organization work. Use this instead of shell_exec with mkdir when preparing folders for notes, documents, or cleanup flows.",
    category: "write",
    replaces: "mkdir",
    safetyLevel: "L1",
    formatResult: formatMakeDirectoryResult,
    args: {
      path:
        "string - Directory path to create (relative to workspace or absolute if allowed by policy)",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      createdPath: "string - Resolved directory path (on success)",
      alreadyExisted:
        "boolean - True when the directory already existed and no write was needed",
      message: "string - Human-readable result message",
    },
    safety:
      "Creates folders on disk for later organization or file moves. Confirm once per session.",
  },
  move_path: {
    fn: movePath,
    description:
      "Move or rename a file or folder. Use this for local organization and renaming instead of shell_exec with mv.",
    category: "write",
    replaces: "mv",
    safetyLevel: "L1",
    formatResult: formatMovePathResult,
    args: {
      sourcePath:
        "string - Existing file or folder to move (relative to workspace or absolute if allowed by policy)",
      destinationPath:
        "string - New target path. Parent directory must already exist.",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      sourcePath: "string - Resolved original path (on success)",
      destinationPath: "string - Resolved destination path (on success)",
      message: "string - Human-readable result message",
    },
    safety:
      "Mutates the filesystem by moving or renaming items. Confirm once per session.",
  },
  copy_path: {
    fn: copyPath,
    description:
      "Copy a file or folder to a new path. Use this for backups, reorganization, or duplicating local assets instead of shell_exec with cp.",
    category: "write",
    replaces: "cp",
    safetyLevel: "L1",
    formatResult: formatCopyPathResult,
    args: {
      sourcePath:
        "string - Existing file or folder to copy (relative to workspace or absolute if allowed by policy)",
      destinationPath:
        "string - New target path. Parent directory must already exist.",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      sourcePath: "string - Resolved original path (on success)",
      destinationPath: "string - Resolved destination path (on success)",
      message: "string - Human-readable result message",
    },
    safety:
      "Writes a copied file or folder to disk without deleting the source. Confirm once per session.",
  },
  file_metadata: {
    fn: fileMetadata,
    description:
      "Get metadata for files or directories: size, modified/created dates, MIME type, and whether the path is a file or directory. Accepts one path or many. Use this instead of shell_exec with stat/file/ls -l.",
    category: "read",
    replaces: "stat/file",
    safetyLevel: "L0",
    formatResult: formatFileMetadataResult,
    args: {
      paths:
        "string | string[] - One or more paths to inspect (relative to workspace or absolute if allowed by policy)",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      entries:
        "FileMetadataEntry[] - Metadata entries (path, exists, isFile, isDirectory, isSymlink, size, modified, created, mimeType)",
      count: "number - Number of entries returned",
      message: "string - Human-readable result message",
    },
    safety: "Read-only: retrieves metadata without modifying files.",
  },
  archive_files: {
    fn: archiveFiles,
    description:
      "Create an archive from one or more files/directories (zip by default, tar.gz on Unix).",
    category: "write",
    safetyLevel: "L1",
    args: {
      paths: "string[] - Input file/directory paths to archive",
      outputPath:
        "string - Destination archive path (e.g., '~/Desktop/output.zip')",
      format: "string (optional) - 'zip' (default) or 'tar.gz' (Unix only)",
      overwrite: "boolean (optional) - Overwrite destination if it exists",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      outputPath: "string - Resolved output archive path (on success)",
      inputCount: "number - Number of archived input paths (on success)",
      format: "string - Archive format used",
      stdout: "string - Command output",
      stderr: "string - Command error output",
      exitCode: "number - Archive command exit code",
      message: "string - Human-readable result message",
    },
    safety:
      "Creates archive files on disk. Low-to-moderate risk; confirm once per session.",
  },
} as const;
