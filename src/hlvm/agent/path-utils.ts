/**
 * Agent Path Utilities
 *
 * SSOT helpers for path sandboxing + policy enforcement.
 */

import { validatePath } from "./security/path-sandbox.ts";
import {
  enforcePathPolicy,
  isPathAllowedAbsolute,
  resolvePolicyPathRoots,
  type AgentPolicy,
} from "./policy.ts";
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
  const expandedPath = expandUserHome(inputPath, platform.env.get("HOME") ?? "");
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

/** Expand `~` and common home-relative shortcuts to an absolute path. */
function expandUserHome(path: string, home: string): string {
  if (!path) return path;
  if (path.startsWith("~")) {
    if (!home) return path;
    return path.replace(/^~(?=$|\/)/, home);
  }

  if (!home) return path;
  const normalizedHome = home.replace(/\/+$/, "");

  if (!normalizedHome.startsWith("/home/") && path.startsWith("/home/")) {
    const suffix = path.replace(/^\/home\/[^/]+/, "");
    if (suffix === "") return normalizedHome;
    return `${normalizedHome}${suffix}`;
  }

  const folderMatch = path.match(/^\/(downloads|desktop|documents)(\/.*)?$/i);
  if (folderMatch) {
    const map: Record<string, string> = {
      downloads: "Downloads",
      desktop: "Desktop",
      documents: "Documents",
    };
    const folder = map[folderMatch[1].toLowerCase()];
    const suffix = folderMatch[2] ?? "";
    return `${normalizedHome}/${folder}${suffix}`;
  }

  return path;
}
