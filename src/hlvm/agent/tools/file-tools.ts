/**
 * File Tools - SSOT-compliant file operations for AI agents
 *
 * Provides core file operations with security sandboxing:
 * 1. read_file - Read file contents
 * 2. write_file - Write/create file
 * 3. edit_file - Edit file using find/replace
 * 4. list_files - List directory contents
 * 5. open_path - Open file/folder in the system default app
 * 6. archive_files - Create zip/tar archives from files or folders
 *
 * All operations:
 * - Use path sandboxing (validatePath)
 * - Use platform abstraction (getPlatform)
 * - Handle errors gracefully
 * - Return structured results
 */

import { getPlatform } from "../../../platform/platform.ts";
import { isPathWithinRoot, SecurityError, validatePath } from "../security/path-sandbox.ts";
import type { ToolExecutionOptions } from "../registry.ts";
import { createPolicyPathChecker, resolveToolPath } from "../path-utils.ts";
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
  const unique = Array.from(new Set(extensions));
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

    // Create parent directories if requested
    if (args.createDirs) {
      const parentDir = platform.path.dirname(validPath);
      await platform.fs.mkdir(parentDir, { recursive: true });
    }

    // Enforce size limit (bytes)
    const byteLength = TEXT_ENCODER.encode(args.content).length;
    const maxBytes = Math.min(
      args.maxBytes ?? RESOURCE_LIMITS.maxWriteBytes,
      RESOURCE_LIMITS.maxWriteBytes,
    );
    assertMaxBytes("write_file size", byteLength, maxBytes);

    const existed = await platform.fs.exists(validPath);
    await options?.checkpointRecorder?.captureFileMutation(validPath, {
      status: existed ? "modified" : "created",
    });

    // Write file
    await platform.fs.writeTextFile(validPath, args.content);

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

    // Read existing content
    const content = await platform.fs.readTextFile(validPath);
    throwIfAborted(options?.signal);

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

    await options?.checkpointRecorder?.captureFileMutation(validPath, {
      status: "modified",
    });

    // Write updated content
    await platform.fs.writeTextFile(validPath, newContent);

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
          // CRITICAL: Validate subdirectory isn't a symlink escape
          try {
            await validatePath(entryPath, workspace);
            // Only recurse if validation succeeds
            await walk(entryPath, entryRelativePath, depth + 1);
          } catch (error) {
            if (error instanceof SecurityError) {
              // Symlinked directory or escape attempt - SKIP silently
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

    await platform.openUrl(validPath);
    return okTool({
      openedPath: validPath,
      message: `Opened ${args.path}`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to open path", error);
    return failTool(message);
  }
}

// ============================================================
// Tool 6: archive_files
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

    const outputExists = await platform.fs.exists(outputPath);
    await options?.checkpointRecorder?.captureFileMutation(outputPath, {
      status: outputExists ? "modified" : "created",
    });

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
): { summaryDisplay: string; returnDisplay: string; llmContent?: string } | null {
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
): { summaryDisplay: string; returnDisplay: string; llmContent?: string } | null {
  if (!isObjectValue(result) || result.success !== true) return null;
  const content = typeof result.content === "string" ? result.content : undefined;
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
    description: "Read file contents. Use this for ALL file reading — never use shell_exec with cat/head/tail.",
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
      truncated: "boolean - Whether content was truncated by maxBytes (on success)",
      message: "string - Human-readable result message",
    },
    formatResult: formatReadFileResult,
  },
  write_file: {
    fn: writeFile,
    description: "Write content to file",
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
    description: "Edit file using find/replace. Use this instead of shell_exec with sed/awk.",
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
    description: `List files and directories in a path. Use this instead of shell_exec with ls/find.

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
    args: {
      path: "string - Path to open (e.g., '~/Downloads', '~/.Trash', './notes.txt')",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      openedPath: "string - Resolved path that was opened (on success)",
      message: "string - Human-readable result message",
    },
    safety: "Read-only desktop action: opens path in default app.",
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
