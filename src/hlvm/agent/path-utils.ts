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
 * they fall outside the workspace boundary.
 *
 *   - User memory: `~/.hlvm/HLVM.md` (exact file)
 *   - Auto-memory dir: `~/.hlvm/memory/` (recursive `**\/*.md` only)
 *
 * HLVM is global-only — no per-project keying, no `./HLVM.md` reading.
 */
function getMemoryAllowedRoots(): string[] {
  const roots: string[] = [];
  try {
    roots.push(getUserMemoryPath());
  } catch {
    // ~/.hlvm may not be writable in some environments; carve-out skipped.
  }
  try {
    roots.push(getAutoMemPath());
  } catch {
    // Same fallback: skip rather than block.
  }
  return roots;
}

/**
 * Resolve a user-provided path against workspace.
 *
 * Auto-memory carve-out tightening: the auto-memory dir is added as an
 * allowed root, but only `.md` files inside it are acceptable as memory
 * writes. This blocks the model dropping arbitrary files (e.g. `evil.sh`)
 * into `~/.hlvm/memory/`.
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
  const memoryRoots = getMemoryAllowedRoots();
  const resolved = await validatePath(expandedPath, workspace, [
    getUserSkillsDir(),
    getBundledSkillsDir(),
    ...memoryRoots,
  ]);
  // Post-validation: if the resolved path lives inside the auto-memory dir,
  // require a `.md` extension. The user-level HLVM.md root is exact-path so
  // can't trigger this branch; only the auto-memory-dir root can.
  const autoMemDir = getAutoMemPath();
  const insideAutoMem = resolved.startsWith(autoMemDir) ||
    resolved === autoMemDir.replace(/\/$/, "");
  if (insideAutoMem && !resolved.endsWith(".md")) {
    const { SecurityError } = await import("./security/path-sandbox.ts");
    throw new SecurityError(
      `Memory directory only accepts .md files: ${resolved}`,
      resolved,
    );
  }
  return resolved;
}
