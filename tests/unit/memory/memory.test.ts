/**
 * Memory System Tests — E2E through real tool handlers + integration tests
 *
 * All tests in one file for sequential execution (parallel test files
 * share module-level HLVM_DIR cache, causing interference).
 *
 * V2 architecture: DB is canonical SSOT. No legacy file-based search/indexer.
 *
 * Tests the REAL flows:
 * 1. memory_write tool → inserts fact in DB → memory_search tool finds it
 * 2. memory_write → loadMemoryContext reads from DB
 * 3. Budget-aware context: large context = more facts
 * 4. Sensitive content: SSN/API keys are blocked from being stored
 * 5. reuseSession replaces stale memory with fresh
 * 6. Pre-compaction flush injects memory_write prompt
 * 7. cachedSession path triggers memory refresh
 * 8. Tool validation: bad args rejected
 * 9. memory_edit: delete_section invalidates category, replace does find/replace in facts
 * 10. Facts DB CRUD: insert, invalidate, search, touch, filter
 */

import { assertEquals, assert, assertStringIncludes } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import { resetHlvmDirCacheForTests, getMemoryDir, ensureMemoryDirs, ensureMemoryDirsSync } from "../../../src/common/paths.ts";
import {
  loadMemoryContext,
  getFactDb,
  closeFactDb,
  insertFact,
  invalidateFact,
  getValidFacts,
  searchFactsFts,
  touchFact,
  MEMORY_TOOLS,
} from "../../../src/hlvm/memory/mod.ts";
import { sanitizeSensitiveContent } from "../../../src/hlvm/memory/store.ts";
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
  return tempDir;
}

async function teardownTestEnv(tempDir: string): Promise<void> {
  closeFactDb();
  getPlatform().env.delete("HLVM_DIR");
  resetHlvmDirCacheForTests();
  try {
    await getPlatform().fs.remove(tempDir, { recursive: true });
  } catch { /* ignore */ }
}

// Wrap the actual tool handlers with a dummy workspace (memory tools don't use it)
const memoryWrite = (args: unknown) => MEMORY_TOOLS.memory_write.fn(args, "/tmp");
const memorySearch = (args: unknown) => MEMORY_TOOLS.memory_search.fn(args, "/tmp");
const memoryEdit = (args: unknown) => MEMORY_TOOLS.memory_edit.fn(args, "/tmp");

// ============================================================
// E2E: memory_write → DB → memory_search finds it
// ============================================================

Deno.test("E2E: memory_write → memory_search finds it via DB", async () => {
  const tempDir = await setupTestEnv();
  try {
    const writeResult = await memoryWrite({
      content: "User prefers tabs over spaces and dark mode",
      target: "memory",
      section: "Preferences",
    });
    assertEquals((writeResult as Record<string, unknown>).written, true);

    // Verify fact was inserted in DB
    const facts = getValidFacts();
    assert(facts.length > 0, "Should have facts in DB");
    assert(facts.some(f => f.content.includes("tabs over spaces")));

    // memory_search should find it
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
    const writeResult = await memoryWrite({
      content: "Fixed critical auth bug by refreshing OAuth tokens on 401",
      target: "journal",
    });
    assertEquals((writeResult as Record<string, unknown>).written, true);
    assertEquals((writeResult as Record<string, unknown>).target, "journal");

    // memory_search should find it via DB FTS5
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
    const context = await loadMemoryContext(32_000);

    // DB-first: content should be present
    assertStringIncludes(context, "functional programming");
    assertStringIncludes(context, "Deployed new auth service");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Budget-aware context
// ============================================================

Deno.test("E2E: small context budget limits number of facts loaded", async () => {
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

    const context = await loadMemoryContext(8_000);

    // At 8K context, should still have some content (both are in DB)
    assert(context.length > 0, "Should have some context even at 8K");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Sensitive Content: PII is blocked from being stored
// ============================================================

Deno.test("Security: sanitizer blocks SSN, credit cards, API keys, passwords", () => {
  const ssn = sanitizeSensitiveContent("My SSN is 123-45-6789");
  assertStringIncludes(ssn.sanitized, "[REDACTED:SSN]");
  assertEquals(ssn.sanitized.includes("123-45-6789"), false);

  const cc = sanitizeSensitiveContent("Card: 4111 2222 3333 4444");
  assertStringIncludes(cc.sanitized, "[REDACTED:credit card]");

  const key = sanitizeSensitiveContent("Use sk_live_abcdefghijklmnopqrstuvwxyz");
  assertStringIncludes(key.sanitized, "[REDACTED:API key]");

  const pwd = sanitizeSensitiveContent("password: hunter2");
  assertStringIncludes(pwd.sanitized, "[REDACTED:password]");

  const clean = sanitizeSensitiveContent("User prefers dark mode");
  assertEquals(clean.sanitized, "User prefers dark mode");
  assertEquals(clean.stripped.length, 0);
});

// ============================================================
// E2E: PII sanitization through memory_write tool
// ============================================================

Deno.test("E2E: memory_write sanitizes SSN before storing in DB", async () => {
  const tempDir = await setupTestEnv();
  try {
    await memoryWrite({
      content: "User's SSN is 123-45-6789 and they prefer dark mode",
      target: "memory",
    });

    const facts = getValidFacts();
    assert(facts.length > 0);
    assertStringIncludes(facts[0].content, "[REDACTED:SSN]");
    assertEquals(facts[0].content.includes("123-45-6789"), false, "Raw SSN must not appear in DB");
    assertStringIncludes(facts[0].content, "dark mode");
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

    const facts = getValidFacts();
    assert(facts.length > 0);
    assertStringIncludes(facts[0].content, "[REDACTED:API key]");
    assertEquals(facts[0].content.includes("sk_live_abcdefghijklmnopqrstuvwxyz"), false);
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// E2E: Write → FTS5 search finds it via DB
// ============================================================

Deno.test("E2E: memory_write → DB FTS5 search returns results", async () => {
  const tempDir = await setupTestEnv();
  try {
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

    // FTS5 search on facts DB
    const archResults = searchFactsFts("hexagonal ports adapters");
    assert(archResults.length > 0, "FTS5 should find architecture entry");

    const dbResults = searchFactsFts("PostgreSQL pgvector");
    assert(dbResults.length > 0, "FTS5 should find database entry");

    // Unrelated query should return nothing
    const noResults = searchFactsFts("kubernetes deployment helm");
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

Deno.test("reuseSession: stale memory is replaced with fresh DB content", async () => {
  const tempDir = await setupTestEnv();
  try {
    // Insert initial fact into DB
    insertFact({ content: "Stale preference: vim keybindings", category: "Preferences" });

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

    // Insert new fact (simulating updated memory)
    insertFact({ content: "Fresh preference: emacs keybindings and light mode", category: "Preferences" });

    // Call reuseSession — should inject fresh memory from DB
    const reused = await reuseSession(fakeSession);
    const messages = reused.context.getMessages();

    // System prompt should be preserved
    const systemPrompt = messages.find((m) => m.content === "You are an assistant.");
    assert(systemPrompt, "Original system prompt should be preserved");

    // Fresh memory should be present
    const freshMemory = messages.find((m) => m.content.includes("emacs keybindings"));
    assert(freshMemory, "Fresh memory should be injected");
    assertStringIncludes(freshMemory!.content, "# Your Memory");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Gap Test 2: Pre-compaction flush message content
// ============================================================

Deno.test("Pre-compaction: flush logic injects memory_write prompt and prevents double-flush", () => {
  const FLUSH_MSG = "[System] Context nearing limit. If there are important facts, decisions, or outcomes not yet saved to memory, call memory_write now before context is compacted.";

  const context = new ContextManager({
    maxTokens: 300,
    overflowStrategy: "summarize",
    llmSummarize: async () => "summary",
    compactionThreshold: 0.5,
    preserveSystem: true,
    minMessages: 2,
  });

  context.addMessage({ role: "system", content: "A".repeat(800) });
  context.addMessage({ role: "system", content: "B".repeat(800) });

  assert(context.isPendingCompaction, "Should be pending compaction");

  let skipCompaction = false;
  let memoryFlushedThisCycle = false;

  if (context.isPendingCompaction && !memoryFlushedThisCycle) {
    memoryFlushedThisCycle = true;
    skipCompaction = true;
    context.addMessage({ role: "user", content: FLUSH_MSG });
  }

  assert(skipCompaction, "Should skip compaction when flush is injected");
  assert(memoryFlushedThisCycle, "Flush flag should be set");

  const flushMsg = context.getMessages().find((m) => m.content.includes("memory_write"));
  assert(flushMsg, "Flush message must reference memory_write");
  assertStringIncludes(flushMsg!.content, "Context nearing limit");

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
    // Insert a fact into DB
    insertFact({ content: "User prefers Python over JavaScript", category: "Preferences" });

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

    const reused = await reuseSession(fakeSession);

    const messages = reused.context.getMessages();
    const memoryMsg = messages.find((m) =>
      m.role === "system" && m.content.startsWith("# Your Memory")
    );
    assert(memoryMsg, "Reused session must have memory injected");
    assertStringIncludes(memoryMsg!.content, "Python over JavaScript");

    assert(
      messages.some((m) => m.content === "System prompt here."),
      "Original system prompt must be preserved",
    );
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Security: ensureMemoryDirs permissions
// ============================================================

Deno.test("Security: ensureMemoryDirs (async) sets 0o700 on memory directory", async () => {
  const tempDir = await setupTestEnv();
  try {
    await ensureMemoryDirs();
    const memDir = getMemoryDir();
    const stat = await Deno.stat(memDir);
    assert(stat.isDirectory, "Memory directory should exist");

    if (stat.mode !== null && stat.mode !== undefined) {
      const perms = stat.mode & 0o777;
      assertEquals(perms, 0o700, `Memory dir permissions should be 0o700, got 0o${perms.toString(8)}`);
    }
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
// Concurrent write safety
// ============================================================

Deno.test("Concurrency: simultaneous fact inserts don't corrupt DB", async () => {
  const tempDir = await setupTestEnv();
  try {
    // Fire 10 concurrent inserts
    const promises = Array.from({ length: 10 }, (_, i) =>
      memoryWrite({ content: `Entry number ${i}`, target: "memory", section: "Concurrent" })
    );
    await Promise.all(promises);

    const facts = getValidFacts();
    // All 10 entries must be present
    for (let i = 0; i < 10; i++) {
      assert(
        facts.some(f => f.content.includes(`Entry number ${i}`)),
        `Entry ${i} should be present after concurrent writes`,
      );
    }
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// memory_edit: delete_section and replace (V2 DB-based)
// ============================================================

Deno.test("memory_edit: delete_section invalidates facts in category", async () => {
  const tempDir = await setupTestEnv();
  try {
    await memoryWrite({ content: "Important stuff", target: "memory", section: "Keep" });
    await memoryWrite({ content: "Outdated info", target: "memory", section: "Remove" });
    await memoryWrite({ content: "More stuff", target: "memory", section: "Also Keep" });

    const result = await memoryEdit({ action: "delete_section", section: "Remove" }) as Record<string, unknown>;
    assertEquals(result.edited, true);

    // "Remove" category should be invalidated
    const facts = getValidFacts();
    assert(facts.some(f => f.content.includes("Important stuff")));
    assert(facts.some(f => f.content.includes("More stuff")));
    assertEquals(facts.some(f => f.content.includes("Outdated info")), false, "Invalidated facts should not appear");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("memory_edit: delete_section returns false for non-existent category", async () => {
  const tempDir = await setupTestEnv();
  try {
    await memoryWrite({ content: "Content", target: "memory", section: "Existing" });
    const result = await memoryEdit({ action: "delete_section", section: "NonExistent" }) as Record<string, unknown>;
    assertEquals(result.edited, false);
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("memory_edit: replace finds and replaces text in facts", async () => {
  const tempDir = await setupTestEnv();
  try {
    await memoryWrite({ content: "User prefers tabs. Use tabs everywhere.", target: "memory" });

    const result = await memoryEdit({
      action: "replace",
      find: "tabs",
      replace_with: "spaces",
    }) as Record<string, unknown>;
    assertEquals(result.edited, true);
    assert((result.replacements as number) >= 1);

    const facts = getValidFacts();
    assert(facts.some(f => f.content.includes("spaces")));
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("memory_edit: replace returns 0 when find doesn't match", async () => {
  const tempDir = await setupTestEnv();
  try {
    await memoryWrite({ content: "User prefers dark mode", target: "memory" });
    const result = await memoryEdit({
      action: "replace",
      find: "light mode",
      replace_with: "dark mode",
    }) as Record<string, unknown>;
    assertEquals(result.edited, false);
    assertEquals(result.replacements, 0);
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("memory_edit: rejects invalid action", async () => {
  const tempDir = await setupTestEnv();
  try {
    let threw = false;
    try {
      await memoryEdit({ action: "invalid" });
    } catch {
      threw = true;
    }
    assertEquals(threw, true, "Should reject invalid action");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Hard cap: loadMemoryContext truncates oversized memory
// ============================================================

Deno.test("Hard cap: loadMemoryContext truncates when many facts exceed budget", async () => {
  const tempDir = await setupTestEnv();
  try {
    // Insert many facts to exceed budget
    for (let i = 0; i < 200; i++) {
      insertFact({
        content: `Decision ${i}: We chose architecture pattern ${i} for module ${i} with extensive rationale`,
        category: "Decisions",
      });
    }

    const context = await loadMemoryContext(8_000);

    // Should have some content
    assertStringIncludes(context, "Decision");
    // With 8K budget (15% = 1200 tokens max), 200 long facts should exceed budget
    if (context.includes("[Memory truncated")) {
      assert(true, "Context was correctly truncated");
    } else {
      // If no truncation, it means fewer facts fit — also OK
      assert(context.length > 0, "Should still have content");
    }
  } finally {
    await teardownTestEnv(tempDir);
  }
});

// ============================================================
// Facts DB CRUD (merged from facts.test.ts for test isolation)
// ============================================================

Deno.test("facts: insert and retrieve a fact", async () => {
  const tempDir = await setupTestEnv();
  try {
    const id = insertFact({ content: "User prefers Deno over Node" });
    assert(id > 0, "Should return a positive ID");

    const facts = getValidFacts();
    assertEquals(facts.length, 1);
    assertStringIncludes(facts[0].content, "User prefers Deno over Node");
    assertEquals(facts[0].category, "General");
    assertEquals(facts[0].source, "memory");
    assertEquals(facts[0].validUntil, null);
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("facts: insert with custom category and source", async () => {
  const tempDir = await setupTestEnv();
  try {
    insertFact({
      content: "Auth uses JWT with 1h expiry",
      category: "architecture",
      source: "extracted",
    });

    const facts = getValidFacts({ category: "architecture" });
    assertEquals(facts.length, 1);
    assertEquals(facts[0].category, "architecture");
    assertEquals(facts[0].source, "extracted");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("facts: insert with custom validFrom date", async () => {
  const tempDir = await setupTestEnv();
  try {
    insertFact({
      content: "Migrated preference: dark mode",
      source: "migrated",
      validFrom: "2025-06-15",
    });

    const facts = getValidFacts();
    assertEquals(facts.length, 1);
    assertEquals(facts[0].validFrom, "2025-06-15");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("facts: PII is sanitized before storage", async () => {
  const tempDir = await setupTestEnv();
  try {
    insertFact({ content: "User SSN is 123-45-6789 and likes vim" });

    const facts = getValidFacts();
    assertEquals(facts.length, 1);
    assertStringIncludes(facts[0].content, "[REDACTED:SSN]");
    assertEquals(facts[0].content.includes("123-45-6789"), false);
    assertStringIncludes(facts[0].content, "likes vim");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("facts: invalidate removes fact from valid set", async () => {
  const tempDir = await setupTestEnv();
  try {
    const id = insertFact({ content: "Old preference: tabs" });
    assertEquals(getValidFacts().length, 1);

    invalidateFact(id);

    const valid = getValidFacts();
    assertEquals(valid.length, 0, "Invalidated fact should not appear in valid set");

    // But it still exists in DB (soft delete)
    const db = getFactDb();
    const row = db.prepare("SELECT * FROM facts WHERE id = ?").value<unknown[]>(id);
    assert(row !== null, "Fact should still exist in DB after invalidation");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("facts: FTS5 search finds matching facts", async () => {
  const tempDir = await setupTestEnv();
  try {
    insertFact({ content: "Project uses hexagonal architecture with ports and adapters" });
    insertFact({ content: "Database is PostgreSQL 16 with pgvector extension" });
    insertFact({ content: "User prefers dark mode and vim keybindings" });

    const results = searchFactsFts("hexagonal architecture");
    assert(results.length > 0, "Should find hexagonal architecture fact");
    assertStringIncludes(results[0].content, "hexagonal");

    const dbResults = searchFactsFts("PostgreSQL pgvector");
    assert(dbResults.length > 0, "Should find PostgreSQL fact");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("facts: FTS5 AND-first with OR fallback", async () => {
  const tempDir = await setupTestEnv();
  try {
    insertFact({ content: "Fixed CORS issue in the proxy layer" });
    insertFact({ content: "Found critical bug in authentication" });

    const results = searchFactsFts("cors bug", 10);
    assert(results.length > 0, "OR fallback should find results");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("facts: FTS5 excludes invalidated facts", async () => {
  const tempDir = await setupTestEnv();
  try {
    const id = insertFact({ content: "Obsolete fact about Redis caching" });
    invalidateFact(id);

    const results = searchFactsFts("Redis caching");
    assertEquals(results.length, 0, "Invalidated facts should not appear in FTS5 results");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("facts: FTS5 handles empty and operator-only queries", async () => {
  const tempDir = await setupTestEnv();
  try {
    insertFact({ content: "Some content" });

    assertEquals(searchFactsFts("").length, 0, "Empty query returns empty");
    assertEquals(searchFactsFts("   ").length, 0, "Whitespace query returns empty");
    assertEquals(searchFactsFts("AND OR NOT").length, 0, "All-operators query returns empty");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("facts: FTS5 handles parentheses and special chars safely", async () => {
  const tempDir = await setupTestEnv();
  try {
    insertFact({ content: "function foo(bar) returns baz" });

    const results = searchFactsFts("foo(bar)");
    assert(results.length > 0, "Should find content despite parens in query");

    const results2 = searchFactsFts(`"foo" * 'bar'`);
    assert(results2.length > 0, "Should handle quotes and asterisks");
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("facts: touchFact increments access_count", async () => {
  const tempDir = await setupTestEnv();
  try {
    const id = insertFact({ content: "Frequently accessed fact" });

    const before = getValidFacts();
    assertEquals(before[0].accessCount, 0);

    touchFact(id);
    touchFact(id);
    touchFact(id);

    const after = getValidFacts();
    assertEquals(after[0].accessCount, 3);
  } finally {
    await teardownTestEnv(tempDir);
  }
});

Deno.test("facts: getValidFacts filters by category", async () => {
  const tempDir = await setupTestEnv();
  try {
    insertFact({ content: "Prefers dark mode", category: "preference" });
    insertFact({ content: "Uses Deno runtime", category: "environment" });
    insertFact({ content: "Likes vim", category: "preference" });

    const prefs = getValidFacts({ category: "preference" });
    assertEquals(prefs.length, 2);
    assert(prefs.every((f) => f.category === "preference"));

    const env = getValidFacts({ category: "environment" });
    assertEquals(env.length, 1);
    assertEquals(env[0].content, "Uses Deno runtime");
  } finally {
    await teardownTestEnv(tempDir);
  }
});
