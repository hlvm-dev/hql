/**
 * Instruction Hierarchy — global + project-level custom instructions with trust gating.
 *
 * Files:
 * - Global: ~/.hlvm/HLVM.md (always loaded)
 * - Project: <workspace>/.hlvm/HLVM.md (loaded only when workspace is trusted)
 * - Trust registry: ~/.hlvm/trusted-workspaces.json
 *
 * All I/O via getPlatform().fs.* (SSOT-compliant).
 */

import { getPlatform } from "../../platform/platform.ts";
import {
  getCustomInstructionsPath,
  getProjectInstructionsPath,
  getTrustedWorkspacesPath,
} from "../../common/paths.ts";
import { MAX_INSTRUCTION_CHARS, type InstructionHierarchy } from "./types.ts";

/**
 * Load instruction hierarchy for a session.
 *
 * - Always reads global instructions (~/.hlvm/HLVM.md)
 * - Reads project instructions only when workspace is trusted
 * - Missing files silently return empty strings (no errors)
 */
export async function loadInstructionHierarchy(
  workspace?: string,
): Promise<InstructionHierarchy> {
  const fs = getPlatform().fs;

  // Global instructions — always loaded
  let global = "";
  try {
    global = await fs.readTextFile(getCustomInstructionsPath());
  } catch { /* file not found — skip */ }

  // Without workspace, return global only
  if (!workspace) {
    return { global, project: "", trusted: false };
  }

  const projectPath = getProjectInstructionsPath(workspace);
  const trusted = await isWorkspaceTrusted(workspace);

  let project = "";
  if (trusted) {
    try {
      project = await fs.readTextFile(projectPath);
    } catch { /* file not found — skip */ }
  }

  return {
    global,
    project,
    projectPath,
    trusted,
  };
}

/**
 * Merge instruction hierarchy into a single string.
 * Project instructions appear first (higher priority), then global.
 * Combined output is capped at 2000 chars with project priority.
 */
export function mergeInstructions(hierarchy: InstructionHierarchy): string {
  const parts: string[] = [];
  if (hierarchy.project && hierarchy.trusted) {
    parts.push(hierarchy.project);
  }
  if (hierarchy.global) {
    parts.push(hierarchy.global);
  }
  return parts.join("\n\n").slice(0, MAX_INSTRUCTION_CHARS);
}

/**
 * Check whether a workspace is trusted for project instructions.
 */
export async function isWorkspaceTrusted(workspace: string): Promise<boolean> {
  const fs = getPlatform().fs;
  try {
    const raw = await fs.readTextFile(getTrustedWorkspacesPath());
    const data = JSON.parse(raw) as { workspaces?: string[] };
    return data.workspaces?.includes(workspace) ?? false;
  } catch {
    return false;
  }
}

/**
 * Add a workspace to the trusted list.
 */
export async function trustWorkspace(workspace: string): Promise<void> {
  const fs = getPlatform().fs;
  const path = getTrustedWorkspacesPath();
  let data: { workspaces: string[] } = { workspaces: [] };

  try {
    const raw = await fs.readTextFile(path);
    data = JSON.parse(raw) as { workspaces: string[] };
    if (!Array.isArray(data.workspaces)) {
      data.workspaces = [];
    }
  } catch { /* file not found — start fresh */ }

  if (!data.workspaces.includes(workspace)) {
    data.workspaces.push(workspace);
    await fs.writeTextFile(path, JSON.stringify(data, null, 2));
  }
}
