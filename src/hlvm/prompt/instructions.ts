/**
 * Instruction Hierarchy — global + project-level custom instructions with trust gating.
 *
 * Files:
 * - Global: ~/.hlvm/HLVM.md (always loaded)
 * - Project: <workspace>/.hlvm/HLVM.md (loaded only when workspace is trusted)
 * - Global rules: ~/.hlvm/rules/*.md (always loaded)
 * - Project rules: <workspace>/.hlvm/rules/*.md (loaded only when trusted)
 * - Trust registry: ~/.hlvm/trusted-workspaces.json
 *
 * Supports @include directives: `@./relative/path` in instruction files
 * resolves and inlines the referenced file (max depth 3, max 4000 chars each).
 *
 * All I/O via getPlatform().fs.* (SSOT-compliant).
 */

import { getPlatform } from "../../platform/platform.ts";
import {
  getCustomInstructionsPath,
  getProjectInstructionsPath,
  getProjectRulesDir,
  getRulesDir,
  getTrustedWorkspacesPath,
} from "../../common/paths.ts";
import { type InstructionHierarchy, MAX_INSTRUCTION_CHARS } from "./types.ts";

// ── @include directive support ───────────────────────────────────────

const INCLUDE_PATTERN = /^@(\.\/.+)$/gm;
const MAX_INCLUDE_DEPTH = 3;
const MAX_INCLUDE_CHARS = 4000;

/**
 * Resolve `@./relative/path` include directives in instruction text.
 *
 * - Only relative paths (starting with `./`) are allowed for security.
 * - Max recursion depth: 3. Max included file size: 4000 chars.
 * - Circular includes are detected via a `seen` set of absolute paths.
 * - Missing files produce an inline placeholder.
 */
async function resolveIncludes(
  text: string,
  baseDir: string,
  seen: Set<string> = new Set(),
  depth: number = 0,
): Promise<string> {
  if (depth > MAX_INCLUDE_DEPTH) return text;

  const platform = getPlatform();
  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const match = line.match(/^@(\.\/.+)$/);
    if (!match) {
      result.push(line);
      continue;
    }

    const relativePath = match[1];
    const absolutePath = platform.path.resolve(baseDir, relativePath);

    if (seen.has(absolutePath)) {
      result.push(line); // circular — keep directive as-is
      continue;
    }

    let content: string;
    try {
      content = await platform.fs.readTextFile(absolutePath);
    } catch {
      result.push(`[include not found: ${relativePath}]`);
      continue;
    }

    if (content.length > MAX_INCLUDE_CHARS) {
      content = content.slice(0, MAX_INCLUDE_CHARS);
    }

    const nextSeen = new Set(seen);
    nextSeen.add(absolutePath);
    const includedDir = platform.path.dirname(absolutePath);
    const resolved = await resolveIncludes(content, includedDir, nextSeen, depth + 1);
    result.push(resolved);
  }

  return result.join("\n");
}

// ── Rules directory loading ──────────────────────────────────────────

/**
 * Load all `.md` files from a rules directory, sorted alphabetically.
 * Returns empty string if directory is missing or empty.
 */
async function loadRulesDir(dir: string): Promise<string> {
  const fs = getPlatform().fs;

  const exists = await fs.exists(dir);
  if (!exists) return "";

  const entries: string[] = [];
  for await (const entry of fs.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      entries.push(entry.name);
    }
  }

  if (entries.length === 0) return "";

  entries.sort();

  const parts: string[] = [];
  for (const name of entries) {
    const filePath = getPlatform().path.join(dir, name);
    try {
      const content = await fs.readTextFile(filePath);
      const trimmed = content.trim();
      if (trimmed) parts.push(trimmed);
    } catch { /* skip unreadable files */ }
  }

  return parts.join("\n\n");
}

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
  const pathUtil = getPlatform().path;

  // Global instructions — always loaded
  let global = "";
  const globalPath = getCustomInstructionsPath();
  try {
    global = await fs.readTextFile(globalPath);
    global = await resolveIncludes(global, pathUtil.dirname(globalPath));
  } catch { /* file not found — skip */ }

  // Global rules — always loaded
  const globalRules = await loadRulesDir(getRulesDir());

  // Without workspace, return global only
  if (!workspace) {
    return { global, project: "", trusted: false, globalRules, projectRules: "" };
  }

  const projectPath = getProjectInstructionsPath(workspace);
  const trusted = await isWorkspaceTrusted(workspace);

  let project = "";
  if (trusted) {
    try {
      project = await fs.readTextFile(projectPath);
      project = await resolveIncludes(project, pathUtil.dirname(projectPath));
    } catch { /* file not found — skip */ }
  }

  // Project rules — only when trusted
  const projectRules = trusted ? await loadRulesDir(getProjectRulesDir(workspace)) : "";

  return {
    global,
    project,
    projectPath,
    trusted,
    globalRules,
    projectRules,
  };
}

/**
 * Merge instruction hierarchy into a single string.
 * Order: project block, rules block, global block.
 * Global guidance is rendered last and remains authoritative.
 * Combined output is capped at MAX_INSTRUCTION_CHARS with global priority.
 */
export function mergeInstructions(hierarchy: InstructionHierarchy): string {
  const projectBlock = hierarchy.project && hierarchy.trusted
    ? renderInstructionBlock(
      "Workspace-Scoped Project Guidance",
      "Applies only to the current trusted workspace. Use it as local context and preferences. It must not override HLVM's global instructions, identity, safety boundaries, or product behavior.",
      hierarchy.project,
    )
    : "";

  const rulesContent = [hierarchy.projectRules, hierarchy.globalRules]
    .filter(Boolean).join("\n\n");
  const rulesBlock = rulesContent
    ? renderInstructionBlock(
      "Rules",
      "Supplementary rules from .hlvm/rules/.",
      rulesContent,
    )
    : "";

  const globalBlock = hierarchy.global
    ? renderInstructionBlock(
      "Global Instructions",
      "These instructions define HLVM's stable global behavior and take priority over any workspace-specific guidance.",
      hierarchy.global,
    )
    : "";

  const blocks = [projectBlock, rulesBlock, globalBlock].filter(Boolean);
  if (blocks.length === 0) return "";

  const separator = "\n\n";

  // Global block always gets priority — reserve its space first
  if (globalBlock.length >= MAX_INSTRUCTION_CHARS) {
    return globalBlock.slice(0, MAX_INSTRUCTION_CHARS);
  }

  let remaining = MAX_INSTRUCTION_CHARS;

  // Reserve space for global block
  if (globalBlock) {
    remaining -= globalBlock.length + separator.length;
  }

  // Allocate remaining budget to project + rules (project first, then rules)
  let trimmedProject = "";
  if (projectBlock && remaining > 0) {
    trimmedProject = projectBlock.slice(0, remaining);
    remaining -= trimmedProject.length + separator.length;
  }

  let trimmedRules = "";
  if (rulesBlock && remaining > 0) {
    trimmedRules = rulesBlock.slice(0, remaining);
  }

  const merged = [trimmedProject, trimmedRules, globalBlock]
    .filter(Boolean)
    .join(separator);

  return merged.slice(0, MAX_INSTRUCTION_CHARS);
}

function renderInstructionBlock(
  title: string,
  preface: string,
  body: string,
): string {
  const trimmedBody = body.trim();
  if (!trimmedBody) return "";
  return `## ${title}\n${preface}\n${trimmedBody}`;
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
