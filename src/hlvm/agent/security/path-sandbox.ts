import { getPlatform } from "../../../platform/platform.ts";

export class SecurityError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = "SecurityError";
  }
}

export function isPathWithinRoot(
  absolutePath: string,
  root: string,
): boolean {
  const platform = getPlatform();
  const isWindows = platform.build.os === "windows";
  const normalizedPath = platform.path.resolve(absolutePath);
  const normalizedRoot = platform.path.resolve(root);

  const pathForCompare = isWindows
    ? normalizedPath.toLowerCase()
    : normalizedPath;
  const rootForCompare = isWindows
    ? normalizedRoot.toLowerCase()
    : normalizedRoot;

  const rootWithSep = rootForCompare.endsWith(platform.path.sep)
    ? rootForCompare
    : rootForCompare + platform.path.sep;

  return pathForCompare === rootForCompare ||
    pathForCompare.startsWith(rootWithSep);
}

/**
 * Resolves `path` against `workspaceRoot`, requires it to live under the workspace
 * (or any provided extra `allowedRoots`), and rejects existing path components
 * that are symlinks. Components that do not yet exist are allowed so callers can
 * create new files inside the sandbox.
 */
export async function validatePath(
  path: string,
  workspaceRoot: string,
  allowedRoots: string[] = [],
): Promise<string> {
  const platform = getPlatform();
  const normalizedPath = platform.path.resolve(workspaceRoot, path);
  const normalizedWorkspace = platform.path.resolve(workspaceRoot);
  const normalizedRoots = allowedRoots.map((root) =>
    platform.path.resolve(workspaceRoot, root)
  );
  const candidateRoots = [normalizedWorkspace, ...normalizedRoots];
  const matchedRoot = candidateRoots.find((root) =>
    isPathWithinRoot(normalizedPath, root)
  );

  if (!matchedRoot) {
    throw new SecurityError(
      `Path escapes workspace boundary: ${path}. Use a path inside the workspace or allowed roots like "~/Downloads", "~/Desktop", or "~/Documents".`,
      normalizedPath,
    );
  }

  const relativePath = platform.path.relative(matchedRoot, normalizedPath);
  if (relativePath === "" || relativePath === ".") return normalizedPath;

  let currentPath = matchedRoot;
  for (const component of relativePath.split(platform.path.sep)) {
    currentPath = platform.path.join(currentPath, component);
    try {
      // lstat (not stat) so symlinks are reported instead of followed.
      const info = await platform.fs.lstat(currentPath);
      if (info.isSymlink) {
        throw new SecurityError(
          `Path contains symlink component: ${component}`,
          currentPath,
        );
      }
    } catch (error) {
      if (error instanceof SecurityError) throw error;
      // Component does not exist yet; skip symlink check and continue.
    }
  }

  return normalizedPath;
}
