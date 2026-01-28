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
/**
 * Validates that a path is within workspace and doesn't escape via symlinks.
 *
 * EDGE CASE: Parent-chain validation for non-existent paths
 * - When validating /workspace/new/file.ts where 'new/' doesn't exist yet:
 *   1. Split path into components: ['new', 'file.ts']
 *   2. For each component, check if it exists
 *   3. If component doesn't exist (like 'new/' or 'file.ts'):
 *      - SKIP lstat check (file doesn't exist, can't be a symlink)
 *      - Continue to parent validation
 *   4. If component DOES exist:
 *      - Use lstat() to check if it's a symlink
 *      - If symlink: throw SecurityError (potential escape)
 *   5. Validate all existing parents in the chain
 *
 * This allows write_file to create NEW files/dirs while still preventing
 * symlink escapes through existing parent directories.
 *
 * @throws SecurityError if path escapes workspace or contains symlinks
 */
export async function validatePath(
  path: string,
  workspaceRoot: string
): Promise<string> {
  const platform = getPlatform();

  // 1. Normalize paths
  const normalizedPath = platform.path.resolve(workspaceRoot, path);
  const normalizedWorkspace = platform.path.resolve(workspaceRoot);

  // 2. Check if path is within workspace (with proper boundary check)
  const workspaceWithSep = normalizedWorkspace.endsWith("/")
    ? normalizedWorkspace
    : normalizedWorkspace + "/";

  const isWithinWorkspace =
    normalizedPath === normalizedWorkspace ||
    normalizedPath.startsWith(workspaceWithSep);

  if (!isWithinWorkspace) {
    throw new SecurityError(
      `Path escapes workspace boundary: ${path}`,
      normalizedPath
    );
  }

  // 3. Validate each component in the path for symlinks
  // Get relative path from workspace and split into components
  const relativePath = platform.path.relative(
    normalizedWorkspace,
    normalizedPath
  );

  // If path is exactly the workspace root, no components to check
  if (relativePath === "" || relativePath === ".") {
    return normalizedPath;
  }

  const components = relativePath.split(platform.path.sep);

  // Validate each component in the path chain
  let currentPath = normalizedWorkspace;
  for (const component of components) {
    currentPath = platform.path.join(currentPath, component);

    // CRITICAL: Check if this component exists
    let exists = false;
    try {
      await platform.fs.lstat(currentPath); // Use lstat (doesn't follow symlinks)
      exists = true;
    } catch (_error) {
      // Component doesn't exist - this is OK (user might be creating new file/dir)
      // Skip symlink check for non-existent components
      exists = false;
    }

    if (exists) {
      // Component exists - check if it's a symlink using lstat
      const info = await platform.fs.lstat(currentPath);
      if (info.isSymlink) {
        throw new SecurityError(
          `Path contains symlink component: ${component}`,
          currentPath
        );
      }
    }
    // If component doesn't exist, continue to check remaining parents
  }

  return normalizedPath;
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
