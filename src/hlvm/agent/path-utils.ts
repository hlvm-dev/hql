/**
 * Agent Path Utilities
 *
 * SSOT helpers for path sandboxing + policy enforcement.
 */

import { validatePath } from "./security/path-sandbox.ts";
import {
  enforcePathPolicy,
  isPathAllowedAbsolute,
  type AgentPolicy,
} from "./policy.ts";

/**
 * Resolve a user-provided path against workspace and policy.
 */
export async function resolveToolPath(
  inputPath: string,
  workspace: string,
  policy?: AgentPolicy | null,
): Promise<string> {
  const validPath = await validatePath(inputPath, workspace);
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
