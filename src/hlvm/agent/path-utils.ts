/**
 * Agent Path Utilities
 *
 * SSOT helpers for path sandboxing.
 */

import { validatePath } from "./security/path-sandbox.ts";
import { expandCommonHomePath } from "../../common/home-folders.ts";
import { getBundledSkillsDir, getUserSkillsDir } from "../../common/paths.ts";
import { getPlatform } from "../../platform/platform.ts";

/**
 * Resolve a user-provided path against workspace.
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
  return await validatePath(expandedPath, workspace, [
    getUserSkillsDir(),
    getBundledSkillsDir(),
  ]);
}
