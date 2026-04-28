/**
 * Memory directory path resolution.
 *
 * Mirrors CC's memdir/paths.ts but simplified for HLVM:
 * - Drops CCR/Cowork overrides (HLVM has no remote-managed memory)
 * - Drops KAIROS daily-log paths (out of scope)
 * - Drops EXTRACT_MEMORIES gating (feature-gated in CC, skipped per plan)
 * - Uses HLVM platform fs (no direct fs/process access — SSOT)
 */

import { getPlatform } from "../../platform/platform.ts";
import { getHlvmDir, getHlvmInstructionsPath } from "../../common/paths.ts";

const AUTO_MEM_DIRNAME = "memory";
const AUTO_MEM_ENTRYPOINT_NAME = "MEMORY.md";
const PROJECT_MEMORY_FILENAME = "HLVM.md";
const PROJECTS_SEGMENT = "projects";

/**
 * User-level memory file: ~/.hlvm/HLVM.md.
 * Reuses the existing `getHlvmInstructionsPath()` SSOT — same path that the
 * deleted global-instructions.ts used to read.
 */
export function getUserMemoryPath(): string {
  return getHlvmInstructionsPath();
}

/**
 * Project-level memory file: <cwd>/HLVM.md (or current project root).
 * The model and user can both `read_file`/`write_file` against this path.
 */
export function getProjectMemoryPath(cwd?: string): string {
  const platform = getPlatform();
  const base = cwd ?? platform.process.cwd();
  return platform.path.join(base, PROJECT_MEMORY_FILENAME);
}

/**
 * Memory base dir: ~/.hlvm. Sibling helpers like `getAutoMemPath()` derive
 * project-scoped paths from here.
 */
export function getMemoryBaseDir(): string {
  return getHlvmDir();
}

/**
 * Walk up from `cwd` looking for a `.git` directory. Returns the directory
 * containing it, or null if not in a git repo. Synchronous filesystem walk
 * via platform shim — no subprocess.
 *
 * "Canonical" means: if cwd is inside a worktree (.git is a file pointing
 * elsewhere), we still return the worktree's own root, NOT the main repo's
 * root. This matches CC's findCanonicalGitRoot intent for the common case
 * (worktrees of the same repo share auto-memory because they share cwd
 * tail; if you want shared memory across worktrees with different cwds,
 * resolve through .git file content — deferred).
 */
export function findCanonicalGitRoot(cwd: string): string | null {
  const platform = getPlatform();
  let current = platform.path.resolve(cwd);
  while (true) {
    const gitPath = platform.path.join(current, ".git");
    let kind: "dir" | "file" | "missing" = "missing";
    try {
      const info = platform.fs.statSync(gitPath);
      kind = info.isDirectory ? "dir" : info.isFile ? "file" : "missing";
    } catch {
      kind = "missing";
    }
    if (kind === "dir") return current;
    if (kind === "file") {
      // Worktree: .git is a file like "gitdir: /abs/.../main/.git/worktrees/foo".
      // Resolve back to the main repo root so all worktrees of the same repo
      // share one auto-memory directory.
      try {
        const text = platform.fs.readTextFileSync(gitPath);
        const m = text.match(/^gitdir:\s*(.+)$/m);
        if (m && m[1]) {
          const gitdir = platform.path.resolve(m[1].trim());
          // gitdir is typically <main-repo>/.git/worktrees/<name>. Walk up
          // until we hit a directory named ".git", then return its parent.
          let p = gitdir;
          while (true) {
            if (platform.path.basename(p) === ".git") {
              return platform.path.dirname(p);
            }
            const parent = platform.path.dirname(p);
            if (parent === p) break;
            p = parent;
          }
        }
      } catch {
        // Fall through — return the worktree's own root as best effort
      }
      return current;
    }
    const parent = platform.path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Sanitize a directory path into a single safe filesystem segment.
 * `/Users/me/dev/hql` → `-Users-me-dev-hql` (matches CC's project-key shape
 * and the existing `~/.hlvm/projects/<key>/...` pattern observed in this repo).
 */
export function sanitizeProjectKey(absPath: string): string {
  return absPath.replace(/[^A-Za-z0-9_.-]/g, "-");
}

/**
 * Resolve the auto-memory base path for a given cwd:
 *   git-rooted: ~/.hlvm/projects/<sanitized-canonical-git-root>/memory/
 *   non-git:    ~/.hlvm/projects/<sanitized-cwd>/memory/
 *
 * Trailing separator included so `isAutoMemPath()` can do startsWith
 * without surprises.
 */
export function getAutoMemPath(cwd?: string): string {
  const platform = getPlatform();
  const base = cwd ?? platform.process.cwd();
  const projectAnchor = findCanonicalGitRoot(base) ?? base;
  const projectsDir = platform.path.join(getMemoryBaseDir(), PROJECTS_SEGMENT);
  return platform.path.join(
    projectsDir,
    sanitizeProjectKey(projectAnchor),
    AUTO_MEM_DIRNAME,
  ) + platform.path.sep;
}

/**
 * Auto-memory entrypoint: <autoMemPath>/MEMORY.md.
 */
export function getAutoMemEntrypoint(cwd?: string): string {
  const platform = getPlatform();
  return platform.path.join(getAutoMemPath(cwd), AUTO_MEM_ENTRYPOINT_NAME);
}

/**
 * Path-traversal-safe membership check: is `absolutePath` inside the
 * auto-memory directory for the current (or given) cwd?
 *
 * Used by the Phase 3 permission carve-out in file-tools.ts to decide
 * whether `read_file` / `write_file` / `edit_file` should be allowed
 * against a path under `~/.hlvm/projects/<key>/memory/`.
 */
export function isAutoMemPath(absolutePath: string, cwd?: string): boolean {
  const platform = getPlatform();
  const normalized = platform.path.normalize(absolutePath);
  return normalized.startsWith(getAutoMemPath(cwd));
}

/**
 * Whether auto-memory features are enabled. Simple gate:
 *   HLVM_DISABLE_AUTO_MEMORY=1 → off
 *   default → on
 *
 * Far simpler than CC's 5-step priority chain (which carries CCR/Cowork
 * concerns we don't have).
 */
export function isAutoMemoryEnabled(): boolean {
  const raw = getPlatform().env.get("HLVM_DISABLE_AUTO_MEMORY");
  if (!raw) return true;
  const v = raw.trim().toLowerCase();
  return !(v === "1" || v === "true" || v === "yes");
}
