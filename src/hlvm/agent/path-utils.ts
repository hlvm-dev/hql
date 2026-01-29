/**
 * Agent Path Utilities
 *
 * SSOT helpers for path sandboxing + policy enforcement.
 */

import { validatePath } from "./security/path-sandbox.ts";
import { enforcePathPolicy, type AgentPolicy } from "./policy.ts";

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
 * Resolve an optional path (defaults to workspace).
 */
export async function resolveToolPathOrWorkspace(
  inputPath: string | undefined,
  workspace: string,
  policy?: AgentPolicy | null,
): Promise<string> {
  if (!inputPath) return workspace;
  return await resolveToolPath(inputPath, workspace, policy);
}
