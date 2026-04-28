/**
 * Memory recall selector. Per-turn LLM call that picks ~5 relevant memory
 * files for a user query. Returns up to 5 memory file paths + mtime so
 * callers can prepend freshness notes without a second stat.
 */

import { classifyJson } from "../runtime/local-llm.ts";
import { getPlatform } from "../../platform/platform.ts";
import {
  formatMemoryManifest,
  type MemoryHeader,
  scanMemoryFiles,
} from "./memoryScan.ts";

export type RelevantMemory = {
  path: string;
  mtimeMs: number;
};

const MAX_SELECTED = 5;

const SELECT_MEMORIES_PROMPT_HEADER =
  `You are selecting memories that will be useful for the agent processing the user's query.
You will be given the user's query and a list of available memory files with their filenames and descriptions.

Reply ONLY with a JSON object in this exact shape:
{"selected":["filename1.md","filename2.md"]}

Rules:
- Up to ${MAX_SELECTED} filenames. Prefer fewer than more.
- Only include memories that you are CERTAIN will be helpful based on filename and description.
- If a recently-used tool list is provided, do NOT select memories that are usage reference or API docs for those tools (the agent is already exercising them). DO still select memories containing warnings, gotchas, or known issues about those tools.
- If unsure, leave the list empty.
`;

/**
 * Find memory files relevant to a query. Excludes MEMORY.md (already loaded
 * in the system prompt). `alreadySurfaced` filters paths shown in earlier
 * turns so the selector spends its slot budget on fresh candidates.
 */
export async function findRelevantMemories(
  query: string,
  memoryDir: string,
  signal: AbortSignal,
  recentTools: readonly string[] = [],
  alreadySurfaced: ReadonlySet<string> = new Set(),
): Promise<RelevantMemory[]> {
  const memories = (await scanMemoryFiles(memoryDir, signal)).filter(
    (m) => !alreadySurfaced.has(m.filePath),
  );
  if (memories.length === 0) return [];

  const selectedFilenames = await selectRelevantMemories(
    query,
    memories,
    signal,
    recentTools,
  );
  if (selectedFilenames.length === 0) return [];

  const byFilename = new Map(memories.map((m) => [m.filename, m]));
  const selected = selectedFilenames
    .map((filename) => byFilename.get(filename))
    .filter((m): m is MemoryHeader => m !== undefined)
    .slice(0, MAX_SELECTED);

  return selected.map((m) => ({ path: m.filePath, mtimeMs: m.mtimeMs }));
}

async function selectRelevantMemories(
  query: string,
  memories: MemoryHeader[],
  signal: AbortSignal,
  recentTools: readonly string[],
): Promise<string[]> {
  if (signal.aborted) return [];

  const stubPath = getStubPath();
  if (stubPath) return await readStubSelection(stubPath);

  const validFilenames = new Set(memories.map((m) => m.filename));
  const manifest = formatMemoryManifest(memories);
  const toolsSection = recentTools.length > 0
    ? `\n\nRecently used tools: ${recentTools.join(", ")}`
    : "";

  const userBlock =
    `Query: ${query}\n\nAvailable memories:\n${manifest}${toolsSection}`;

  const parsed = await classifyJson(
    "findRelevantMemories",
    SELECT_MEMORIES_PROMPT_HEADER + "\n" + userBlock,
    { temperature: 0, maxTokens: 256 },
  );
  const raw = parsed?.selected;
  if (!Array.isArray(raw)) return [];

  const picked: string[] = [];
  for (const v of raw) {
    if (typeof v === "string" && validFilenames.has(v)) {
      picked.push(v);
      if (picked.length >= MAX_SELECTED) break;
    }
  }
  return picked;
}

// HLVM_MEMORY_SELECTOR_STUB=<json-file-path> — E2E determinism only.
function getStubPath(): string | null {
  try {
    const env = getPlatform().env.get("HLVM_MEMORY_SELECTOR_STUB");
    return env && env.length > 0 ? env : null;
  } catch {
    return null;
  }
}

async function readStubSelection(path: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await getPlatform().fs.readTextFile(path));
    const raw = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === "object" && Array.isArray(parsed.selected)
        ? parsed.selected
        : []);
    return raw.filter((v: unknown): v is string => typeof v === "string");
  } catch {
    return [];
  }
}
