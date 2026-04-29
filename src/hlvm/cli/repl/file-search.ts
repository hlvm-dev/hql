/**
 * File Search Module - Fuzzy file finder for @ mentions
 *
 * Provides Claude Code-style @ completion:
 * - @doc → fuzzy matches files/dirs containing "doc"
 * - Shows ranked results with file/directory indicators
 * - Respects .gitignore patterns
 */

import { compareScoredFuzzyMatches, fuzzyMatchPath } from "./fuzzy.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { CLI_CACHE_TTL_MS } from "../repl-ink/ui-constants.ts";
import {
  isIgnored,
  loadGitignore,
  shouldSkipFile,
  SKIP_DIRS,
} from "../../../common/file-utils.ts";
import {
  expandCommonHomePath,
  getCommonHomeFolderEntries,
  resolveCommonHomeFolderQuery,
} from "../../../common/home-folders.ts";

// ============================================================
// Types
// ============================================================

export interface FileMatch {
  /** Workspace-relative path, or a global/home path such as ~/Desktop/ */
  path: string;
  /** Whether it's a directory */
  isDirectory: boolean;
  /** Fuzzy match score (higher = better) */
  score: number;
  /** Indices of matched characters for highlighting */
  matchIndices: number[];
}

function compareFileMatches(a: FileMatch, b: FileMatch): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return compareScoredFuzzyMatches(
    a.path,
    a.score,
    a.matchIndices,
    b.path,
    b.score,
    b.matchIndices,
  );
}

function binarySearchInsertFileMatch(
  results: readonly FileMatch[],
  candidate: FileMatch,
): number {
  let lo = 0;
  let hi = results.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (compareFileMatches(results[mid], candidate) <= 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
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
let indexPromise: Promise<FileIndex> | null = null;

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

  if (indexPromise) {
    return indexPromise;
  }

  const baseDir = getPlatform().process.cwd();
  const nextIndexPromise = indexDirectory(baseDir);
  indexPromise = nextIndexPromise;
  try {
    indexCache = await nextIndexPromise;
    return indexCache;
  } finally {
    if (indexPromise === nextIndexPromise) {
      indexPromise = null;
    }
  }
}

export function prewarmFileIndex(): Promise<FileIndex> {
  return getFileIndex();
}

export function __resetFileIndexCacheForTest(): void {
  indexCache = null;
  indexPromise = null;
}

// ============================================================
// Search API
// ============================================================

// Pre-compiled regex patterns for unescapeShellPath (avoid compilation per call)
const ESCAPE_SPACE_REGEX = /\\ /g;
const ESCAPE_SINGLE_QUOTE_REGEX = /\\'/g;
const ESCAPE_DOUBLE_QUOTE_REGEX = /\\"/g;
const ESCAPE_BACKSLASH_REGEX = /\\\\/g;
const COMMON_HOME_FOLDER_SCORE_BONUS = 180;
const CWD_TOP_LEVEL_SCORE_BASE = 300;

/**
 * List the cwd's top-level entries for the empty-query `@` picker.
 * Includes hidden dot-entries (`.git/`, `.claude/`, `.DS_Store`, …),
 * alpha-sorted, directories first, with dot-entries de-prioritised
 * within each group so plain files/dirs render above them.
 */
async function listCwdTopLevelEntries(maxResults: number): Promise<FileMatch[]> {
  const platform = getPlatform();
  let cwd: string;
  try {
    cwd = platform.process.cwd();
  } catch {
    return [];
  }

  // CC's @ picker interleaves directories and files in a single
  // alphabetical list (e.g. `.DS_Store`, `.claude/`, `.codex-routing-
  // profile.ts`, `.firebase/`, `.firebaserc`, `.git/`, …). Mirror that:
  // one sort key, no type grouping, no hidden-last bias.
  const entries: { name: string; isDirectory: boolean }[] = [];
  try {
    for await (const entry of platform.fs.readDir(cwd)) {
      if (entry.isDirectory) {
        if (SKIP_DIRS.has(entry.name)) continue;
        entries.push({ name: entry.name, isDirectory: true });
      } else {
        if (shouldSkipFile(entry.name)) continue;
        entries.push({ name: entry.name, isDirectory: false });
      }
    }
  } catch {
    return [];
  }

  // Byte-order sort to match CC's @ picker (uppercase before lowercase, so
  // `.DS_Store` sorts before `.claude/`).
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const out: FileMatch[] = [];
  for (let rank = 0; rank < entries.length && out.length < maxResults; rank += 1) {
    const entry = entries[rank]!;
    out.push({
      path: entry.isDirectory ? `${entry.name}/` : entry.name,
      isDirectory: entry.isDirectory,
      score: CWD_TOP_LEVEL_SCORE_BASE - rank,
      matchIndices: [],
    });
  }
  return out;
}

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
 * Normalize a mention path into a canonical absolute path so picker filtering
 * can compare search results against stored attachment source paths reliably.
 */
export function normalizeComparableFilePath(path: string): string {
  const platform = getPlatform();
  const cleanPath = unescapeShellPath(path);
  const expandedPath = expandCommonHomePath(
    cleanPath,
    platform.env.get("HOME") ?? "",
  );
  return platform.path.resolve(expandedPath);
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

function insertTopMatch(
  results: FileMatch[],
  candidate: FileMatch,
  maxResults: number,
): void {
  if (results.length < maxResults) {
    const insertIdx = binarySearchInsertFileMatch(results, candidate);
    results.splice(insertIdx, 0, candidate);
    return;
  }

  if (compareFileMatches(candidate, results[results.length - 1]) < 0) {
    const insertIdx = binarySearchInsertFileMatch(results, candidate);
    results.splice(insertIdx, 0, candidate);
    results.pop();
  }
}

async function searchAbsoluteOrHomePath(
  query: string,
  maxResults: number,
): Promise<FileMatch[]> {
  const platform = getPlatform();
  const unescapedQuery = unescapeShellPath(query);
  const expandedPath = expandCommonHomePath(
    unescapedQuery,
    platform.env.get("HOME") ?? "",
  );
  const browseDirectory = unescapedQuery.endsWith("/");

  const joinDisplayPath = (basePath: string, entryName: string): string => {
    if (basePath === "/") {
      return `/${entryName}`;
    }
    if (basePath === "~") {
      return `~/${entryName}`;
    }
    return basePath.endsWith("/")
      ? `${basePath}${entryName}`
      : `${basePath}/${entryName}`;
  };

  const listDirectoryEntries = async (
    directoryPath: string,
    displayDirectoryPath: string,
    partial: string,
  ): Promise<FileMatch[]> => {
    const results: FileMatch[] = [];
    const partialLower = partial.toLowerCase();
    const includeHidden = partial.startsWith(".");

    try {
      for await (const entry of platform.fs.readDir(directoryPath)) {
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

        results.push({
          path: joinDisplayPath(displayDirectoryPath, entry.name),
          isDirectory: entry.isDirectory,
          score: nameLower.startsWith(partialLower) ? 100 : 50,
          matchIndices: [],
        });
      }
    } catch {
      return [];
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    return results.slice(0, maxResults);
  };

  const match = await checkAbsolutePath(expandedPath);
  if (match) {
    const exactMatch = {
      ...match,
      path: unescapedQuery,
    };

    if (match.isDirectory && browseDirectory) {
      const displayDirectoryPath = unescapedQuery.endsWith("/")
        ? unescapedQuery.slice(0, -1)
        : unescapedQuery;
      const children = await listDirectoryEntries(
        expandedPath,
        displayDirectoryPath || "/",
        "",
      );
      return children.length > 0 ? children : [exactMatch];
    }

    return [exactMatch];
  }

  const parentDir = expandedPath.substring(0, expandedPath.lastIndexOf("/")) ||
    "/";
  const partial = expandedPath.substring(expandedPath.lastIndexOf("/") + 1);
  const displayParentDir =
    unescapedQuery.substring(0, unescapedQuery.lastIndexOf("/")) || "/";
  return listDirectoryEntries(parentDir, displayParentDir, partial);
}

async function searchCommonHomeFolders(
  query: string,
  maxResults: number,
): Promise<FileMatch[]> {
  const platform = getPlatform();
  const homeEntries = getCommonHomeFolderEntries(
    platform.env.get("HOME") ?? "",
  );
  const results: FileMatch[] = [];
  const queryLower = query.toLowerCase();

  for (const entry of homeEntries) {
    try {
      const stat = await platform.fs.stat(entry.absolutePath);
      if (!stat.isDirectory) {
        continue;
      }
    } catch {
      continue;
    }

    if (!query.trim()) {
      insertTopMatch(results, {
        path: entry.displayPath,
        isDirectory: true,
        score: COMMON_HOME_FOLDER_SCORE_BONUS,
        matchIndices: [],
      }, maxResults);
      continue;
    }

    const match = fuzzyMatchPath(query, entry.displayPath);
    if (!match) {
      continue;
    }

    const aliasBoost = entry.queryAliases.some((alias) =>
        alias.startsWith(queryLower)
      )
      ? 40
      : 0;

    insertTopMatch(results, {
      path: entry.displayPath,
      isDirectory: true,
      score: match.score + COMMON_HOME_FOLDER_SCORE_BONUS + aliasBoost,
      matchIndices: [...match.indices],
    }, maxResults);
  }

  return results;
}

/**
 * Search for files and directories matching the query
 */
export async function searchFiles(
  query: string,
  maxResults = 12,
): Promise<FileMatch[]> {
  const platform = getPlatform();
  const aliasedHomeQuery = resolveCommonHomeFolderQuery(
    query,
    platform.env.get("HOME") ?? "",
  );
  if (aliasedHomeQuery) {
    return searchFiles(aliasedHomeQuery, maxResults);
  }

  // Handle absolute paths (e.g., /Users/..., /var/..., ~/...)
  if (query.startsWith("/") || query.startsWith("~")) {
    return searchAbsoluteOrHomePath(query, maxResults);
  }

  const index = await getFileIndex();
  const results: FileMatch[] = [];
  const commonHomeMatches = await searchCommonHomeFolders(query, maxResults);

  // If empty query, show CWD top-level entries first (including hidden
  // dot-entries) — opens onto the current working directory rather than
  // onto home-folder shortcuts.
  if (!query.trim()) {
    const cwdTopLevel = await listCwdTopLevelEntries(maxResults);
    for (const entry of cwdTopLevel) {
      insertTopMatch(results, entry, maxResults);
    }

    // Keep common home-folder shortcuts as lower-priority fallback. Their
    // score (180) is lower than cwdTopLevel entries (300+) so they appear
    // below the CWD listing instead of above it.
    for (const homeMatch of commonHomeMatches) {
      insertTopMatch(results, homeMatch, maxResults);
    }

    // Workspace index entries filled-in after home folders so the picker
    // still has something useful if the CWD is empty.
    for (const dir of index.dirs.slice(0, 6)) {
      insertTopMatch(results, {
        path: dir,
        isDirectory: true,
        score: 100,
        matchIndices: [],
      }, maxResults);
    }
    for (const file of index.files.slice(0, 6)) {
      insertTopMatch(results, {
        path: file,
        isDirectory: false,
        score: 50,
        matchIndices: [],
      }, maxResults);
    }
    return results;
  }

  // OPTIMIZED: Direct iteration without intermediate array allocation
  // Time complexity: O(n log k) where n=files+dirs, k=maxResults
  // Process directories first, then files (no intermediate object allocation)

  // Helper to insert match into top-k results
  const insertMatch = (path: string, isDir: boolean) => {
    const match = fuzzyMatchPath(query, path);
    if (!match) return;

    const candidate: FileMatch = {
      path,
      isDirectory: isDir,
      score: match.score + (isDir ? 10 : 0),
      matchIndices: [...match.indices],
    };

    insertTopMatch(results, candidate, maxResults);
  };

  // Process directories
  for (const path of index.dirs) {
    insertMatch(path, true);
  }

  // Process files
  for (const path of index.files) {
    insertMatch(path, false);
  }

  for (const homeMatch of commonHomeMatches) {
    insertTopMatch(results, homeMatch, maxResults);
  }

  return results;
}
