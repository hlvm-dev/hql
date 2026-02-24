/**
 * File Utilities - Shared file system utilities
 *
 * Provides reusable file traversal, gitignore parsing, and filtering logic.
 * Used by REPL file search and AI agent file operations.
 */

import { getPlatform } from "../platform/platform.ts";
import ignoreModule from "ignore";
import type { Ignore } from "ignore";

// `ignore` CJS module exports default as property in Deno's TS type system
const createIgnore: () => Ignore = ignoreModule.default;

export type { Ignore };

// ============================================================
// Types
// ============================================================

export interface WalkEntry {
  /** Relative path from base directory */
  path: string;
  /** Whether this entry is a directory */
  isDirectory: boolean;
  /** Full absolute path */
  fullPath: string;
}

export interface WalkOptions {
  /** Base directory to walk */
  baseDir: string;
  /** Maximum depth (default: 10) */
  maxDepth?: number;
  /** Gitignore patterns to respect */
  gitignorePatterns?: Ignore;
  /** Filter function for entries (return false to skip) */
  filter?: (entry: WalkEntry, depth: number) => boolean;
}

// ============================================================
// Constants
// ============================================================

// Directories to always skip
export const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".cache",
  "coverage", ".next", ".nuxt", "vendor", "__pycache__",
  ".hql", ".deno", "target", ".svn", ".hg", "bower_components",
  ".idea", ".vscode", ".vs", "out", "bin", "obj",
]);

// File patterns to skip - using string checks for performance (no regex compilation)
export const SKIP_EXTENSIONS = new Set([".min.js", ".map", ".lock", ".d.ts"]);
export const SKIP_EXACT_NAMES = new Set(["package-lock.json", "yarn.lock"]);

// ============================================================
// File Filtering
// ============================================================

/**
 * Check if a file should be skipped based on name patterns
 */
export function shouldSkipFile(name: string): boolean {
  if (SKIP_EXACT_NAMES.has(name)) return true;
  for (const ext of SKIP_EXTENSIONS) {
    if (name.endsWith(ext)) return true;
  }
  return false;
}

// ============================================================
// Gitignore Support (powered by `ignore` package)
// ============================================================

/**
 * Check if a path is ignored by gitignore patterns.
 * Thin wrapper preserving API stability for callers.
 */
export function isIgnored(path: string, ig: Ignore): boolean {
  return ig.ignores(path);
}

/**
 * Load and parse .gitignore from a directory.
 * Returns an Ignore instance (empty if no .gitignore found).
 */
export async function loadGitignore(baseDir: string): Promise<Ignore> {
  const ig = createIgnore();
  try {
    const platform = getPlatform();
    const gitignorePath = platform.path.join(baseDir, ".gitignore");
    const content = await platform.fs.readTextFile(gitignorePath);
    ig.add(content);
  } catch {
    // No .gitignore or unreadable — return empty ignore instance
  }
  return ig;
}

// ============================================================
// Directory Walking
// ============================================================

/**
 * Recursively walk a directory tree
 * Yields all files and directories that pass filters
 */
export async function* walkDirectory(
  options: WalkOptions,
): AsyncGenerator<WalkEntry> {
  const {
    baseDir,
    maxDepth = 10,
    gitignorePatterns = createIgnore(),
    filter,
  } = options;

  const platform = getPlatform();

  async function* walkRecursive(
    dir: string,
    prefix: string,
    depth: number,
  ): AsyncGenerator<WalkEntry> {
    // Limit depth to avoid infinite recursion
    if (depth > maxDepth) return;

    try {
      for await (const entry of platform.fs.readDir(dir)) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = platform.path.join(dir, entry.name);

        // Skip hidden files/dirs (except specific ones)
        if (entry.name.startsWith(".") && entry.name !== ".github") {
          continue;
        }

        // Skip symlinks to prevent escaping the workspace boundary
        if (entry.isSymlink) {
          continue;
        }

        // Check gitignore (append "/" for directories per gitignore spec)
        const gitignorePath = entry.isDirectory ? `${relativePath}/` : relativePath;
        if (isIgnored(gitignorePath, gitignorePatterns)) {
          continue;
        }

        const walkEntry: WalkEntry = {
          path: relativePath,
          isDirectory: entry.isDirectory,
          fullPath,
        };

        // Apply custom filter
        if (filter && !filter(walkEntry, depth)) {
          continue;
        }

        if (entry.isDirectory) {
          // Skip known bad directories
          if (SKIP_DIRS.has(entry.name)) continue;

          yield walkEntry;
          yield* walkRecursive(fullPath, relativePath, depth + 1);
        } else {
          // Skip known bad file patterns
          if (shouldSkipFile(entry.name)) continue;

          yield walkEntry;
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  yield* walkRecursive(baseDir, "", 0);
}
