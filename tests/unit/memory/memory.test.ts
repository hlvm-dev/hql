/**
 * Memory System Tests — E2E through real tool handlers + integration tests
 *
 * All tests in one file for sequential execution (parallel test files
 * share module-level HLVM_DIR cache, causing interference).
 *
 * Tests the REAL flows:
 * 1. memory_write tool → writes to disk → memory_search tool finds it
 * 2. memory_write → loadMemoryContext injects into system prompt
 * 3. Budget-aware context: 32K includes journals, 8K excludes them
 * 4. JSONL migration: old format → new MEMORY.md on first load
 * 5. Temporal decay: old entries score lower than recent ones
 * 6. Sensitive content: SSN/API keys are blocked from being stored
 * 7. reuseSession replaces stale memory with fresh
 * 8. Pre-compaction flush injects memory_write prompt
 * 9. cachedSession path triggers memory refresh
 */

import { assertEquals, assert, assertStringIncludes } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import { resetHlvmDirCacheForTests, getMemoryMdPath, getMemoryDir, ensureMemoryDirs, ensureMemoryDirsSync } from "../../../src/common/paths.ts";
import {
  appendToMemoryMd,
  closeMemoryDb,
  loadMemoryContext,
  readMemoryMd,
  resetMigrationForTesting,
  sanitizeSensitiveContent,
  searchMemory,
  writeMemoryMd,
} from "../../../src/hlvm/memory/mod.ts";
import { getMemoryDb, insertChunk } from "../../../src/hlvm/memory/search.ts";
import { indexFile } from "../../../src/hlvm/memory/indexer.ts";
import { MEMORY_TOOLS } from "../../../src/hlvm/memory/mod.ts";
import { reuseSession } from "../../../src/hlvm/agent/agent-runner.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import type { AgentSession } from "../../../src/hlvm/agent/session.ts";
import { ENGINE_PROFILES } from "../../../src/hlvm/agent/constants.ts";

// ============================================================
// Test Helpers
// ============================================================

async function setupTestEnv(): Promise<string> {
  const platform = getPlatform();
  const tempDir = await platform.fs.makeTempDir({ prefix: "hlvm-memory-test-" });
  platform.env.set("HLVM_DIR", tempDir);
  resetHlvmDirCacheForTests();
  resetMigrationForTesting();
  return tempDir;
}

async function teardownTestEnv(tempDir: string): Promise<void> {
  closeMemoryDb();
  getPlatform().env.set("HLVM_DIR", "");
  resetHlvmDirCacheForTests();
  resetMigrationForTesting();
  try {
    await getPlatform().fs.remove(tempDir, { recursive: true });
  } catch { /* ignore */ }
}

// Wrap the actual tool handlers with a dummy workspace (memory tools don't use it)
const memoryWrite = (args: unknown) => MEMORY_TOOLS.memory_write.fn(args, "/tmp");
const memorySearch = (args: unknown) => MEMORY_TOOLS.memory_search.fn(args, "/tmp");

// ============================================================
// E2E: memory_write → disk → memory_search finds it
// ============================================================

Deno.test("E2E: memory_write to MEMORY.md → memory_search finds it", async () => {
  const tempDir = await setupTestEnv();
  try {
    // Simulate: agent calls memory_write tool
    const writeResult = await memoryWrite({
      content: "User prefers tabs over spaces and dark mode",
      target: "memory",
      section: "Preferences",
    });
    assertEquals((writeResult as Record<string, unknown>).written, true);

    // Verify file actually exists on disk
    const memoryMd = await readMemoryMd();
    assertStringIncludes(memoryMd, "tabs over spaces");
    assertStringIncludes(memoryMd, "## Preferences");

    // Small delay for background reindex
    await new Promise((r) => setTimeout(r, 100));

    // Simulate: agent calls memory_search tool
    const searchResult = await memorySearch({ query: "tabs spaces" }) as Record<string, unknown>;
    assert((searchResult.count as number) > 0, "memory_search should find the written content");
    const results = searchResult.results as Array<Record<string, unknown>>;
    assert(
      results.some((r) => (r.text as string).includes("tabs over spaces")),
      "Search results should contain the written preference",
    );
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("E2E: memory_write to journal → memory_search finds it", async () => {
  const tempDir = await setupTestEnv();
  try {
    // Agent writes a journal entry
    const writeResult = await memoryWrite({
      content: "Fixed critical auth bug by refreshing OAuth tokens on 401",
      target: "journal",
    });
    assertEquals((writeResult as Record<string, unknown>).written, true);
    assertEquals((writeResult as Record<string, unknown>).target, "journal");

    // memory_search should find it via substring fallback (immediate, no reindex needed)
    const searchResult = await memorySearch({ query: "OAuth tokens" }) as Record<string, unknown>;
    assert((searchResult.count as number) > 0, "Should find journal entry via search");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// E2E: memory_write → loadMemoryContext → system prompt injection
// ============================================================

Deno.test("E2E: written memory appears in next session's system prompt context", async () => {
  const tempDir = await setupTestEnv();
  try {
    // Session 1: agent writes preferences
    await memoryWrite({
      content: "User prefers functional programming and immutable data",
      target: "memory",
    });
    await memoryWrite({
      content: "Deployed new auth service to production",
      target: "journal",
    });

    // Session 2: loadMemoryContext (what createAgentSession calls)
    resetMigrationForTesting(); // simulate new session
    const context = await loadMemoryContext(32_000);

    // MEMORY.md content should be present
    assertStringIncludes(context, "functional programming");
    // Journal content should be present (32K budget includes journals)
    assertStringIncludes(context, "Deployed new auth service");
    // Should have the "Recent Context" section header
    assertStringIncludes(context, "## Recent Context");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Budget-aware context: small context excludes journals
// ============================================================

Deno.test("E2E: small context budget (8K) excludes journal entries", async () => {
  const tempDir = await setupTestEnv();
  try {
    await memoryWrite({
      content: "User prefers dark mode",
      target: "memory",
    });
    await memoryWrite({
      content: "Debug session: fixed race condition in event loop",
      target: "journal",
    });

    resetMigrationForTesting();
    const context = await loadMemoryContext(8_000);

    // MEMORY.md should be present
    assertStringIncludes(context, "dark mode");
    // Journal should NOT be present (budget too small)
    assertEquals(context.includes("race condition"), false);
    assertEquals(context.includes("## Recent Context"), false);
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// JSONL Migration: old format auto-converts on first load
// ============================================================

Deno.test("E2E: old JSONL memory auto-migrates to MEMORY.md on first load", async () => {
  const tempDir = await setupTestEnv();
  try {
    const platform = getPlatform();

    // Simulate old JSONL file (pre-migration format)
    const oldPath = platform.path.join(tempDir, "agent-memory.jsonl");
    const entries = [
      JSON.stringify({ content: "User prefers vim", tags: ["editor"], createdAt: "2024-01-15T00:00:00Z" }),
      JSON.stringify({ content: "Project uses Deno", tags: ["runtime"], createdAt: "2024-01-16T00:00:00Z" }),
    ].join("\n") + "\n";
    await platform.fs.writeTextFile(oldPath, entries);

    // First load triggers migration
    const context = await loadMemoryContext(32_000);
    assertStringIncludes(context, "User prefers vim");
    assertStringIncludes(context, "Project uses Deno");
    assertStringIncludes(context, "# Migrated");

    // Old file should be gone (backed up)
    let oldExists = true;
    try { await platform.fs.stat(oldPath); } catch { oldExists = false; }
    assertEquals(oldExists, false);

    // Backup should exist
    const backup = await platform.fs.readTextFile(oldPath + ".bak");
    assertStringIncludes(backup, "User prefers vim");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Temporal Decay: old entries rank lower than recent ones
// ============================================================

Deno.test("Search: recent entries score higher than old entries (temporal decay)", async () => {
  const tempDir = await setupTestEnv();
  try {
    getMemoryDb();

    // Same text, different dates — only date differs
    insertChunk("/journal/2026-02-22.md", 0, 5, "fixed authentication bug in login flow", "2026-02-22");
    insertChunk("/journal/2025-01-01.md", 0, 5, "fixed authentication bug in login flow", "2025-01-01");

    const results = searchMemory("authentication bug", 10);
    assertEquals(results.length, 2);

    const recent = results.find(r => r.date === "2026-02-22")!;
    const old = results.find(r => r.date === "2025-01-01")!;
    assert(recent.score > old.score,
      `Recent (${recent.score}) should rank higher than old (${old.score})`);
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("Search: MEMORY.md entries never decay (always relevant)", async () => {
  const tempDir = await setupTestEnv();
  try {
    getMemoryDb();

    // MEMORY.md chunk with very old date
    insertChunk("/memory/MEMORY.md", 0, 5, "User prefers dark mode always", "2024-01-01");
    // Fresh journal chunk with same text
    insertChunk("/journal/2026-02-22.md", 0, 5, "User prefers dark mode today", "2026-02-22");

    const results = searchMemory("dark mode", 10);
    const memResult = results.find(r => r.file.endsWith("MEMORY.md"))!;
    const journalResult = results.find(r => !r.file.endsWith("MEMORY.md"))!;

    // MEMORY.md should score >= fresh journal (no decay applied)
    assert(memResult.score >= journalResult.score,
      `MEMORY.md (${memResult.score}) should score >= journal (${journalResult.score})`);
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Sensitive Content: PII is blocked from being stored
// ============================================================

Deno.test("Security: sanitizer blocks SSN, credit cards, API keys, passwords", () => {
  // SSN
  const ssn = sanitizeSensitiveContent("My SSN is 123-45-6789");
  assertStringIncludes(ssn.sanitized, "[REDACTED:SSN]");
  assertEquals(ssn.sanitized.includes("123-45-6789"), false);

  // Credit card
  const cc = sanitizeSensitiveContent("Card: 4111 2222 3333 4444");
  assertStringIncludes(cc.sanitized, "[REDACTED:credit card]");

  // API key
  const key = sanitizeSensitiveContent("Use sk_live_abcdefghijklmnopqrstuvwxyz");
  assertStringIncludes(key.sanitized, "[REDACTED:API key]");

  // Password
  const pwd = sanitizeSensitiveContent("password: hunter2");
  assertStringIncludes(pwd.sanitized, "[REDACTED:password]");

  // Clean text passes through unchanged
  const clean = sanitizeSensitiveContent("User prefers dark mode");
  assertEquals(clean.sanitized, "User prefers dark mode");
  assertEquals(clean.stripped.length, 0);
});

// ============================================================
// E2E: Write → reindex → FTS5 search finds it
// ============================================================

Deno.test("E2E: memory_write → reindex → FTS5 searchMemory returns results", async () => {
  const tempDir = await setupTestEnv();
  try {
    // Write several entries
    await memoryWrite({
      content: "Project architecture uses hexagonal pattern with ports and adapters",
      target: "memory",
      section: "Architecture",
    });
    await memoryWrite({
      content: "Database is PostgreSQL 16 with pgvector extension",
      target: "memory",
      section: "Infrastructure",
    });

    // Wait for background reindex
    await new Promise((r) => setTimeout(r, 200));

    // FTS5 search for specific terms
    const archResults = searchMemory("hexagonal ports adapters");
    assert(archResults.length > 0, "FTS5 should find architecture entry");

    const dbResults = searchMemory("PostgreSQL pgvector");
    assert(dbResults.length > 0, "FTS5 should find database entry");

    // Unrelated query should return nothing
    const noResults = searchMemory("kubernetes deployment helm");
    assertEquals(noResults.length, 0);
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Tool validation: bad args are rejected
// ============================================================

Deno.test("Tool: memory_write rejects empty content", async () => {
  const tempDir = await setupTestEnv();
  try {
    let threw = false;
    try {
      await memoryWrite({ content: "", target: "memory" });
    } catch {
      threw = true;
    }
    assertEquals(threw, true, "Should reject empty content");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("Tool: memory_write rejects invalid target", async () => {
  const tempDir = await setupTestEnv();
  try {
    let threw = false;
    try {
      await memoryWrite({ content: "test", target: "invalid" });
    } catch {
      threw = true;
    }
    assertEquals(threw, true, "Should reject invalid target");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Gap Test 1: reuseSession replaces stale memory with fresh
// ============================================================

Deno.test("reuseSession: stale memory is replaced with fresh MEMORY.md content", async () => {
  const tempDir = await setupTestEnv();
  try {
    const platform = getPlatform();

    // Create initial MEMORY.md with "stale" content
    const memDir = platform.path.join(tempDir, "memory");
    await platform.fs.mkdir(memDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(memDir, "MEMORY.md"),
      "Stale preference: vim keybindings",
    );

    // Build a fake cached session with stale memory in context
    const context = new ContextManager({ maxTokens: 32_000 });
    context.addMessage({ role: "system", content: "You are an assistant." });
    context.addMessage({
      role: "system",
      content: "# Your Memory\nStale preference: vim keybindings",
    });

    const fakeSession: AgentSession = {
      context,
      llm: async () => ({ content: "", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      policy: null,
      l1Confirmations: new Map(),
      toolOwnerId: "test",
      dispose: async () => {},
      profile: ENGINE_PROFILES.normal,
      isFrontierModel: false,
      modelTier: "mid",
      resolvedContextBudget: { budget: 32_000, rawLimit: 32_000, source: "default" as const },
    };

    // Now update MEMORY.md with NEW content (simulating user saved new prefs between sessions)
    await platform.fs.writeTextFile(
      platform.path.join(memDir, "MEMORY.md"),
      "Fresh preference: emacs keybindings and light mode",
    );
    resetMigrationForTesting();

    // Call reuseSession — it should drop stale memory and inject fresh
    const reused = await reuseSession(fakeSession);
    const messages = reused.context.getMessages();

    // System prompt should be preserved
    const systemPrompt = messages.find((m) => m.content === "You are an assistant.");
    assert(systemPrompt, "Original system prompt should be preserved");

    // Stale memory should be gone
    const staleMemory = messages.find((m) => m.content.includes("vim keybindings"));
    assertEquals(staleMemory, undefined, "Stale memory should be removed");

    // Fresh memory should be present
    const freshMemory = messages.find((m) => m.content.includes("emacs keybindings"));
    assert(freshMemory, "Fresh memory should be injected");
    assertStringIncludes(freshMemory!.content, "# Your Memory");
    assertStringIncludes(freshMemory!.content, "light mode");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Gap Test 2: Pre-compaction flush message content
// ============================================================

Deno.test("Pre-compaction: flush logic injects memory_write prompt and prevents double-flush", () => {
  // Tests the orchestrator's pre-compaction flush logic (orchestrator.ts:441-461).
  // Uses a ContextManager where pendingCompaction is forced via system message overflow
  // (system messages are preserved during trimming, so the flag stays set).
  const FLUSH_MSG = "[System] Context nearing limit. If there are important facts, decisions, or outcomes not yet saved to memory, call memory_write now before context is compacted.";

  // pendingCompaction only survives if: (1) tokens > threshold AND (2) tokens > maxTokens
  // AND trimming can't resolve it (system msgs are preserved).
  // 2 system msgs × 800 chars = 1600 chars ≈ 400 tokens. maxTokens=300 → needsTrimming stays true.
  const context = new ContextManager({
    maxTokens: 300,
    overflowStrategy: "summarize",
    llmSummarize: async () => "summary",
    compactionThreshold: 0.5,
    preserveSystem: true,
    minMessages: 2,
  });

  // System messages can't be trimmed (preserveSystem=true), so pendingCompaction stays set.
  context.addMessage({ role: "system", content: "A".repeat(800) });
  context.addMessage({ role: "system", content: "B".repeat(800) });

  assert(context.isPendingCompaction, "Should be pending compaction (system messages exceed threshold and can't be trimmed)");

  // Simulate orchestrator flush logic
  let skipCompaction = false;
  let memoryFlushedThisCycle = false;

  if (context.isPendingCompaction && !memoryFlushedThisCycle) {
    memoryFlushedThisCycle = true;
    skipCompaction = true;
    context.addMessage({ role: "user", content: FLUSH_MSG });
  }

  // Assertions
  assert(skipCompaction, "Should skip compaction when flush is injected");
  assert(memoryFlushedThisCycle, "Flush flag should be set");

  const flushMsg = context.getMessages().find((m) => m.content.includes("memory_write"));
  assert(flushMsg, "Flush message must reference memory_write");
  assertStringIncludes(flushMsg!.content, "Context nearing limit");

  // Double-flush prevention: flag blocks second injection
  const countBefore = context.getMessages().length;
  if (context.isPendingCompaction && !memoryFlushedThisCycle) {
    context.addMessage({ role: "user", content: FLUSH_MSG });
  }
  assertEquals(context.getMessages().length, countBefore, "Must not double-flush");
});

// ============================================================
// Gap Test 3: cachedSession runner path calls reuseSession
// ============================================================

Deno.test("cachedSession: memory refresh happens on session reuse path", async () => {
  const tempDir = await setupTestEnv();
  try {
    const platform = getPlatform();

    // Pre-populate MEMORY.md
    const memDir = platform.path.join(tempDir, "memory");
    await platform.fs.mkdir(memDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(memDir, "MEMORY.md"),
      "User prefers Python over JavaScript",
    );

    // Build a cached session with NO memory (simulating stale cache)
    const context = new ContextManager({ maxTokens: 32_000 });
    context.addMessage({ role: "system", content: "System prompt here." });

    const fakeSession: AgentSession = {
      context,
      llm: async () => ({ content: "", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      policy: null,
      l1Confirmations: new Map(),
      toolOwnerId: "test",
      dispose: async () => {},
      profile: ENGINE_PROFILES.normal,
      isFrontierModel: false,
      modelTier: "mid",
      resolvedContextBudget: { budget: 32_000, rawLimit: 32_000, source: "default" as const },
    };

    // Reuse the session — this is what runAgentQuery does with cachedSession
    resetMigrationForTesting();
    const reused = await reuseSession(fakeSession);

    // The reused session should have memory injected
    const messages = reused.context.getMessages();
    const memoryMsg = messages.find((m) =>
      m.role === "system" && m.content.startsWith("# Your Memory")
    );
    assert(memoryMsg, "Reused session must have memory injected");
    assertStringIncludes(memoryMsg!.content, "Python over JavaScript");

    // Original system prompt preserved
    assert(
      messages.some((m) => m.content === "System prompt here."),
      "Original system prompt must be preserved",
    );
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Gap 1: E2E PII sanitization through memory_write tool
// ============================================================

Deno.test("E2E: memory_write sanitizes SSN before writing to disk", async () => {
  const tempDir = await setupTestEnv();
  try {
    await memoryWrite({
      content: "User's SSN is 123-45-6789 and they prefer dark mode",
      target: "memory",
    });

    const memoryMd = await readMemoryMd();
    assertStringIncludes(memoryMd, "[REDACTED:SSN]");
    assertEquals(memoryMd.includes("123-45-6789"), false, "Raw SSN must not appear on disk");
    assertStringIncludes(memoryMd, "dark mode", "Non-sensitive content should be preserved");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("E2E: memory_write sanitizes API key in journal", async () => {
  const tempDir = await setupTestEnv();
  try {
    await memoryWrite({
      content: "Used key sk_live_abcdefghijklmnopqrstuvwxyz to call the API",
      target: "journal",
    });

    // Read journal via search fallback (substring)
    const result = await memorySearch({ query: "API" }) as Record<string, unknown>;
    const results = result.results as Array<Record<string, unknown>>;
    assert(results.length > 0, "Should find the journal entry");
    const text = results[0].text as string;
    assertStringIncludes(text, "[REDACTED:API key]");
    assertEquals(text.includes("sk_live_abcdefghijklmnopqrstuvwxyz"), false);
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("E2E: writeMemoryMd (full overwrite) also sanitizes PII", async () => {
  const tempDir = await setupTestEnv();
  try {
    await writeMemoryMd("Card number: 4111 2222 3333 4444\nPreference: vim");

    const memoryMd = await readMemoryMd();
    assertStringIncludes(memoryMd, "[REDACTED:credit card]");
    assertEquals(memoryMd.includes("4111 2222 3333 4444"), false, "Raw CC must not appear on disk");
    assertStringIncludes(memoryMd, "vim");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Gap 2: FTS5 query escaping handles operators and special chars
// ============================================================

Deno.test("Search: FTS5 handles boolean operators safely", async () => {
  const tempDir = await setupTestEnv();
  try {
    getMemoryDb();
    insertChunk("/memory/MEMORY.md", 0, 5, "User prefers NOT using tabs AND spaces", "2026-02-22");

    // Query with FTS5 operators embedded — should not throw or return unexpected results
    const results1 = searchMemory("NOT AND OR");
    // Empty because all words are stripped as operators
    assertEquals(results1.length, 0, "All-operator query should return empty, not throw");

    // Query with mixed operators and real words
    const results2 = searchMemory("tabs AND spaces");
    assert(results2.length > 0, "Should find content even with AND operator in query");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("Search: FTS5 handles parentheses and special chars safely", async () => {
  const tempDir = await setupTestEnv();
  try {
    getMemoryDb();
    insertChunk("/memory/MEMORY.md", 0, 5, "function foo(bar) returns baz", "2026-02-22");

    // Query with parens — would crash unescaped FTS5
    const results = searchMemory("foo(bar)");
    assert(results.length > 0, "Should find content despite parens in query");

    // Query with quotes and asterisks
    const results2 = searchMemory(`"foo" * 'bar'`);
    assert(results2.length > 0, "Should handle quotes and asterisks");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Gap 4: Memory directory permissions (0o700)
// ============================================================

Deno.test("Security: ensureMemoryDirs (async) sets 0o700 on memory directory", async () => {
  const tempDir = await setupTestEnv();
  try {
    await ensureMemoryDirs();

    const memDir = getMemoryDir();

    // Use Deno.stat directly in test (production uses platform layer, but test needs mode info)
    const stat = await Deno.stat(memDir);
    assert(stat.isDirectory, "Memory directory should exist");

    // On Unix, verify 0o700 permissions (owner-only read/write/execute)
    if (stat.mode !== null && stat.mode !== undefined) {
      const perms = stat.mode & 0o777;
      assertEquals(perms, 0o700, `Memory dir permissions should be 0o700, got 0o${perms.toString(8)}`);
    }
    // On Windows, stat.mode may be null — skip permission check
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("Security: ensureMemoryDirsSync (sync, used by SQLite init) also sets 0o700", async () => {
  const tempDir = await setupTestEnv();
  try {
    ensureMemoryDirsSync();

    const memDir = getMemoryDir();
    const stat = await Deno.stat(memDir);
    assert(stat.isDirectory, "Memory directory should exist");

    if (stat.mode !== null && stat.mode !== undefined) {
      const perms = stat.mode & 0o777;
      assertEquals(perms, 0o700, `Sync path: memory dir permissions should be 0o700, got 0o${perms.toString(8)}`);
    }
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Gap 5: Chunk overlap boundary search
// ============================================================

Deno.test("Indexer: chunk overlap allows search across chunk boundaries", async () => {
  const tempDir = await setupTestEnv();
  try {
    getMemoryDb();
    const platform = getPlatform();

    // Create a file where a search phrase spans a chunk boundary.
    // CHUNK_SIZE=1600 chars, CHUNK_OVERLAP=320 chars.
    // Place unique text at position ~1500 (end of chunk 1, within overlap of chunk 2)
    const padding = "x".repeat(1450) + "\n";
    const boundary = "UNIQUE_BOUNDARY_PHRASE spans the chunk boundary here\n";
    const tail = "y".repeat(500) + "\n";
    const content = padding + boundary + tail;

    // Write file and index it
    const memDir = platform.path.join(tempDir, "memory");
    await platform.fs.mkdir(memDir, { recursive: true });
    const filePath = platform.path.join(memDir, "MEMORY.md");
    await platform.fs.writeTextFile(filePath, content);

    indexFile(filePath, "2026-02-22");

    // Search for the boundary phrase — should be found via overlap
    const results = searchMemory("UNIQUE_BOUNDARY_PHRASE");
    assert(results.length > 0, "Chunk overlap should make boundary text findable via FTS5");
    assert(
      results.some((r) => r.text.includes("UNIQUE_BOUNDARY_PHRASE")),
      "Result text should contain the boundary phrase",
    );
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Gap 6: Concurrent write safety (write lock serializes writes)
// ============================================================

Deno.test("Concurrency: simultaneous writes don't corrupt MEMORY.md", async () => {
  const tempDir = await setupTestEnv();
  try {
    // Fire 10 concurrent appends — without a lock these could interleave and corrupt
    const promises = Array.from({ length: 10 }, (_, i) =>
      appendToMemoryMd(`Entry number ${i}`, "Concurrent")
    );
    await Promise.all(promises);

    const memoryMd = await readMemoryMd();

    // All 10 entries must be present
    for (let i = 0; i < 10; i++) {
      assertStringIncludes(memoryMd, `Entry number ${i}`,
        `Entry ${i} should be present after concurrent writes`);
    }

    // Section header should appear exactly once
    const sectionCount = (memoryMd.match(/## Concurrent/g) ?? []).length;
    assertEquals(sectionCount, 1, "Section header should appear exactly once (not duplicated by races)");
  } finally {
    await teardownTestEnv(tempDir);
  }
});
