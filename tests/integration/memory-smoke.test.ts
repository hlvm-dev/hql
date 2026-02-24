/**
 * Memory System Live Smoke Test
 *
 * Runs REAL agent queries with an actual Ollama model to verify:
 * 1. Agent calls memory_write when asked to remember something (asserted unconditionally)
 * 2. Memory persists to disk and new session recalls it
 *
 * Hermeticity: dangerous tools (shell, write, edit, git, open) are denied.
 * Only memory tools + read-only tools are available.
 *
 * Requires: Ollama running locally with llama3.1:8b
 * Run: deno test --allow-all tests/integration/memory-smoke.test.ts
 */

import { assert } from "jsr:@std/assert";
import { initializeRuntime } from "../../src/common/runtime-initializer.ts";
import { runAgentQuery } from "../../src/hlvm/agent/agent-runner.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import { resetHlvmDirCacheForTests, getMemoryMdPath, getJournalDir } from "../../src/common/paths.ts";
import { closeMemoryDb, resetMemoryStateForTesting } from "../../src/hlvm/memory/mod.ts";

const MODEL = "ollama/llama3.1:8b";

/** Tools that can modify the real filesystem or execute arbitrary code */
const DANGEROUS_TOOLS = [
  "shell_exec", "shell_script",
  "write_file", "edit_file", "open_path", "archive_files",
  "git_status", "git_diff", "git_log", "git_commit",
  "delegate_agent", "complete_task",
];

async function isOllamaAvailable(): Promise<boolean> {
  try {
    const resp = await fetch("http://localhost:11434/api/tags");
    const data = await resp.json();
    return data.models?.some((m: { name: string }) => m.name.includes("llama3.1:8b"));
  } catch {
    return false;
  }
}

async function setupIsolatedEnv(): Promise<string> {
  const platform = getPlatform();
  const tempDir = await platform.fs.makeTempDir({ prefix: "hlvm-smoke-" });
  platform.env.set("HLVM_DIR", tempDir);
  resetHlvmDirCacheForTests();
  resetMemoryStateForTesting();
  return tempDir;
}

async function teardownIsolatedEnv(tempDir: string): Promise<void> {
  closeMemoryDb();
  getPlatform().env.set("HLVM_DIR", "");
  resetHlvmDirCacheForTests();
  resetMemoryStateForTesting();
  try {
    await getPlatform().fs.remove(tempDir, { recursive: true });
  } catch { /* ignore */ }
}

/** Check if memory content appears in MEMORY.md or any journal file */
async function isMemoryOnDisk(keywords: string[]): Promise<boolean> {
  const platform = getPlatform();

  // Check MEMORY.md
  try {
    const memoryMd = await platform.fs.readTextFile(getMemoryMdPath());
    if (keywords.some((k) => memoryMd.toLowerCase().includes(k.toLowerCase()))) {
      return true;
    }
  } catch { /* file may not exist */ }

  // Check journal files
  try {
    const journalDir = getJournalDir();
    for await (const entry of platform.fs.readDir(journalDir)) {
      if (entry.name.endsWith(".md")) {
        const content = await platform.fs.readTextFile(
          platform.path.join(journalDir, entry.name),
        );
        if (keywords.some((k) => content.toLowerCase().includes(k.toLowerCase()))) {
          return true;
        }
      }
    }
  } catch { /* journal dir may not exist */ }

  return false;
}

let runtimeReady = false;
async function ensureRuntime(): Promise<void> {
  if (runtimeReady) return;
  await initializeRuntime({ stdlib: false, cache: false, context: false });
  runtimeReady = true;
}

Deno.test({
  name: "SMOKE: agent calls memory_write and content appears on disk",
  ignore: !(await isOllamaAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await ensureRuntime();
    const tempDir = await setupIsolatedEnv();
    try {
      const result = await runAgentQuery({
        query: "Remember this: I always prefer tabs over spaces and dark mode for my editor. Save this to your memory now.",
        model: MODEL,
        workspace: tempDir,
        permissionMode: "yolo",
        noInput: true,
        skipSessionHistory: true,
        toolDenylist: DANGEROUS_TOOLS,
        callbacks: {},
      });

      // Unconditional assertions — the whole point of this test
      assert(result.text.length > 0, "Agent should produce a response");
      assert(
        result.stats.toolMessages > 0,
        `Agent MUST call memory_write when explicitly asked to remember. Tool calls: ${result.stats.toolMessages}. Response: ${result.text.slice(0, 200)}`,
      );
      assert(
        await isMemoryOnDisk(["tabs", "dark mode"]),
        "Memory content must appear on disk after memory_write",
      );
    } finally {
      await teardownIsolatedEnv(tempDir);
    }
  },
});

Deno.test({
  name: "SMOKE: new session recalls preferences from pre-populated MEMORY.md",
  ignore: !(await isOllamaAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await ensureRuntime();
    const tempDir = await setupIsolatedEnv();
    try {
      const platform = getPlatform();

      // Pre-populate MEMORY.md (deterministic — doesn't depend on model writing)
      const memoryDir = platform.path.join(tempDir, "memory");
      await platform.fs.mkdir(memoryDir, { recursive: true });
      await platform.fs.writeTextFile(
        platform.path.join(memoryDir, "MEMORY.md"),
        "# User Preferences\n\n- Always use tabs over spaces\n- Prefers dark mode\n- Favorite language: TypeScript\n",
      );

      // New session should load memory and model should reference it
      resetMemoryStateForTesting();
      const result = await runAgentQuery({
        query: "What are my editor preferences? Answer based on what you know about me.",
        model: MODEL,
        workspace: tempDir,
        permissionMode: "yolo",
        noInput: true,
        skipSessionHistory: true,
        toolDenylist: DANGEROUS_TOOLS,
        callbacks: {},
      });

      const response = result.text.toLowerCase();
      const mentionsTabs = response.includes("tab");
      const mentionsDark = response.includes("dark");
      const mentionsTS = response.includes("typescript");

      assert(
        mentionsTabs || mentionsDark || mentionsTS,
        `Agent must recall at least one preference from memory. Got: ${result.text.slice(0, 300)}`,
      );
    } finally {
      await teardownIsolatedEnv(tempDir);
    }
  },
});
