/**
 * Memory System Live Smoke Test
 *
 * Runs REAL agent queries with an actual Ollama model to verify:
 * 1. Agent calls memory_write when asked to remember something (asserted unconditionally)
 * 2. Memory persists to DB and new session recalls it
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
import { resetHlvmDirCacheForTests } from "../../src/common/paths.ts";
import { closeFactDb, getValidFacts, insertFact } from "../../src/hlvm/memory/mod.ts";

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
  return tempDir;
}

async function teardownIsolatedEnv(tempDir: string): Promise<void> {
  closeFactDb();
  getPlatform().env.delete("HLVM_DIR");
  resetHlvmDirCacheForTests();
  try {
    await getPlatform().fs.remove(tempDir, { recursive: true });
  } catch { /* ignore */ }
}

let runtimeReady = false;
async function ensureRuntime(): Promise<void> {
  if (runtimeReady) return;
  await initializeRuntime({ stdlib: false, cache: false, context: false });
  runtimeReady = true;
}

Deno.test({
  name: "SMOKE: agent calls memory_write and content persists in DB",
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

      // V2: verify fact is in canonical DB
      const facts = getValidFacts();
      const hasMemoryContent = facts.some((f) =>
        f.content.toLowerCase().includes("tab") ||
        f.content.toLowerCase().includes("dark mode")
      );
      assert(hasMemoryContent, "Memory content must be stored in canonical facts DB");
    } finally {
      await teardownIsolatedEnv(tempDir);
    }
  },
});

Deno.test({
  name: "SMOKE: new session recalls preferences from pre-populated DB",
  ignore: !(await isOllamaAvailable()),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await ensureRuntime();
    const tempDir = await setupIsolatedEnv();
    try {
      // V2: pre-populate canonical DB directly
      insertFact({ content: "Always use tabs over spaces", category: "User Preferences" });
      insertFact({ content: "Prefers dark mode", category: "User Preferences" });
      insertFact({ content: "Favorite language: TypeScript", category: "User Preferences" });

      // New session should load memory from DB and model should reference it
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
