/**
 * Memory-directory scanning. Recursive walk + frontmatter extraction.
 */

import { getPlatform } from "../../platform/platform.ts";
import { parseFrontmatter } from "../../common/frontmatter.ts";
import { type MemoryType, parseMemoryType } from "./memoryTypes.ts";

export type MemoryHeader = {
  /** Path relative to memoryDir, e.g. "feedback_tabs.md" or "topics/auth.md" */
  filename: string;
  /** Absolute path to the file */
  filePath: string;
  /** mtime in milliseconds since epoch */
  mtimeMs: number;
  /** First-line description from frontmatter, or null if absent */
  description: string | null;
  /** Memory type from frontmatter, or undefined if absent/invalid */
  type: MemoryType | undefined;
};

const MAX_MEMORY_FILES = 200;
const FRONTMATTER_MAX_BYTES = 4096; // ~30 lines worth, generous

/**
 * Recursively list all .md files under `dir`, returning paths relative to
 * `dir`. Skips MEMORY.md (the entrypoint, loaded separately).
 */
async function listMemoryMdFiles(
  dir: string,
  signal: AbortSignal,
): Promise<string[]> {
  const platform = getPlatform();
  const out: string[] = [];

  async function walk(current: string, prefix: string): Promise<void> {
    if (signal.aborted) return;
    let entries: AsyncIterable<{
      name: string;
      isFile: boolean;
      isDirectory: boolean;
      isSymlink: boolean;
    }>;
    try {
      entries = platform.fs.readDir(current);
    } catch {
      return;
    }
    for await (const entry of entries) {
      if (signal.aborted) return;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await walk(platform.path.join(current, entry.name), rel);
        continue;
      }
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".md")) continue;
      if (entry.name === "MEMORY.md") continue;
      out.push(rel);
    }
  }

  await walk(dir, "");
  return out;
}

/**
 * Read just enough of a file to extract frontmatter + capture mtime.
 * For memory files (small markdowns), reading the full file is fine — the
 * cost is bounded by MAX_MEMORY_FILES. We don't need byte-range reads.
 */
async function readFrontmatterHeader(
  filePath: string,
  signal: AbortSignal,
): Promise<{ description: string | null; type: MemoryType | undefined; mtimeMs: number } | null> {
  if (signal.aborted) return null;
  const platform = getPlatform();
  let info;
  try {
    info = await platform.fs.stat(filePath);
  } catch {
    return null;
  }
  let content: string;
  try {
    // Read the whole file but cap memory: small markdowns are fine,
    // huge ones we slice the first 4KB of after read (frontmatter only
    // needs the head).
    content = await platform.fs.readTextFile(filePath);
    if (content.length > FRONTMATTER_MAX_BYTES) {
      content = content.slice(0, FRONTMATTER_MAX_BYTES);
    }
  } catch {
    return null;
  }
  const { meta } = parseFrontmatter<Record<string, unknown>>(content);
  const description = typeof meta?.description === "string"
    ? meta.description.trim() || null
    : null;
  const type = parseMemoryType(meta?.type);
  return { description, type, mtimeMs: info.mtimeMs ?? 0 };
}

/**
 * Scan a memory directory for .md files, read their frontmatter, and return
 * a header list sorted newest-first (capped at MAX_MEMORY_FILES). Used by
 * findRelevantMemories at recall time.
 */
export async function scanMemoryFiles(
  memoryDir: string,
  signal: AbortSignal,
): Promise<MemoryHeader[]> {
  const platform = getPlatform();

  let mdFiles: string[];
  try {
    mdFiles = await listMemoryMdFiles(memoryDir, signal);
  } catch {
    return [];
  }
  if (mdFiles.length === 0) return [];

  const headerResults = await Promise.allSettled(
    mdFiles.map(async (relativePath): Promise<MemoryHeader | null> => {
      const filePath = platform.path.join(memoryDir, relativePath);
      const header = await readFrontmatterHeader(filePath, signal);
      if (!header) return null;
      return {
        filename: relativePath,
        filePath,
        mtimeMs: header.mtimeMs,
        description: header.description,
        type: header.type,
      };
    }),
  );

  return headerResults
    .filter(
      (r): r is PromiseFulfilledResult<MemoryHeader | null> =>
        r.status === "fulfilled" && r.value !== null,
    )
    .map((r) => r.value as MemoryHeader)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_MEMORY_FILES);
}

/**
 * Format memory headers as a text manifest: one line per file with
 * [type] filename (timestamp): description. Used by the recall selector
 * prompt.
 */
export function formatMemoryManifest(memories: MemoryHeader[]): string {
  return memories
    .map((m) => {
      const tag = m.type ? `[${m.type}] ` : "";
      const ts = new Date(m.mtimeMs).toISOString();
      return m.description
        ? `- ${tag}${m.filename} (${ts}): ${m.description}`
        : `- ${tag}${m.filename} (${ts})`;
    })
    .join("\n");
}
