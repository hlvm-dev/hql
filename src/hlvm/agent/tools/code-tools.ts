/**
 * Code Tools - SSOT-compliant code search and analysis for AI agents
 *
 * Provides 3 core code operations:
 * 1. search_code - Pattern-based grep search
 * 2. find_symbol - Find function/class/const declarations
 * 3. get_structure - Get directory tree structure
 *
 * All operations:
 * - Use path sandboxing (validatePath)
 * - Use platform abstraction (getPlatform)
 * - Use shared file-utils.ts (DRY)
 * - Handle errors gracefully
 */

import { getPlatform } from "../../../platform/platform.ts";
import { validatePath } from "../security/path-sandbox.ts";
import { walkDirectory, loadGitignore } from "../../../common/file-utils.ts";

// ============================================================
// Types
// ============================================================

/** Result of a code search match */
export interface SearchMatch {
  file: string;
  line: number;
  content: string;
  match: string;
}

/** Arguments for search_code tool */
export interface SearchCodeArgs {
  pattern: string;
  path?: string;
  filePattern?: string;
  maxResults?: number;
}

/** Result of search_code operation */
export interface SearchCodeResult {
  success: boolean;
  matches?: SearchMatch[];
  count?: number;
  message?: string;
}

/** Result of a symbol find */
export interface SymbolMatch {
  file: string;
  line: number;
  type: "function" | "class" | "const";
  name: string;
  content: string;
}

/** Arguments for find_symbol tool */
export interface FindSymbolArgs {
  name: string;
  type?: "function" | "class" | "const";
  path?: string;
}

/** Result of find_symbol operation */
export interface FindSymbolResult {
  success: boolean;
  symbols?: SymbolMatch[];
  count?: number;
  message?: string;
}

/** Directory tree node */
export interface TreeNode {
  name: string;
  type: "file" | "directory";
  size?: number;
  children?: TreeNode[];
}

/** Arguments for get_structure tool */
export interface GetStructureArgs {
  path?: string;
  maxDepth?: number;
}

/** Result of get_structure operation */
export interface GetStructureResult {
  success: boolean;
  tree?: TreeNode;
  message?: string;
}

// ============================================================
// Tool 1: search_code
// ============================================================

/**
 * Search for pattern in code files (grep-like functionality)
 *
 * Security: Uses path sandboxing and respects gitignore
 * Performance: Uses walkDirectory from file-utils.ts (DRY)
 *
 * @example
 * ```ts
 * const result = await searchCode({
 *   pattern: "function.*validate",
 *   path: "src",
 *   filePattern: "*.ts",
 *   maxResults: 50
 * }, "/workspace");
 * ```
 */
export async function searchCode(
  args: SearchCodeArgs,
  workspace: string
): Promise<SearchCodeResult> {
  try {
    const platform = getPlatform();

    // Validate and resolve search path
    const searchPath = args.path
      ? await validatePath(args.path, workspace)
      : workspace;

    // Load gitignore patterns
    const gitignorePatterns = await loadGitignore(workspace);

    // Walk directory to get files
    const matches: SearchMatch[] = [];
    const pattern = new RegExp(args.pattern, "gi");
    const maxResults = args.maxResults || 100;

    // Helper to check if filename matches file pattern
    const matchesFilePattern = (filename: string): boolean => {
      if (!args.filePattern) return true;

      // Simple glob pattern matching (* wildcard)
      const regexPattern = args.filePattern
        .replace(/\./g, "\\.")
        .replace(/\*/g, ".*");
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(filename);
    };

    // Walk directory and search in files
    for await (
      const entry of walkDirectory({
        baseDir: searchPath,
        maxDepth: 10,
        gitignorePatterns,
      })
    ) {
      // Skip directories
      if (entry.isDirectory) continue;

      // Check file pattern filter
      const filename = platform.path.basename(entry.path);
      if (!matchesFilePattern(filename)) continue;

      // Skip binary-like files
      if (filename.endsWith(".png") || filename.endsWith(".jpg") ||
        filename.endsWith(".gif") || filename.endsWith(".ico") ||
        filename.endsWith(".woff") || filename.endsWith(".ttf")) {
        continue;
      }

      try {
        // Read file content
        const content = await platform.fs.readTextFile(entry.fullPath);
        const lines = content.split("\n");

        // Search each line
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const matchResult = pattern.exec(line);

          if (matchResult) {
            matches.push({
              file: entry.path,
              line: i + 1, // 1-indexed
              content: line.trim(),
              match: matchResult[0],
            });

            // Stop if we hit max results
            if (matches.length >= maxResults) {
              return {
                success: true,
                matches,
                count: matches.length,
                message: `Found ${matches.length} matches (limit reached)`,
              };
            }
          }

          // Reset regex lastIndex for global flag
          pattern.lastIndex = 0;
        }
      } catch (error) {
        // Skip files we can't read
        continue;
      }
    }

    return {
      success: true,
      matches,
      count: matches.length,
      message: `Found ${matches.length} matches`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to search code: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

// ============================================================
// Tool 2: find_symbol
// ============================================================

/**
 * Find symbol declarations (function/class/const)
 *
 * Uses pattern-based matching (not full AST parsing)
 * Supports TypeScript and JavaScript syntax
 *
 * @example
 * ```ts
 * const result = await findSymbol({
 *   name: "validatePath",
 *   type: "function",
 *   path: "src"
 * }, "/workspace");
 * ```
 */
export async function findSymbol(
  args: FindSymbolArgs,
  workspace: string
): Promise<FindSymbolResult> {
  try {
    const platform = getPlatform();

    // Validate and resolve search path
    const searchPath = args.path
      ? await validatePath(args.path, workspace)
      : workspace;

    // Check if search path is a file or directory
    const stat = await platform.fs.stat(searchPath);
    const isFile = !stat.isDirectory;

    // Load gitignore patterns
    const gitignorePatterns = await loadGitignore(workspace);

    // Build regex patterns for different symbol types
    const patterns: Record<string, RegExp> = {
      function: new RegExp(
        `(?:export\\s+)?(?:async\\s+)?(?:function\\s+${args.name}|const\\s+${args.name}\\s*=.*(?:async\\s+)?(?:\\(|function))`,
        "i"
      ),
      class: new RegExp(
        `(?:export\\s+)?(?:abstract\\s+)?class\\s+${args.name}\\s*[{<]`,
        "i"
      ),
      const: new RegExp(
        `(?:export\\s+)?const\\s+${args.name}\\s*[=:]`,
        "i"
      ),
    };

    // Determine which patterns to search for
    const searchPatterns = args.type
      ? { [args.type]: patterns[args.type] }
      : patterns;

    const symbols: SymbolMatch[] = [];

    // Helper function to search in a single file
    const searchFile = async (filePath: string, relativePath: string) => {
      const filename = platform.path.basename(filePath);

      // Only search in code files
      if (
        !filename.endsWith(".ts") && !filename.endsWith(".tsx") &&
        !filename.endsWith(".js") && !filename.endsWith(".jsx") &&
        !filename.endsWith(".hql")
      ) {
        return;
      }

      try {
        const content = await platform.fs.readTextFile(filePath);
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          for (const [type, pattern] of Object.entries(searchPatterns)) {
            if (pattern.test(line)) {
              symbols.push({
                file: relativePath,
                line: i + 1,
                type: type as "function" | "class" | "const",
                name: args.name,
                content: line.trim(),
              });
              break;
            }
          }
        }
      } catch (error) {
        // Skip files we can't read
      }
    };

    // If search path is a file, search just that file
    if (isFile) {
      const relativePath = args.path || platform.path.basename(searchPath);
      await searchFile(searchPath, relativePath);
    } else {
      // Otherwise, walk directory and search all files
      for await (
        const entry of walkDirectory({
          baseDir: searchPath,
          maxDepth: 10,
          gitignorePatterns,
        })
      ) {
        if (entry.isDirectory) continue;
        await searchFile(entry.fullPath, entry.path);
      }
    }

    return {
      success: true,
      symbols,
      count: symbols.length,
      message: `Found ${symbols.length} symbol(s) matching '${args.name}'`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to find symbol: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

// ============================================================
// Tool 3: get_structure
// ============================================================

/**
 * Get directory tree structure
 *
 * Builds hierarchical tree of files and directories
 * Respects gitignore patterns
 *
 * @example
 * ```ts
 * const result = await getStructure({
 *   path: "src",
 *   maxDepth: 3
 * }, "/workspace");
 * ```
 */
export async function getStructure(
  args: GetStructureArgs,
  workspace: string
): Promise<GetStructureResult> {
  try {
    const platform = getPlatform();

    // Validate and resolve path
    const targetPath = args.path
      ? await validatePath(args.path, workspace)
      : workspace;

    const maxDepth = args.maxDepth || 5;

    // Check if path is a directory
    const stat = await platform.fs.stat(targetPath);
    if (!stat.isDirectory) {
      return {
        success: false,
        message: `Path is not a directory: ${args.path}`,
      };
    }

    // Build directory tree recursively
    async function buildTree(
      dir: string,
      depth: number
    ): Promise<TreeNode> {
      const entries: TreeNode[] = [];

      if (depth > maxDepth) {
        return {
          name: platform.path.basename(dir),
          type: "directory",
          children: entries,
        };
      }

      try {
        for await (const entry of platform.fs.readDir(dir)) {
          // Skip hidden files/dirs
          if (entry.name.startsWith(".") && entry.name !== ".github") {
            continue;
          }

          const fullPath = platform.path.join(dir, entry.name);

          if (entry.isDirectory) {
            // Recurse into directory
            const subtree = await buildTree(fullPath, depth + 1);
            entries.push(subtree);
          } else {
            // Add file node
            try {
              const fileStat = await platform.fs.stat(fullPath);
              entries.push({
                name: entry.name,
                type: "file",
                size: fileStat.size,
              });
            } catch {
              // Skip if can't stat
              entries.push({
                name: entry.name,
                type: "file",
              });
            }
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }

      // Sort: directories first, then files, alphabetically
      entries.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return {
        name: platform.path.basename(dir),
        type: "directory",
        children: entries,
      };
    }

    const tree = await buildTree(targetPath, 0);

    return {
      success: true,
      tree,
      message: `Retrieved structure for ${args.path || "."}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to get structure: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

// ============================================================
// Tool Registry
// ============================================================

/**
 * All code tools with metadata
 */
export const CODE_TOOLS = {
  search_code: {
    fn: searchCode,
    description: "Search for pattern in code files",
    args: {
      pattern: "string - Regex pattern to search for",
      path: "string (optional) - Directory to search in (default: workspace root)",
      filePattern: "string (optional) - Glob pattern to filter files (e.g., '*.ts')",
      maxResults: "number (optional) - Maximum results to return (default: 100)",
    },
  },
  find_symbol: {
    fn: findSymbol,
    description: "Find function/class/const declarations",
    args: {
      name: "string - Symbol name to find",
      type: "string (optional) - 'function', 'class', or 'const' (default: all)",
      path: "string (optional) - Directory to search in (default: workspace root)",
    },
  },
  get_structure: {
    fn: getStructure,
    description: "Get directory tree structure",
    args: {
      path: "string (optional) - Directory to get structure for (default: workspace root)",
      maxDepth: "number (optional) - Maximum recursion depth (default: 5)",
    },
  },
} as const;
