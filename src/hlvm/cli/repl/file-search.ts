/**
 * File Search Module - Fuzzy file finder for @ mentions
 *
 * Provides Claude Code-style @ completion:
 * - @doc → fuzzy matches files/dirs containing "doc"
 * - Shows ranked results with file/directory indicators
 * - Respects .gitignore patterns
 */

import { fuzzyMatchPath, binarySearchInsertIdx } from "./fuzzy.ts";

// ============================================================
// Types
// ============================================================

export interface FileMatch {
  /** Relative path from project root */
  path: string;
  /** Whether it's a directory */
  isDirectory: boolean;
  /** Fuzzy match score (higher = better) */
  score: number;
  /** Indices of matched characters for highlighting */
  matchIndices: number[];
}

export interface FileIndex {
  files: string[];
  dirs: string[];
  timestamp: number;
}

// ============================================================
// Constants
// ============================================================

const CACHE_TTL = 60000; // 1 minute cache

// Directories to always skip
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".cache",
  "coverage", ".next", ".nuxt", "vendor", "__pycache__",
  ".hql", ".deno", "target", ".svn", ".hg", "bower_components",
  ".idea", ".vscode", ".vs", "out", "bin", "obj",
]);

// File patterns to skip - using string checks for performance (no regex compilation)
const SKIP_EXTENSIONS = new Set(['.min.js', '.map', '.lock', '.d.ts']);
const SKIP_EXACT_NAMES = new Set(['package-lock.json', 'yarn.lock']);

function shouldSkipFile(name: string): boolean {
  if (SKIP_EXACT_NAMES.has(name)) return true;
  for (const ext of SKIP_EXTENSIONS) {
    if (name.endsWith(ext)) return true;
  }
  return false;
}

// ============================================================
// Cache
// ============================================================

let indexCache: FileIndex | null = null;

// ============================================================
// Gitignore Support
// ============================================================

interface GitignorePattern {
  pattern: RegExp;
  negated: boolean;
}

function parseGitignore(content: string): GitignorePattern[] {
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

function isIgnored(path: string, patterns: GitignorePattern[]): boolean {
  let ignored = false;

  for (const { pattern, negated } of patterns) {
    if (pattern.test(path)) {
      ignored = !negated;
    }
  }

  return ignored;
}

// ============================================================
// File Indexing
// ============================================================

async function loadGitignore(baseDir: string): Promise<GitignorePattern[]> {
  try {
    const content = await Deno.readTextFile(`${baseDir}/.gitignore`);
    return parseGitignore(content);
  } catch {
    return [];
  }
}

async function indexDirectory(baseDir: string): Promise<FileIndex> {
  const files: string[] = [];
  const dirs: string[] = [];
  const gitignorePatterns = await loadGitignore(baseDir);

  async function walk(dir: string, prefix: string, depth: number): Promise<void> {
    // Limit depth to avoid infinite recursion
    if (depth > 10) return;

    try {
      for await (const entry of Deno.readDir(dir)) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

        // Skip hidden files/dirs (except specific ones)
        if (entry.name.startsWith(".") && entry.name !== ".github") {
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

  if (!forceRefresh && indexCache && (now - indexCache.timestamp) < CACHE_TTL) {
    return indexCache;
  }

  const baseDir = Deno.cwd();
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
    .replace(ESCAPE_SPACE_REGEX, " ")           // backslash-space -> space
    .replace(ESCAPE_SINGLE_QUOTE_REGEX, "'")    // backslash-quote -> quote
    .replace(ESCAPE_DOUBLE_QUOTE_REGEX, '"')    // backslash-doublequote -> doublequote
    .replace(ESCAPE_BACKSLASH_REGEX, "\\");     // double-backslash -> single backslash
}

/**
 * Check if a path exists and return its info
 */
async function checkAbsolutePath(path: string): Promise<FileMatch | null> {
  // Unescape shell-escaped paths before checking filesystem
  const cleanPath = unescapeShellPath(path);

  try {
    const stat = await Deno.stat(cleanPath);
    return {
      path: cleanPath,  // Return the clean path, not the escaped one
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
export async function searchFiles(query: string, maxResults = 12): Promise<FileMatch[]> {
  // Handle absolute paths (e.g., /Users/..., /var/..., ~/...)
  if (query.startsWith("/") || query.startsWith("~")) {
    // First unescape any shell-escaped characters
    const unescapedQuery = unescapeShellPath(query);
    const expandedPath = unescapedQuery.startsWith("~")
      ? unescapedQuery.replace(/^~/, Deno.env.get("HOME") || "")
      : unescapedQuery;

    const match = await checkAbsolutePath(expandedPath);
    if (match) {
      return [match];
    }

    // If exact path not found, try to complete partial path
    const parentDir = expandedPath.substring(0, expandedPath.lastIndexOf("/")) || "/";
    const partial = expandedPath.substring(expandedPath.lastIndexOf("/") + 1);

    try {
      const results: FileMatch[] = [];
      const partialLower = partial.toLowerCase(); // Pre-compute once outside loop
      for await (const entry of Deno.readDir(parentDir)) {
        const nameLower = entry.name.toLowerCase();
        if (partial && !nameLower.includes(partialLower)) {
          continue;
        }
        const fullPath = parentDir === "/" ? `/${entry.name}` : `${parentDir}/${entry.name}`;
        results.push({
          path: fullPath,
          isDirectory: entry.isDirectory,
          score: nameLower.startsWith(partialLower) ? 100 : 50,
          matchIndices: [],
        });
      }
      results.sort((a, b) => b.score - a.score);
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
      results.push({ path: dir, isDirectory: true, score: 100, matchIndices: [] });
    }
    for (const file of index.files.slice(0, 6)) {
      results.push({ path: file, isDirectory: false, score: 50, matchIndices: [] });
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
      results.splice(insertIdx, 0, { path, isDirectory: isDir, score, matchIndices: [...match.indices] });
    } else if (score > results[results.length - 1].score) {
      const insertIdx = binarySearchInsertIdx(results, score, getScore);
      results.splice(insertIdx, 0, { path, isDirectory: isDir, score, matchIndices: [...match.indices] });
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

