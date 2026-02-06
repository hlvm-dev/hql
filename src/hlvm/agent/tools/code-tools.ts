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
import { resolveToolPath, createPolicyPathChecker } from "../path-utils.ts";
import type { ToolExecutionOptions } from "../registry.ts";
import { escapeRegExp } from "../../../common/utils.ts";
import { formatToolError, okTool, failTool } from "../tool-results.ts";
import { walkDirectory, loadGitignore } from "../../../common/file-utils.ts";
import { RESOURCE_LIMITS } from "../constants.ts";
import { assertMaxBytes, ResourceLimitError } from "../../../common/limits.ts";
import { throwIfAborted } from "../../../common/timeout-utils.ts";
import { matchGlob } from "../../../common/pattern-utils.ts";

// ============================================================
// Types
// ============================================================

/** Result of a code search match */
interface SearchMatch {
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
  maxFileBytes?: number;
}

/** Result of search_code operation */
interface SearchCodeResult {
  success: boolean;
  matches?: SearchMatch[];
  count?: number;
  message?: string;
}

/** Result of a symbol find */
interface SymbolMatch {
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
  maxFileBytes?: number;
  maxResults?: number;
}

/** Result of find_symbol operation */
interface FindSymbolResult {
  success: boolean;
  symbols?: SymbolMatch[];
  count?: number;
  message?: string;
}

/** Directory tree node */
interface TreeNode {
  name: string;
  type: "file" | "directory";
  size?: number;
  children?: TreeNode[];
}

/** Arguments for get_structure tool */
export interface GetStructureArgs {
  path?: string;
  maxDepth?: number;
  maxNodes?: number;
}

/** Result of get_structure operation */
interface GetStructureResult {
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
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<SearchCodeResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();
    const isAllowedPath = createPolicyPathChecker(
      options?.policy ?? null,
      workspace,
    );

    // Validate and resolve search path
    const searchPath = args.path
      ? await resolveToolPath(args.path, workspace, options?.policy ?? null)
      : workspace;

    // Load gitignore patterns
    const gitignorePatterns = await loadGitignore(workspace);

    // Walk directory to get files
    const matches: SearchMatch[] = [];
    const pattern = new RegExp(args.pattern, "gi");
    const maxResults = Math.min(
      args.maxResults ?? RESOURCE_LIMITS.maxSearchResults,
      RESOURCE_LIMITS.maxSearchResults,
    );
    const maxFileBytes = Math.min(
      args.maxFileBytes ?? RESOURCE_LIMITS.maxSearchFileBytes,
      RESOURCE_LIMITS.maxSearchFileBytes,
    );

    // Helper to check if file matches file pattern
    const matchesFilePattern = (relativePath: string): boolean => {
      if (!args.filePattern) return true;
      const pattern = args.filePattern;
      const hasPathSep = pattern.includes("/") || pattern.includes("\\");
      if (hasPathSep) {
        return matchGlob(relativePath, pattern, { matchPath: true });
      }
      const filename = platform.path.basename(relativePath);
      return matchGlob(filename, pattern, { matchPath: false });
    };

    // Walk directory and search in files
    for await (
      const entry of walkDirectory({
        baseDir: searchPath,
        maxDepth: 10,
        gitignorePatterns,
      })
    ) {
      throwIfAborted(options?.signal);
      // Skip directories
      if (entry.isDirectory) continue;

      // Check file pattern filter
      if (!matchesFilePattern(entry.path)) continue;
      const filename = platform.path.basename(entry.path);

      // Enforce policy path rules (relative to workspace)
      if (!isAllowedPath(entry.fullPath)) {
        continue;
      }

      // Skip binary-like files
      if (filename.endsWith(".png") || filename.endsWith(".jpg") ||
        filename.endsWith(".gif") || filename.endsWith(".ico") ||
        filename.endsWith(".woff") || filename.endsWith(".ttf")) {
        continue;
      }

      try {
        // Enforce per-file size limit
        const stat = await platform.fs.stat(entry.fullPath);
        assertMaxBytes("search_code file size", stat.size ?? 0, maxFileBytes);

        // Read file content
        const content = await platform.fs.readTextFile(entry.fullPath);
        const lines = content.split("\n");

        // Search each line
        for (let i = 0; i < lines.length; i++) {
          throwIfAborted(options?.signal);
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
              return okTool({
                matches,
                count: matches.length,
                message: `Found ${matches.length} matches (limit reached)`,
              });
            }
          }

          // Reset regex lastIndex for global flag
          pattern.lastIndex = 0;
        }
      } catch (error) {
        // Skip files we can't read or exceed limits
        if (error instanceof ResourceLimitError) {
          continue;
        }
        continue;
      }
    }

    return okTool({
      matches,
      count: matches.length,
      message: `Found ${matches.length} matches`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to search code", error);
    return failTool(message);
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
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<FindSymbolResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();
    const isAllowedPath = createPolicyPathChecker(
      options?.policy ?? null,
      workspace,
    );

    // Validate and resolve search path
    const searchPath = args.path
      ? await resolveToolPath(args.path, workspace, options?.policy ?? null)
      : workspace;

    // Check if search path is a file or directory
    const stat = await platform.fs.stat(searchPath);
    const isFile = !stat.isDirectory;

    // Load gitignore patterns
    const gitignorePatterns = await loadGitignore(workspace);

    // Build regex patterns for different symbol types
    const escapedName = escapeRegExp(args.name);
    const patterns: Record<string, RegExp> = {
      function: new RegExp(
        `(?:export\\s+)?(?:async\\s+)?(?:function\\s+${escapedName}|const\\s+${escapedName}\\s*=.*(?:async\\s+)?(?:\\(|function))`,
        "i"
      ),
      class: new RegExp(
        `(?:export\\s+)?(?:abstract\\s+)?class\\s+${escapedName}\\s*[{<]`,
        "i"
      ),
      const: new RegExp(
        `(?:export\\s+)?const\\s+${escapedName}\\s*[=:]`,
        "i"
      ),
    };

    // Determine which patterns to search for
    const searchPatterns = args.type
      ? { [args.type]: patterns[args.type] }
      : patterns;

    const symbols: SymbolMatch[] = [];
    const maxResults = Math.min(
      args.maxResults ?? RESOURCE_LIMITS.maxSearchResults,
      RESOURCE_LIMITS.maxSearchResults,
    );
    const maxFileBytes = Math.min(
      args.maxFileBytes ?? RESOURCE_LIMITS.maxSearchFileBytes,
      RESOURCE_LIMITS.maxSearchFileBytes,
    );
    const maxFiles = RESOURCE_LIMITS.maxSymbolFiles;
    let filesScanned = 0;

    // Helper function to search in a single file
    const searchFile = async (filePath: string, relativePath: string) => {
      throwIfAborted(options?.signal);
      if (!isAllowedPath(filePath)) {
        return;
      }
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
        const stat = await platform.fs.stat(filePath);
        assertMaxBytes("find_symbol file size", stat.size ?? 0, maxFileBytes);
        const content = await platform.fs.readTextFile(filePath);
        throwIfAborted(options?.signal);
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          throwIfAborted(options?.signal);
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
              if (symbols.length >= maxResults) {
                return;
              }
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
        throwIfAborted(options?.signal);
        if (entry.isDirectory) continue;
        filesScanned++;
        if (filesScanned > maxFiles) {
          break;
        }
        await searchFile(entry.fullPath, entry.path);
        if (symbols.length >= maxResults) {
          break;
        }
      }
    }

    return okTool({
      symbols,
      count: symbols.length,
      message: symbols.length >= maxResults
        ? `Found ${symbols.length} symbol(s) (limit reached)`
        : `Found ${symbols.length} symbol(s) matching '${args.name}'`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to find symbol", error);
    return failTool(message);
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
  workspace: string,
  options?: ToolExecutionOptions,
): Promise<GetStructureResult> {
  try {
    throwIfAborted(options?.signal);
    const platform = getPlatform();
    const isAllowedPath = createPolicyPathChecker(
      options?.policy ?? null,
      workspace,
    );

    // Validate and resolve path
    const targetPath = args.path
      ? await resolveToolPath(args.path, workspace, options?.policy ?? null)
      : workspace;

    if (!isAllowedPath(targetPath)) {
      return failTool(`Path denied by policy: ${args.path ?? "."}`);
    }

    const maxDepth = args.maxDepth || 5;
    const maxNodes = Math.min(
      args.maxNodes ?? RESOURCE_LIMITS.maxListEntries,
      RESOURCE_LIMITS.maxListEntries,
    );
    let nodes = 0;

    // Check if path is a directory
    const stat = await platform.fs.stat(targetPath);
    if (!stat.isDirectory) {
      return failTool(`Path is not a directory: ${args.path}`);
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
          throwIfAborted(options?.signal);
          if (nodes >= maxNodes) {
            break;
          }
          // Skip hidden files/dirs
          if (entry.name.startsWith(".") && entry.name !== ".github") {
            continue;
          }

          const fullPath = platform.path.join(dir, entry.name);
          if (!isAllowedPath(fullPath)) {
            continue;
          }

          if (entry.isDirectory) {
            nodes++;
            // Recurse into directory
            const subtree = await buildTree(fullPath, depth + 1);
            entries.push(subtree);
          } else {
            // Add file node
            try {
              const fileStat = await platform.fs.stat(fullPath);
              nodes++;
              entries.push({
                name: entry.name,
                type: "file",
                size: fileStat.size,
              });
            } catch {
              nodes++;
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

    return okTool({
      tree,
      message: nodes >= maxNodes
        ? `Retrieved structure (limit reached)`
        : `Retrieved structure for ${args.path || "."}`,
    });
  } catch (error) {
    const { message } = formatToolError("Failed to get structure", error);
    return failTool(message);
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
    safetyLevel: "L0",
    args: {
      pattern: "string - Regex pattern to search for",
      path: "string (optional) - Directory to search in (default: workspace root)",
      filePattern: "string (optional) - Glob pattern to filter files (e.g., '*.ts')",
      maxResults: "number (optional) - Maximum results to return (default: 100)",
      maxFileBytes: "number (optional) - Max file size to scan (capped by limits)",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      matches: "SearchMatch[] - Pattern matches (on success)",
      count: "number - Number of matches (on success)",
      message: "string - Human-readable result message",
    },
  },
  find_symbol: {
    fn: findSymbol,
    description: "Find function/class/const declarations",
    safetyLevel: "L0",
    args: {
      name: "string - Symbol name to find",
      type: "string (optional) - 'function', 'class', or 'const' (default: all)",
      path: "string (optional) - Directory to search in (default: workspace root)",
      maxResults: "number (optional) - Maximum results to return (capped by limits)",
      maxFileBytes: "number (optional) - Max file size to scan (capped by limits)",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      symbols: "SymbolMatch[] - Matches found (on success)",
      count: "number - Number of matches (on success)",
      message: "string - Human-readable result message",
    },
  },
  get_structure: {
    fn: getStructure,
    description:
      "Get directory tree structure for the workspace (codebase). Use list_files for user folders like ~/Downloads.",
    safetyLevel: "L0",
    args: {
      path: "string (optional) - Directory to get structure for (default: workspace root)",
      maxDepth: "number (optional) - Maximum recursion depth (default: 5)",
      maxNodes: "number (optional) - Maximum nodes to include (capped by limits)",
    },
    returns: {
      success: "boolean - Whether the operation succeeded",
      tree: "TreeNode - Directory tree structure (on success)",
      message: "string - Human-readable result message",
    },
  },
} as const;
