/**
 * Memory directory path resolution.
 *
 * HLVM is global-only — there is no project-based memory concept. All
 * memory lives under `~/.hlvm/`:
 *
 *   ~/.hlvm/HLVM.md           — user-authored notes
 *   ~/.hlvm/memory/MEMORY.md  — auto-memory index
 *   ~/.hlvm/memory/*.md       — auto-memory topic files
 *
 * No `./HLVM.md` in repos. No `~/.hlvm/projects/<key>/` per-project keying.
 * No git-root resolution. See docs/ARCHITECTURE.md.
 */

import { getPlatform } from "../../platform/platform.ts";
import { expandCommonHomePath } from "../../common/home-folders.ts";
import { getHlvmDir, getHlvmInstructionsPath } from "../../common/paths.ts";

const AUTO_MEM_DIRNAME = "memory";
const AUTO_MEM_ENTRYPOINT_NAME = "MEMORY.md";

/**
 * User-level memory file: `~/.hlvm/HLVM.md`.
 * Reuses the existing `getHlvmInstructionsPath()` SSOT.
 */
export function getUserMemoryPath(): string {
  return getHlvmInstructionsPath();
}

/**
 * Auto-memory directory: `~/.hlvm/memory/`. Trailing separator included so
 * `isAutoMemPath()` can do `startsWith` without surprises.
 */
export function getAutoMemPath(): string {
  const platform = getPlatform();
  return platform.path.join(getHlvmDir(), AUTO_MEM_DIRNAME) +
    platform.path.sep;
}

/**
 * Auto-memory entrypoint: `~/.hlvm/memory/MEMORY.md`.
 */
export function getAutoMemEntrypoint(): string {
  const platform = getPlatform();
  return platform.path.join(getAutoMemPath(), AUTO_MEM_ENTRYPOINT_NAME);
}

/**
 * Path-traversal-safe membership check: is `absolutePath` inside the
 * auto-memory directory? Used by the permission carve-out in
 * `src/hlvm/agent/path-utils.ts`.
 */
export function isAutoMemPath(absolutePath: string): boolean {
  const platform = getPlatform();
  const normalized = platform.path.normalize(absolutePath);
  return normalized.startsWith(getAutoMemPath());
}

/**
 * User-visible memory write predicate used for notifications and tests.
 * Matches only global HLVM memory: `~/.hlvm/HLVM.md` and `~/.hlvm/memory/*.md`.
 */
export function isMemoryPath(path: string): boolean {
  const platform = getPlatform();
  const expanded = expandCommonHomePath(
    path,
    platform.env.get("HOME") ?? "",
  );
  const normalized = platform.path.normalize(expanded);
  const userMemory = platform.path.normalize(getUserMemoryPath());
  return normalized === userMemory ||
    (isAutoMemPath(normalized) && normalized.endsWith(".md"));
}

/**
 * Whether auto-memory features are enabled.
 *   HLVM_DISABLE_AUTO_MEMORY=1 → off
 *   default → on
 */
export function isAutoMemoryEnabled(): boolean {
  const raw = getPlatform().env.get("HLVM_DISABLE_AUTO_MEMORY");
  if (!raw) return true;
  const v = raw.trim().toLowerCase();
  return !(v === "1" || v === "true" || v === "yes");
}
