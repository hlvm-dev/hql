/**
 * File Utilities - Shared file system utilities
 *
 * Provides reusable file traversal, gitignore parsing, and filtering logic.
 * Used by REPL file search and AI agent file operations.
 */

import { getPlatform } from "../platform/platform.ts";

// ============================================================
// Types
// ============================================================

export interface GitignorePattern {
  pattern: RegExp;
  negated: boolean;
}

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
  gitignorePatterns?: GitignorePattern[];
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
// Gitignore Support
// ============================================================

/**
 * Parse .gitignore content into pattern list
 */
export function parseGitignore(content: string): GitignorePattern[] {
  const patterns: GitignorePattern[] = [];

  for (let line of content.split("\n")) {
    line = line.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) continue;

    // Handle negation
    const negated = line.startsWith("!");
    if (negated) line = line.slice(1);

    // Convert gitignore pattern to regex
    let regex = line
      .replace(/\./g, "\\.")           // Escape dots
      .replace(/\*\*/g, "<<<GLOBSTAR>>>")  // Temp placeholder
      .replace(/\*/g, "[^/]*")         // Single * = anything except /
      .replace(/<<<GLOBSTAR>>>/g, ".*") // ** = anything including /
      .replace(/\?/g, "[^/]");         // ? = single char except /

    // Handle directory-only patterns
    if (line.endsWith("/")) {
      regex = regex.slice(0, -2); // Remove trailing \/
    }

    // Handle patterns starting with /
    if (regex.startsWith("\\/")) {
      regex = "^" + regex.slice(2);
    } else {
      regex = "(^|/)" + regex;
    }

    regex += "($|/)";

    try {
      patterns.push({ pattern: new RegExp(regex), negated });
    } catch {
      // Invalid regex, skip
    }
  }

  return patterns;
}

/**
 * Check if a path is ignored by gitignore patterns
 */
export function isIgnored(path: string, patterns: GitignorePattern[]): boolean {
  let ignored = false;

  for (const { pattern, negated } of patterns) {
    if (pattern.test(path)) {
      ignored = !negated;
    }
  }

  return ignored;
}

/**
 * Load and parse .gitignore from a directory
 */
export async function loadGitignore(baseDir: string): Promise<GitignorePattern[]> {
  try {
    const platform = getPlatform();
    const gitignorePath = platform.path.join(baseDir, ".gitignore");
    const content = await platform.fs.readTextFile(gitignorePath);
    return parseGitignore(content);
  } catch {
    return [];
  }
}

// ============================================================
// Directory Walking
// ============================================================

/**
 * Recursively walk a directory tree
 * Yields all files and directories that pass filters
 *
 * @example
 * ```ts
 * const gitignore = await loadGitignore("/project");
 * for await (const entry of walkDirectory({
 *   baseDir: "/project",
 *   gitignorePatterns: gitignore,
 *   maxDepth: 5,
 * })) {
 *   console.log(entry.path, entry.isDirectory);
 * }
 * ```
 */
export async function* walkDirectory(
  options: WalkOptions
): AsyncGenerator<WalkEntry> {
  const {
    baseDir,
    maxDepth = 10,
    gitignorePatterns = [],
    filter,
  } = options;

  const platform = getPlatform();

  async function* walkRecursive(
    dir: string,
    prefix: string,
    depth: number
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

        // Check gitignore
        if (isIgnored(relativePath, gitignorePatterns)) {
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
