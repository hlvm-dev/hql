/**
 * Agent Path Utilities
 *
 * SSOT helpers for path sandboxing + policy enforcement.
 */

import { validatePath } from "./security/path-sandbox.ts";
import {
  type AgentPolicy,
  enforcePathPolicy,
  isPathAllowedAbsolute,
  resolvePolicyPathRoots,
} from "./policy.ts";
import { expandCommonHomePath } from "../../common/home-folders.ts";
import { getPlatform } from "../../platform/platform.ts";

/**
 * Resolve a user-provided path against workspace and policy.
 */
export async function resolveToolPath(
  inputPath: string,
  workspace: string,
  policy?: AgentPolicy | null,
): Promise<string> {
  const platform = getPlatform();
  const expandedPath = expandCommonHomePath(
    inputPath,
    platform.env.get("HOME") ?? "",
  );
  const roots = resolvePolicyPathRoots(policy ?? null, workspace);
  const validPath = await validatePath(expandedPath, workspace, roots);
  enforcePathPolicy(policy ?? null, workspace, validPath, inputPath);
  return validPath;
}

/**
 * Create a reusable policy path checker for a workspace.
 */
export function createPolicyPathChecker(
  policy: AgentPolicy | null | undefined,
  workspace: string,
): (absolutePath: string) => boolean {
  return (absolutePath: string) =>
    isPathAllowedAbsolute(policy, workspace, absolutePath);
}
