/**
 * Agent Path Utilities
 *
 * SSOT helpers for path sandboxing.
 */

import { validatePath } from "./security/path-sandbox.ts";
import { expandCommonHomePath } from "../../common/home-folders.ts";
import { getBundledSkillsDir, getUserSkillsDir } from "../../common/paths.ts";
import { getPlatform } from "../../platform/platform.ts";
import {
  getAutoMemPath,
  getUserMemoryPath,
} from "../memory/paths.ts";

/**
 * Memory carve-out: paths the model is allowed to read/write/edit even when
 * they fall outside the workspace boundary. Mirrors CC's `filesystem.ts`
 * carve-outs around the auto-memory directory + user-level memory file.
 *
 * - User memory: `~/.hlvm/HLVM.md` (exact file)
 * - Auto-memory dir: `~/.hlvm/projects/<sanitized-canonical-git-root>/memory/`
 *   (recursive `**\/*.md` allowed inside; symlink validation enforced
 *   by validatePath itself)
 *
 * Project-level `./HLVM.md` lives inside the workspace root, so no carve-out
 * needed for that — it's already allowed.
 */
function getMemoryAllowedRoots(workspace: string): string[] {
  const platform = getPlatform();
  const roots: string[] = [];
  // User-level memory file. Adding its parent dir (~/.hlvm) would be too
  // broad; pass the file path directly. validatePath's isPathWithinRoot
  // accepts an exact-match root.
  try {
    roots.push(getUserMemoryPath());
  } catch {
    // ~/.hlvm may not be writable in some environments; carve-out skipped.
  }
  // Auto-memory dir keyed off canonical git root for the workspace.
  try {
    roots.push(getAutoMemPath(workspace));
  } catch {
    // Same fallback: skip rather than block.
  }
  return roots;
}

/**
 * Resolve a user-provided path against workspace.
 *
 * Auto-memory carve-out tightening: the auto-memory dir is added as an
 * allowed root by getMemoryAllowedRoots, but only `.md` files inside it are
 * acceptable as memory writes. This catches a model trying to drop
 * arbitrary files (e.g. `evil.sh`) into `~/.hlvm/projects/<key>/memory/`.
 */
export async function resolveToolPath(
  inputPath: string,
  workspace: string,
): Promise<string> {
  const platform = getPlatform();
  const expandedPath = expandCommonHomePath(
    inputPath,
    platform.env.get("HOME") ?? "",
  );
  const memoryRoots = getMemoryAllowedRoots(workspace);
  const resolved = await validatePath(expandedPath, workspace, [
    getUserSkillsDir(),
    getBundledSkillsDir(),
    ...memoryRoots,
  ]);
  // Post-validation: if the resolved path lives inside the auto-memory dir,
  // require a `.md` extension. validatePath accepts any file inside its
  // allowed roots; the memory carve-out additionally restricts extensions.
  const autoDir = memoryRoots.find((r) => r.includes("/projects/"));
  if (autoDir) {
    const inside = resolved.startsWith(autoDir) ||
      resolved === autoDir.replace(/\/$/, "");
    if (inside && !resolved.endsWith(".md")) {
      const { SecurityError } = await import("./security/path-sandbox.ts");
      throw new SecurityError(
        `Memory directory only accepts .md files: ${resolved}`,
        resolved,
      );
    }
  }
  return resolved;
}
