/**
 * File Tools - SSOT-compliant file operations for AI agents
 *
 * Provides 4 core file operations with security sandboxing:
 * 1. read_file - Read file contents
 * 2. write_file - Write/create file
 * 3. edit_file - Edit file using find/replace
 * 4. list_files - List directory contents
 *
 * All operations:
 * - Use path sandboxing (validatePath)
 * - Use platform abstraction (getPlatform)
 * - Handle errors gracefully
 * - Return structured results
 */

import { getPlatform } from "../../../platform/platform.ts";
import { validatePath, SecurityError } from "../security/path-sandbox.ts";
import {
  enforcePathPolicy,
  isPathAllowedAbsolute,
  type AgentPolicy,
} from "../policy.ts";
import { globToRegex, GlobPatternError } from "../../../common/pattern-utils.ts";
import { RESOURCE_LIMITS } from "../constants.ts";
import {
  assertMaxBytes,
  formatBytes,
  ResourceLimitError,
} from "../../../common/limits.ts";
import { throwIfAborted } from "../../../common/timeout-utils.ts";
import { getErrorMessage } from "../../../common/utils.ts";

// ============================================================
// Types
// ============================================================

/** Result of a successful file operation */
export interface FileOperationResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

/** Arguments for read_file tool */
export interface ReadFileArgs {
  path: string;
  encoding?: "utf8" | "binary";
  maxBytes?: number;
}

/** Result of read_file operation */
export interface ReadFileResult extends FileOperationResult {
  content?: string;
  size?: number;
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
export interface EditFileResult extends FileOperationResult {
  replacements?: number;
  preview?: string;
}

/** Arguments for list_files tool */
export interface ListFilesArgs {
  path: string;
  recursive?: boolean;
  pattern?: string;
  maxDepth?: number;
  maxEntries?: number;
}

/** File entry from list_files */
export interface FileEntry {
  path: string;
  type: "file" | "directory";
  size?: number;
}

/** Result of list_files operation */
export interface ListFilesResult extends FileOperationResult {
  entries?: FileEntry[];
  count?: number;
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
 *   encoding: "utf8"
 * }, "/workspace");
 * ```
 */
export async function readFile(
  args: ReadFileArgs,
  workspace: string,
  options?: { signal?: AbortSignal; policy?: AgentPolicy | null }
): Promise<ReadFileResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();

    // Validate path security
    const validPath = await validatePath(args.path, workspace);
    enforcePathPolicy(options?.policy ?? null, workspace, validPath, args.path);

    // Check if file exists
    const stat = await platform.fs.stat(validPath);
    if (stat.isDirectory) {
      return {
        success: false,
        message: `Path is a directory, not a file: ${args.path}`,
      };
    }

    // Enforce size limit
    const maxBytes = Math.min(
      args.maxBytes ?? RESOURCE_LIMITS.maxReadBytes,
      RESOURCE_LIMITS.maxReadBytes,
    );
    assertMaxBytes("read_file size", stat.size ?? 0, maxBytes);

    // Read file contents
    const content = await platform.fs.readTextFile(validPath);

    return {
      success: true,
      content,
      size: stat.size,
      message: `Read ${stat.size} bytes from ${args.path}`,
    };
  } catch (error) {
    if (error instanceof ResourceLimitError) {
      return {
        success: false,
        message:
          `File too large to read. Limit: ${formatBytes(error.limit)}, actual: ${formatBytes(error.actual)}`,
      };
    }
    return {
      success: false,
      message: `Failed to read file: ${getErrorMessage(error)}`,
    };
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
  options?: { signal?: AbortSignal; policy?: AgentPolicy | null }
): Promise<FileOperationResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();

    // Validate path security
    const validPath = await validatePath(args.path, workspace);
    enforcePathPolicy(options?.policy ?? null, workspace, validPath, args.path);

    // Create parent directories if requested
    if (args.createDirs) {
      const parentDir = platform.path.dirname(validPath);
      await platform.fs.mkdir(parentDir, { recursive: true });
    }

    // Enforce size limit (bytes)
    const byteLength = new TextEncoder().encode(args.content).length;
    const maxBytes = Math.min(
      args.maxBytes ?? RESOURCE_LIMITS.maxWriteBytes,
      RESOURCE_LIMITS.maxWriteBytes,
    );
    assertMaxBytes("write_file size", byteLength, maxBytes);

    // Write file
    await platform.fs.writeTextFile(validPath, args.content);

    return {
      success: true,
      message: `Wrote ${args.content.length} bytes to ${args.path}`,
    };
  } catch (error) {
    if (error instanceof ResourceLimitError) {
      return {
        success: false,
        message:
          `Content too large to write. Limit: ${formatBytes(error.limit)}, actual: ${formatBytes(error.actual)}`,
      };
    }
    return {
      success: false,
      message: `Failed to write file: ${getErrorMessage(error)}`,
    };
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
  options?: { signal?: AbortSignal; policy?: AgentPolicy | null }
): Promise<EditFileResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();

    // Validate path security
    const validPath = await validatePath(args.path, workspace);
    enforcePathPolicy(options?.policy ?? null, workspace, validPath, args.path);

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
        return {
          success: false,
          message: `Invalid regex pattern: ${getErrorMessage(error)}`,
        };
      }
    } else {
      // Literal mode (default)
      const parts = content.split(args.find);
      replacements = parts.length - 1;
      newContent = parts.join(args.replace);
    }

    // Check if any changes were made
    if (replacements === 0) {
      return {
        success: false,
        message: `Pattern not found in file: ${args.find}`,
        replacements: 0,
      };
    }

    // Enforce size limit before writing
    const byteLength = new TextEncoder().encode(newContent).length;
    const maxWriteBytes = Math.min(
      args.maxBytes ?? RESOURCE_LIMITS.maxWriteBytes,
      RESOURCE_LIMITS.maxWriteBytes,
    );
    assertMaxBytes("edit_file write size", byteLength, maxWriteBytes);

    // Write updated content
    await platform.fs.writeTextFile(validPath, newContent);

    // Generate preview (first 200 chars of changes)
    const preview = newContent.length > 200
      ? newContent.substring(0, 200) + "..."
      : newContent;

    return {
      success: true,
      message: `Made ${replacements} replacement(s) in ${args.path}`,
      replacements,
      preview,
    };
  } catch (error) {
    if (error instanceof ResourceLimitError) {
      return {
        success: false,
        message:
          `File too large to edit. Limit: ${formatBytes(error.limit)}, actual: ${formatBytes(error.actual)}`,
      };
    }
    return {
      success: false,
      message: `Failed to edit file: ${getErrorMessage(error)}`,
    };
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
  options?: { signal?: AbortSignal; policy?: AgentPolicy | null }
): Promise<ListFilesResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();

    // Validate path security
    const validPath = await validatePath(args.path, workspace);
    enforcePathPolicy(options?.policy ?? null, workspace, validPath, args.path);

    // Check if path exists and is a directory
    const stat = await platform.fs.stat(validPath);
    if (!stat.isDirectory) {
      return {
        success: false,
        message: `Path is not a directory: ${args.path}`,
      };
    }

    const entries: FileEntry[] = [];

    // Compile glob pattern once (path-aware by default)
    let patternRegex: RegExp | null = null;
    let basenameRegex: RegExp | null = null;
    if (args.pattern) {
      try {
        patternRegex = globToRegex(args.pattern, { matchPath: true });

        // Back-compat: if pattern has no path separators, also match basenames
        if (args.recursive && !args.pattern.includes("/") && !args.pattern.includes("\\")) {
          basenameRegex = globToRegex(args.pattern, { matchPath: false });
        }
      } catch (error) {
        if (error instanceof GlobPatternError) {
          return {
            success: false,
            message: error.message,
          };
        }
        throw error;
      }
    }

    const matchesPattern = (relativePath: string, name: string): boolean => {
      if (!patternRegex) return true;
      if (patternRegex.test(relativePath)) return true;
      return basenameRegex ? basenameRegex.test(name) : false;
    };

    const maxEntries = Math.min(
      args.maxEntries ?? RESOURCE_LIMITS.maxListEntries,
      RESOURCE_LIMITS.maxListEntries,
    );

    // Helper to walk directory
    const walk = async (dir: string, relativePath: string, depth: number) => {
      if (args.maxDepth !== undefined && depth > args.maxDepth) {
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
        const matchesCurrentPattern = matchesPattern(entryRelativePath, entry.name);

        // Enforce policy for this path before including
        if (!isPathAllowedAbsolute(options?.policy ?? null, workspace, entryPath)) {
          // Skip disallowed paths entirely
          continue;
        }

        // Add to results only if matches pattern
        if (matchesCurrentPattern) {
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
        if (args.recursive && entry.isDirectory) {
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

    return {
      success: true,
      entries,
      count: entries.length,
      message: truncated
        ? `Found ${entries.length} entries (limit reached)`
        : `Found ${entries.length} entries in ${args.path}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to list files: ${getErrorMessage(error)}`,
    };
  }
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
    description: "Read file contents",
    args: {
      path: "string - Relative path to file",
      encoding: "string (optional) - 'utf8' or 'binary' (default: utf8)",
      maxBytes: "number (optional) - Max bytes to read (capped by limits)",
    },
  },
  write_file: {
    fn: writeFile,
    description: "Write content to file",
    args: {
      path: "string - Relative path to file",
      content: "string - Content to write",
      createDirs: "boolean (optional) - Create parent directories (default: false)",
      maxBytes: "number (optional) - Max bytes to write (capped by limits)",
    },
  },
  edit_file: {
    fn: editFile,
    description: "Edit file using find/replace",
    args: {
      path: "string - Relative path to file",
      find: "string - Text to find",
      replace: "string - Replacement text",
      mode: "string (optional) - 'literal' or 'regex' (default: literal)",
      maxBytes: "number (optional) - Max bytes to read/write (capped by limits)",
    },
  },
  list_files: {
    fn: listFiles,
    description: "List files and directories",
    args: {
      path: "string - Relative path to directory",
      recursive: "boolean (optional) - Recurse into subdirectories (default: false)",
      pattern: "string (optional) - Glob pattern to filter files (e.g., '*.ts')",
      maxDepth: "number (optional) - Maximum recursion depth (default: unlimited)",
      maxEntries: "number (optional) - Max entries to return (capped by limits)",
    },
  },
} as const;
