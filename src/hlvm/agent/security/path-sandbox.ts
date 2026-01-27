/**
 * Path Sandboxing - Security boundary enforcement for file operations
 *
 * Prevents path traversal attacks and ensures all file operations
 * stay within the designated workspace boundary.
 *
 * Security checks:
 * 1. Path resolution - normalize to absolute path
 * 2. Symlink rejection - prevent symlink escape attacks
 * 3. Boundary validation - ensure path stays within workspace
 */

import { getPlatform } from "../../../platform/platform.ts";

// ============================================================
// Error Types
// ============================================================

/**
 * Security violation error for path sandboxing
 */
export class SecurityError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = "SecurityError";
  }
}

// ============================================================
// Path Validation
// ============================================================

/**
 * Validate and normalize a path, ensuring it stays within workspace boundaries
 *
 * Security guarantees:
 * - Resolves relative paths to absolute paths
 * - Rejects symlinks (prevents symlink escape attacks)
 * - Verifies path is within workspace (prevents path traversal)
 *
 * @param path - Path to validate (relative or absolute)
 * @param workspaceRoot - Workspace root directory (must be absolute)
 * @returns Normalized absolute path within workspace
 * @throws SecurityError if path violates security constraints
 *
 * @example
 * ```ts
 * // Valid paths
 * await validatePath("./src/file.ts", "/project");  // -> "/project/src/file.ts"
 * await validatePath("src/file.ts", "/project");    // -> "/project/src/file.ts"
 * await validatePath("/project/file.ts", "/project"); // -> "/project/file.ts"
 *
 * // Invalid paths (throw SecurityError)
 * await validatePath("../../../etc/passwd", "/project");  // Path traversal
 * await validatePath("/etc/passwd", "/project");          // Outside workspace
 * await validatePath("./symlink", "/project");            // Symlink
 * ```
 */
export async function validatePath(
  path: string,
  workspaceRoot: string
): Promise<string> {
  const platform = getPlatform();

  // 1. Resolve to normalized absolute path
  // This handles relative paths, '.', '..', and normalizes separators
  const normalized = platform.path.resolve(workspaceRoot, path);

  // 2. Check if path exists and if it's a symlink (reject for security)
  // Symlinks can escape workspace boundaries, so we reject them entirely
  try {
    const stat = await platform.fs.stat(normalized);
    if (stat.isSymlink) {
      throw new SecurityError(
        `Symlinks not allowed for security: ${path}`,
        normalized
      );
    }
  } catch (error) {
    // If stat fails, path doesn't exist yet - that's OK for write operations
    // Only re-throw if it's our SecurityError
    if (error instanceof SecurityError) {
      throw error;
    }
    // For other errors (e.g., ENOENT), continue - we'll validate the parent
    // This allows creating new files within workspace
  }

  // 3. Verify path is within workspace (with proper boundary check)
  // Important: must handle the case where normalized === rootNormalized
  // (e.g., validatePath(".", "/workspace") should succeed)
  const rootNormalized = platform.path.resolve(workspaceRoot);

  // Add trailing separator to root for proper boundary checking
  // Example: "/workspace" -> "/workspace/"
  // This ensures "/workspace-other/file" doesn't match
  const rootWithSep = rootNormalized.endsWith("/")
    ? rootNormalized
    : rootNormalized + "/";

  // Check if path is within workspace:
  // - Exact match: normalized === rootNormalized (e.g., "." resolves to root)
  // - Prefix match: normalized starts with rootWithSep
  const isWithinWorkspace =
    normalized === rootNormalized || normalized.startsWith(rootWithSep);

  if (!isWithinWorkspace) {
    throw new SecurityError(
      `Path escapes workspace boundary: ${path}`,
      normalized
    );
  }

  return normalized;
}

/**
 * Validate multiple paths at once
 * Useful for operations that work with multiple files
 *
 * @param paths - Array of paths to validate
 * @param workspaceRoot - Workspace root directory
 * @returns Array of normalized absolute paths
 * @throws SecurityError if any path violates security constraints
 */
export async function validatePaths(
  paths: string[],
  workspaceRoot: string
): Promise<string[]> {
  return await Promise.all(paths.map((p) => validatePath(p, workspaceRoot)));
}

/**
 * Check if a path would be valid without throwing
 * Useful for pre-validation before attempting operations
 *
 * @param path - Path to check
 * @param workspaceRoot - Workspace root directory
 * @returns true if path is valid, false if it violates security
 */
export async function isPathValid(
  path: string,
  workspaceRoot: string
): Promise<boolean> {
  try {
    await validatePath(path, workspaceRoot);
    return true;
  } catch (error) {
    if (error instanceof SecurityError) {
      return false;
    }
    // Re-throw unexpected errors
    throw error;
  }
}
