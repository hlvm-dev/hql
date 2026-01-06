/**
 * File Search Module - Fuzzy file finder for @ mentions
 *
 * Provides Claude Code-style @ completion:
 * - @doc → fuzzy matches files/dirs containing "doc"
 * - Shows ranked results with file/directory indicators
 * - Respects .gitignore patterns
 */

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

// File patterns to skip
const SKIP_PATTERNS = [
  /\.min\.js$/,
  /\.map$/,
  /\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /\.d\.ts$/,
];

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
          if (SKIP_PATTERNS.some(p => p.test(entry.name))) continue;

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

/**
 * Clear the file cache
 */
export function clearFileCache(): void {
  indexCache = null;
}

// ============================================================
// Fuzzy Matching
// ============================================================

/**
 * FZF-style fuzzy matching with scoring
 * Returns score and match indices, or null if no match
 */
function fuzzyMatch(query: string, target: string): { score: number; indices: number[] } | null {
  if (!query) return { score: 0, indices: [] };

  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  // Quick check: all query chars must exist in target
  let checkIdx = 0;
  for (const ch of queryLower) {
    checkIdx = targetLower.indexOf(ch, checkIdx);
    if (checkIdx === -1) return null;
    checkIdx++;
  }

  // Find best match using dynamic programming approach
  const indices: number[] = [];
  let score = 0;
  let queryIdx = 0;
  let lastMatchIdx = -1;
  let consecutiveCount = 0;

  for (let i = 0; i < targetLower.length && queryIdx < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIdx]) {
      indices.push(i);

      // Base score
      score += 10;

      // Consecutive match bonus (big bonus for sequential matches)
      if (lastMatchIdx === i - 1) {
        consecutiveCount++;
        score += consecutiveCount * 15;
      } else {
        consecutiveCount = 0;
      }

      // Word boundary bonus (after / - _ . or start)
      if (i === 0 || "/\\-_.".includes(target[i - 1])) {
        score += 20;
      }

      // Camel case bonus
      if (i > 0 && target[i] === target[i].toUpperCase() && target[i - 1] === target[i - 1].toLowerCase()) {
        score += 15;
      }

      // Exact case match bonus
      if (query[queryIdx] === target[i]) {
        score += 5;
      }

      lastMatchIdx = i;
      queryIdx++;
    }
  }

  // All query characters must match
  if (queryIdx < queryLower.length) {
    return null;
  }

  // Penalties
  score -= target.length * 0.5;  // Prefer shorter paths
  score -= indices[0] * 2;       // Prefer matches near start

  // Bonus for matching filename (last component)
  const lastSlash = target.lastIndexOf("/");
  if (lastSlash !== -1 && indices.some(i => i > lastSlash)) {
    score += 25;
  }

  return { score, indices };
}

// ============================================================
// Search API
// ============================================================

/**
 * Search for files and directories matching the query
 */
export async function searchFiles(query: string, maxResults = 12): Promise<FileMatch[]> {
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

  // Search directories
  for (const dir of index.dirs) {
    const match = fuzzyMatch(query, dir);
    if (match) {
      results.push({
        path: dir,
        isDirectory: true,
        score: match.score + 10, // Slight bonus for directories
        matchIndices: match.indices,
      });
    }
  }

  // Search files
  for (const file of index.files) {
    const match = fuzzyMatch(query, file);
    if (match) {
      results.push({
        path: file,
        isDirectory: false,
        score: match.score,
        matchIndices: match.indices,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, maxResults);
}

/**
 * Get stats about the index
 */
export async function getIndexStats(): Promise<{ files: number; dirs: number; cached: boolean }> {
  const index = await getFileIndex();
  return {
    files: index.files.length,
    dirs: index.dirs.length,
    cached: indexCache !== null && (Date.now() - indexCache.timestamp) < CACHE_TTL,
  };
}
