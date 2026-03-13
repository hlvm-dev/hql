/**
 * File Search Module - Fuzzy file finder for @ mentions
 *
 * Provides Claude Code-style @ completion:
 * - @doc → fuzzy matches files/dirs containing "doc"
 * - Shows ranked results with file/directory indicators
 * - Respects .gitignore patterns
 */

import { binarySearchInsertIdx, fuzzyMatchPath } from "./fuzzy.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { CLI_CACHE_TTL_MS } from "../repl-ink/ui-constants.ts";
import {
  isIgnored,
  loadGitignore,
  shouldSkipFile,
  SKIP_DIRS,
} from "../../../common/file-utils.ts";

// ============================================================
// Types
// ============================================================

export interface FileMatch {
  /** Relative path from the active workspace root */
  path: string;
  /** Whether it's a directory */
  isDirectory: boolean;
  /** Fuzzy match score (higher = better) */
  score: number;
  /** Indices of matched characters for highlighting */
  matchIndices: number[];
}

interface FileIndex {
  files: string[];
  dirs: string[];
  timestamp: number;
}

// ============================================================
// Constants
// ============================================================

// Cache TTL imported from shared UI constants (SSOT)

// SKIP_DIRS + shouldSkipFile imported from ../../../common/file-utils.ts (SSOT)

// ============================================================
// Cache
// ============================================================

let indexCache: FileIndex | null = null;

// ============================================================
// File Indexing
// ============================================================

async function indexDirectory(baseDir: string): Promise<FileIndex> {
  const platform = getPlatform();
  const files: string[] = [];
  const dirs: string[] = [];
  const gitignorePatterns = await loadGitignore(baseDir);

  async function walk(
    dir: string,
    prefix: string,
    depth: number,
  ): Promise<void> {
    // Limit depth to avoid infinite recursion
    if (depth > 10) return;

    try {
      for await (const entry of platform.fs.readDir(dir)) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

        // Skip hidden files/dirs by default in mention completion.
        if (entry.name.startsWith(".")) {
          continue;
        }

        // Check gitignore
        if (isIgnored(relativePath, gitignorePatterns)) {
          continue;
        }

        if (entry.isDirectory) {
          // Skip known bad directories
          if (SKIP_DIRS.has(entry.name)) continue;

          dirs.push(relativePath + "/");
          await walk(`${dir}/${entry.name}`, relativePath, depth + 1);
        } else {
          // Skip known bad file patterns
          if (shouldSkipFile(entry.name)) continue;

          files.push(relativePath);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await walk(baseDir, "", 0);

  // Sort for consistent ordering
  files.sort();
  dirs.sort();

  return { files, dirs, timestamp: Date.now() };
}

/**
 * Get the file index, using cache if valid
 */
export async function getFileIndex(forceRefresh = false): Promise<FileIndex> {
  const now = Date.now();

  if (
    !forceRefresh && indexCache &&
    (now - indexCache.timestamp) < CLI_CACHE_TTL_MS
  ) {
    return indexCache;
  }

  const baseDir = getPlatform().process.cwd();
  indexCache = await indexDirectory(baseDir);

  return indexCache;
}

// ============================================================
// Search API
// ============================================================

// Pre-compiled regex patterns for unescapeShellPath (avoid compilation per call)
const ESCAPE_SPACE_REGEX = /\\ /g;
const ESCAPE_SINGLE_QUOTE_REGEX = /\\'/g;
const ESCAPE_DOUBLE_QUOTE_REGEX = /\\"/g;
const ESCAPE_BACKSLASH_REGEX = /\\\\/g;

/**
 * Unescape shell-escaped path (e.g., "file\ name.png" -> "file name.png")
 */
export function unescapeShellPath(path: string): string {
  return path
    .replace(ESCAPE_SPACE_REGEX, " ") // backslash-space -> space
    .replace(ESCAPE_SINGLE_QUOTE_REGEX, "'") // backslash-quote -> quote
    .replace(ESCAPE_DOUBLE_QUOTE_REGEX, '"') // backslash-doublequote -> doublequote
    .replace(ESCAPE_BACKSLASH_REGEX, "\\"); // double-backslash -> single backslash
}

/**
 * Check if a path exists and return its info
 */
async function checkAbsolutePath(path: string): Promise<FileMatch | null> {
  // Unescape shell-escaped paths before checking filesystem
  const cleanPath = unescapeShellPath(path);

  try {
    const stat = await getPlatform().fs.stat(cleanPath);
    return {
      path: cleanPath, // Return the clean path, not the escaped one
      isDirectory: stat.isDirectory,
      score: 1000, // High score for exact path match
      matchIndices: [],
    };
  } catch {
    return null;
  }
}

/**
 * Search for files and directories matching the query
 */
export async function searchFiles(
  query: string,
  maxResults = 12,
): Promise<FileMatch[]> {
  // Handle absolute paths (e.g., /Users/..., /var/..., ~/...)
  if (query.startsWith("/") || query.startsWith("~")) {
    // First unescape any shell-escaped characters
    const unescapedQuery = unescapeShellPath(query);
    const expandedPath = unescapedQuery.startsWith("~")
      ? unescapedQuery.replace(/^~/, getPlatform().env.get("HOME") || "")
      : unescapedQuery;

    const match = await checkAbsolutePath(expandedPath);
    if (match) {
      return [match];
    }

    // If exact path not found, try to complete partial path
    const parentDir =
      expandedPath.substring(0, expandedPath.lastIndexOf("/")) || "/";
    const partial = expandedPath.substring(expandedPath.lastIndexOf("/") + 1);

    try {
      const results: FileMatch[] = [];
      const partialLower = partial.toLowerCase(); // Pre-compute once outside loop
      const includeHidden = partial.startsWith(".");
      for await (const entry of getPlatform().fs.readDir(parentDir)) {
        // Keep hidden files out by default, unless user explicitly starts with "."
        if (!includeHidden && entry.name.startsWith(".")) {
          continue;
        }
        if (entry.isDirectory && SKIP_DIRS.has(entry.name)) {
          continue;
        }
        if (!entry.isDirectory && shouldSkipFile(entry.name)) {
          continue;
        }
        const nameLower = entry.name.toLowerCase();
        if (partial && !nameLower.includes(partialLower)) {
          continue;
        }
        const fullPath = parentDir === "/"
          ? `/${entry.name}`
          : `${parentDir}/${entry.name}`;
        results.push({
          path: fullPath,
          isDirectory: entry.isDirectory,
          score: nameLower.startsWith(partialLower) ? 100 : 50,
          matchIndices: [],
        });
      }
      results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.path.localeCompare(b.path);
      });
      return results.slice(0, maxResults);
    } catch {
      return [];
    }
  }

  const index = await getFileIndex();
  const results: FileMatch[] = [];

  // If empty query, return recent/common files
  if (!query.trim()) {
    // Return some directories and files
    for (const dir of index.dirs.slice(0, 6)) {
      results.push({
        path: dir,
        isDirectory: true,
        score: 100,
        matchIndices: [],
      });
    }
    for (const file of index.files.slice(0, 6)) {
      results.push({
        path: file,
        isDirectory: false,
        score: 50,
        matchIndices: [],
      });
    }
    return results.slice(0, maxResults);
  }

  // OPTIMIZED: Direct iteration without intermediate array allocation
  // Time complexity: O(n log k) where n=files+dirs, k=maxResults
  // Process directories first, then files (no intermediate object allocation)

  // Score getter for binary search
  const getScore = (item: FileMatch) => item.score;

  // Helper to insert match into top-k results
  const insertMatch = (path: string, isDir: boolean) => {
    const match = fuzzyMatchPath(query, path);
    if (!match) return;

    const score = match.score + (isDir ? 10 : 0);

    // Insert into results maintaining sorted order (top-k)
    if (results.length < maxResults) {
      const insertIdx = binarySearchInsertIdx(results, score, getScore);
      results.splice(insertIdx, 0, {
        path,
        isDirectory: isDir,
        score,
        matchIndices: match.indices as number[],
      });
    } else if (score > results[results.length - 1].score) {
      const insertIdx = binarySearchInsertIdx(results, score, getScore);
      results.splice(insertIdx, 0, {
        path,
        isDirectory: isDir,
        score,
        matchIndices: match.indices as number[],
      });
      results.pop();
    }
  };

  // Process directories
  for (const path of index.dirs) {
    insertMatch(path, true);
  }

  // Process files
  for (const path of index.files) {
    insertMatch(path, false);
  }

  return results;
}
