/**
 * Memory prompt builder. Production-only port of CC's memdir/memdir.ts.
 *
 * Skipped (per plan):
 *   - TEAMMEM (team memory directories)
 *   - KAIROS (assistant daily-log mode)
 *   - EXTRACT_MEMORIES (background extraction agent)
 *   - MEMORY_SHAPE_TELEMETRY
 *   - GrowthBook flags (`tengu_*`)
 *
 * Renames:
 *   - CLAUDE.md → HLVM.md
 *   - getClaudeConfigHomeDir → getHlvmDir
 */

import { getPlatform } from "../../platform/platform.ts";
import {
  getAutoMemPath,
  getProjectMemoryPath,
  getUserMemoryPath,
  isAutoMemoryEnabled,
} from "./paths.ts";
import { getHlvmDir } from "../../common/paths.ts";
import {
  MEMORY_FRONTMATTER_EXAMPLE,
  TRUSTING_RECALL_SECTION,
  TYPES_SECTION,
  WHAT_NOT_TO_SAVE_SECTION,
  WHEN_TO_ACCESS_SECTION,
} from "./memoryTypes.ts";

export const ENTRYPOINT_NAME = "MEMORY.md";
export const MAX_ENTRYPOINT_LINES = 200;
// ~125 chars/line at 200 lines. Catches long-line indexes that slip past
// the line cap.
export const MAX_ENTRYPOINT_BYTES = 25_000;
const AUTO_MEM_DISPLAY_NAME = "auto memory";

export type EntrypointTruncation = {
  content: string;
  lineCount: number;
  byteCount: number;
  wasLineTruncated: boolean;
  wasByteTruncated: boolean;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Truncate MEMORY.md content to the line AND byte caps, appending a warning
 * that names which cap fired. Line-truncates first (natural boundary), then
 * byte-truncates at the last newline before the cap so we don't cut mid-line.
 */
export function truncateEntrypointContent(raw: string): EntrypointTruncation {
  const trimmed = raw.trim();
  const contentLines = trimmed.split("\n");
  const lineCount = contentLines.length;
  const byteCount = trimmed.length;

  const wasLineTruncated = lineCount > MAX_ENTRYPOINT_LINES;
  const wasByteTruncated = byteCount > MAX_ENTRYPOINT_BYTES;

  if (!wasLineTruncated && !wasByteTruncated) {
    return {
      content: trimmed,
      lineCount,
      byteCount,
      wasLineTruncated,
      wasByteTruncated,
    };
  }

  let truncated = wasLineTruncated
    ? contentLines.slice(0, MAX_ENTRYPOINT_LINES).join("\n")
    : trimmed;

  if (truncated.length > MAX_ENTRYPOINT_BYTES) {
    const cutAt = truncated.lastIndexOf("\n", MAX_ENTRYPOINT_BYTES);
    truncated = truncated.slice(0, cutAt > 0 ? cutAt : MAX_ENTRYPOINT_BYTES);
  }

  const reason = wasByteTruncated && !wasLineTruncated
    ? `${formatBytes(byteCount)} (limit: ${formatBytes(MAX_ENTRYPOINT_BYTES)}) — index entries are too long`
    : wasLineTruncated && !wasByteTruncated
    ? `${lineCount} lines (limit: ${MAX_ENTRYPOINT_LINES})`
    : `${lineCount} lines and ${formatBytes(byteCount)}`;

  return {
    content: truncated +
      `\n\n> WARNING: ${ENTRYPOINT_NAME} is ${reason}. Only part of it was loaded. Keep index entries to one line under ~200 chars; move detail into topic files.`,
    lineCount,
    byteCount,
    wasLineTruncated,
    wasByteTruncated,
  };
}

const DIR_EXISTS_GUIDANCE =
  "This directory already exists — write to it directly with the write_file tool (do not run mkdir or check for its existence).";

/**
 * Build the body of the auto-memory section: type taxonomy, what NOT to save,
 * how to save (two-step: write topic file + add MEMORY.md pointer), when to
 * access, before-recommending caveats.
 */
function buildMemoryLines(displayName: string, memoryDir: string): string[] {
  const howToSave = [
    "## How to save memories",
    "",
    "Saving a memory is a two-step process:",
    "",
    "**Step 1** — write the memory to its own file (e.g., `user_role.md`, `feedback_testing.md`) using this frontmatter format:",
    "",
    ...MEMORY_FRONTMATTER_EXAMPLE,
    "",
    `**Step 2** — add a pointer to that file in \`${ENTRYPOINT_NAME}\`. \`${ENTRYPOINT_NAME}\` is an index, not a memory — each entry should be one line, under ~150 characters: \`- [Title](file.md) — one-line hook\`. It has no frontmatter. Never write memory content directly into \`${ENTRYPOINT_NAME}\`.`,
    "",
    `- \`${ENTRYPOINT_NAME}\` is always loaded into your conversation context — lines after ${MAX_ENTRYPOINT_LINES} will be truncated, so keep the index concise`,
    "- Keep the name, description, and type fields in memory files up-to-date with the content",
    "- Organize memory semantically by topic, not chronologically",
    "- Update or remove memories that turn out to be wrong or outdated",
    "- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.",
  ];

  return [
    `# ${displayName}`,
    "",
    `You have a persistent, file-based memory system at \`${memoryDir}\`. ${DIR_EXISTS_GUIDANCE}`,
    "",
    "You should build up this memory system over time so that future conversations can have a complete picture of who the user is, how they'd like to collaborate with you, what behaviors to avoid or repeat, and the context behind the work the user gives you.",
    "",
    "If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, find and remove the relevant entry.",
    "",
    ...TYPES_SECTION,
    ...WHAT_NOT_TO_SAVE_SECTION,
    "",
    ...howToSave,
    "",
    ...WHEN_TO_ACCESS_SECTION,
    "",
    ...TRUSTING_RECALL_SECTION,
    "",
    "## Memory and other forms of persistence",
    "Memory is one of several persistence mechanisms available to you as you assist the user in a given conversation. The distinction is often that memory can be recalled in future conversations and should not be used for persisting information that is only useful within the scope of the current conversation.",
    "- When to use or update a plan instead of memory: If you are about to start a non-trivial implementation task and would like to reach alignment with the user on your approach you should use a Plan rather than saving this information to memory. Similarly, if you already have a plan within the conversation and you have changed your approach persist that change by updating the plan rather than saving a memory.",
    "- When to use or update tasks instead of memory: When you need to break your work in current conversation into discrete steps or keep track of your progress use tasks instead of saving to memory. Tasks are great for persisting information about the work that needs to be done in the current conversation, but memory should be reserved for information that will be useful in future conversations.",
    "",
  ];
}

async function readTextFileOrEmpty(path: string): Promise<string> {
  try {
    return await getPlatform().fs.readTextFile(path);
  } catch {
    return "";
  }
}

async function ensureDir(path: string): Promise<void> {
  try {
    await getPlatform().fs.mkdir(path, { recursive: true });
  } catch {
    // Best-effort. If we can't create the dir, the model's first write_file
    // call will surface a clear error.
  }
}

const AT_IMPORT_DEPTH_CAP = 5;

/**
 * Resolve `@./path.md` and `@/abs/path.md` import lines in HLVM.md content.
 *
 * Each `@<target>` line on its own (after stripping leading whitespace) is
 * replaced inline with the imported file's content. Imports may nest up to
 * `AT_IMPORT_DEPTH_CAP` deep; cycles are detected via the `seen` set.
 *
 * Security:
 *   - Only `.md` files are imported (rejects `.sh`, `.js`, etc.)
 *   - The resolved absolute path must live inside one of `allowedRoots`
 *     (typically the importing file's directory tree, plus `~/.hlvm` for
 *     user-level memory). This prevents `@/etc/passwd` or `@../../escape.md`
 *     from reading arbitrary files.
 *
 * Skipped imports are replaced with `<!-- @import skipped: <reason> -->`
 * so the user can debug what didn't load.
 */
function isInsideAllowedRoot(
  absPath: string,
  allowedRoots: readonly string[],
): boolean {
  const platform = getPlatform();
  const norm = platform.path.normalize(absPath);
  for (const root of allowedRoots) {
    const normRoot = platform.path.normalize(root);
    const rootWithSep = normRoot.endsWith(platform.path.sep)
      ? normRoot
      : normRoot + platform.path.sep;
    if (norm === normRoot || norm.startsWith(rootWithSep)) return true;
  }
  return false;
}

async function resolveAtImports(
  text: string,
  basePath: string,
  depth: number,
  seen: Set<string>,
  allowedRoots: readonly string[],
): Promise<string> {
  if (depth >= AT_IMPORT_DEPTH_CAP) {
    return text.replace(
      /^@(.+)$/gm,
      (_m, target) => `<!-- @import skipped: depth cap reached (${target.trim()}) -->`,
    );
  }

  const platform = getPlatform();
  const lines = text.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*@(.+?)\s*$/);
    if (!match || !match[1]) {
      out.push(line);
      continue;
    }
    const rawTarget = match[1].trim();
    if (!rawTarget.endsWith(".md")) {
      out.push(`<!-- @import skipped: non-.md target (${rawTarget}) -->`);
      continue;
    }
    // Resolve target relative to the importing file's directory.
    const baseDir = platform.path.dirname(basePath);
    const absTarget = platform.path.isAbsolute(rawTarget)
      ? rawTarget
      : platform.path.resolve(baseDir, rawTarget);
    // Root validation: target must live inside one of the allowed roots.
    if (!isInsideAllowedRoot(absTarget, allowedRoots)) {
      out.push(
        `<!-- @import skipped: outside allowed roots (${rawTarget}) -->`,
      );
      continue;
    }
    if (seen.has(absTarget)) {
      out.push(`<!-- @import skipped: cycle (${rawTarget}) -->`);
      continue;
    }
    let content: string;
    try {
      content = await platform.fs.readTextFile(absTarget);
    } catch {
      out.push(`<!-- @import skipped: not found (${rawTarget}) -->`);
      continue;
    }
    const nestedSeen = new Set(seen);
    nestedSeen.add(absTarget);
    const resolved = await resolveAtImports(
      content,
      absTarget,
      depth + 1,
      nestedSeen,
      allowedRoots,
    );
    out.push(resolved);
  }
  return out.join("\n");
}

/**
 * Build the auto-memory section with MEMORY.md content embedded.
 */
async function buildAutoMemorySection(memoryDir: string): Promise<string> {
  const lines = buildMemoryLines(AUTO_MEM_DISPLAY_NAME, memoryDir);
  // Compute the entrypoint from the supplied memoryDir directly. Calling
  // getAutoMemEntrypoint() with no arg would re-derive it from process.cwd(),
  // ignoring the cwd we already resolved upstream.
  const entrypoint = getPlatform().path.join(memoryDir, ENTRYPOINT_NAME);
  const raw = await readTextFileOrEmpty(entrypoint);

  if (raw.trim()) {
    const t = truncateEntrypointContent(raw);
    lines.push(`## ${ENTRYPOINT_NAME}`, "", t.content);
  } else {
    lines.push(
      `## ${ENTRYPOINT_NAME}`,
      "",
      `Your ${ENTRYPOINT_NAME} is currently empty. When you save new memories, they will appear here.`,
    );
  }
  return lines.join("\n");
}

/**
 * Read user-level HLVM.md (`~/.hlvm/HLVM.md`) and emit it as a system block
 * with explicit `Source:` / `Scope: global` framing — matches the shape the
 * deleted `loadHlvmInstructionsSystemMessage` used so existing models behave
 * the same.
 */
async function buildUserMemorySection(): Promise<string | null> {
  const path = getUserMemoryPath();
  const raw = await readTextFileOrEmpty(path);
  if (!raw.trim()) return null;
  // User-level imports may reach anywhere inside ~/.hlvm
  const allowedRoots = [getHlvmDir()];
  const expanded = await resolveAtImports(
    raw,
    path,
    0,
    new Set([path]),
    allowedRoots,
  );
  const body = expanded.trim();
  if (!body) return null;
  return [
    "# Global HLVM Instructions",
    `Source: ${path}`,
    "Scope: global. Runtime directories are targets for tools, not instruction sources.",
    "",
    body,
  ].join("\n");
}

/**
 * Read project-level HLVM.md (`./HLVM.md`).
 */
async function buildProjectMemorySection(cwd?: string): Promise<string | null> {
  const platform = getPlatform();
  const path = getProjectMemoryPath(cwd);
  const raw = await readTextFileOrEmpty(path);
  if (!raw.trim()) return null;
  // Project-level imports may reach inside the project workspace AND
  // ~/.hlvm (so a project file can pull in shared user memory if desired).
  const projectRoot = cwd ?? platform.process.cwd();
  const allowedRoots = [projectRoot, getHlvmDir()];
  const expanded = await resolveAtImports(
    raw,
    path,
    0,
    new Set([path]),
    allowedRoots,
  );
  const body = expanded.trim();
  if (!body) return null;
  return [
    "# Project HLVM Instructions",
    `Source: ${path}`,
    "Scope: project. Applies to work in this repository.",
    "",
    body,
  ].join("\n");
}

/**
 * Single SSOT for memory injection. Combines:
 *   1. ~/.hlvm/HLVM.md (user-level)        — replaces deleted global-instructions
 *   2. ./HLVM.md (project-level)
 *   3. ~/.hlvm/projects/<key>/memory/MEMORY.md (auto-memory) + topic-file write rules
 *
 * Returns null when nothing is present and auto-memory is disabled — caller
 * should skip injecting any memory system message in that case.
 */
export async function loadMemoryPrompt(cwd?: string): Promise<string | null> {
  const sections: string[] = [];

  const user = await buildUserMemorySection();
  if (user) sections.push(user);

  const project = await buildProjectMemorySection(cwd);
  if (project) sections.push(project);

  if (isAutoMemoryEnabled()) {
    const autoDir = getAutoMemPath(cwd);
    await ensureDir(autoDir);
    const auto = await buildAutoMemorySection(autoDir);
    sections.push(auto);
  }

  if (sections.length === 0) return null;
  return sections.join("\n\n---\n\n");
}

const MEMORY_SYSTEM_HEADERS = [
  "# Global HLVM Instructions",
  "# Project HLVM Instructions",
  "# auto memory",
] as const;

/**
 * Detect whether a system-message body was produced by `loadMemoryPrompt`.
 * Used during session reuse to drop the stale memory block before injecting
 * a fresh one. Recognizes any of the three sub-section headers — they may
 * appear at start-of-string or after the `---` separator we use to join.
 */
export function isMemorySystemMessage(content: string): boolean {
  return MEMORY_SYSTEM_HEADERS.some((h) => content.startsWith(h));
}

/**
 * Convenience wrapper: return a `{ role: "system", content }` shape ready
 * to push into a context manager, or null if there is no memory to inject.
 */
export async function loadMemorySystemMessage(
  cwd?: string,
): Promise<{ role: "system"; content: string } | null> {
  const text = await loadMemoryPrompt(cwd);
  if (!text) return null;
  return { role: "system", content: text };
}
