import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  ensureMemoryDirs,
  ensureMemoryDirsSync,
  getMemoryDir,
  getMemoryMdPath,
  resetHlvmDirCacheForTests,
} from "../../../src/common/paths.ts";
import {
  appendExplicitMemoryNote,
  closeFactDb,
  extractConversationFacts,
  extractSessionFacts,
  getExplicitMemoryPath,
  getFactDb,
  getValidFacts,
  insertFact,
  invalidateFact,
  isMemorySystemMessage,
  linkFactEntities,
  loadMemorySystemMessage,
  MEMORY_TOOLS,
  parseLLMExtractionResponse,
  persistConversationFacts,
  readExplicitMemory,
  searchFactsFts,
  touchFact,
  writeExplicitMemory,
} from "../../../src/hlvm/memory/mod.ts";
import { memory as memoryApi } from "../../../src/hlvm/api/memory.ts";
import {
  buildMemorySystemMessage,
  loadMemoryContext,
} from "../../../src/hlvm/memory/manager.ts";
import {
  accessBoost,
  retrieveMemory,
  temporalDecay,
} from "../../../src/hlvm/memory/retrieve.ts";
import { sanitizeSensitiveContent } from "../../../src/hlvm/memory/store.ts";
import { reuseSession } from "../../../src/hlvm/agent/agent-runner.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import type { AgentSession } from "../../../src/hlvm/agent/session.ts";
import { ENGINE_PROFILES } from "../../../src/hlvm/agent/constants.ts";
import { createTodoState } from "../../../src/hlvm/agent/todo-state.ts";
import { withGlobalTestLock } from "../_shared/global-test-lock.ts";

const platform = () => getPlatform();
const memoryWrite = (args: unknown) =>
  MEMORY_TOOLS.memory_write.fn(args, "/tmp");
const memorySearch = (args: unknown) =>
  MEMORY_TOOLS.memory_search.fn(args, "/tmp");
const memoryEdit = (args: unknown) => MEMORY_TOOLS.memory_edit.fn(args, "/tmp");

async function setupTestEnv(): Promise<string> {
  const tempDir = await platform().fs.makeTempDir({
    prefix: "hlvm-memory-test-",
  });
  platform().env.set("HLVM_DIR", tempDir);
  resetHlvmDirCacheForTests();
  return tempDir;
}

async function teardownTestEnv(tempDir: string): Promise<void> {
  closeFactDb();
  platform().env.delete("HLVM_DIR");
  resetHlvmDirCacheForTests();
  try {
    await platform().fs.remove(tempDir, { recursive: true });
  } catch {
    // best-effort cleanup for flaky tempdir deletion on CI
  }
}

async function withTestEnv(fn: () => Promise<void>): Promise<void> {
  await withGlobalTestLock(async () => {
    const tempDir = await setupTestEnv();
    try {
      await fn();
    } finally {
      await teardownTestEnv(tempDir);
    }
  });
}

function createAgentSession(context: ContextManager): AgentSession {
  return {
    context,
    llm: () =>
      Promise.resolve({
        content: "",
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    policy: null,
    l1Confirmations: new Map(),
    toolOwnerId: "test",
    dispose: () => Promise.resolve(),
    profile: ENGINE_PROFILES.normal,
    isFrontierModel: false,
    modelTier: "mid",
    todoState: createTodoState(),
    resolvedContextBudget: {
      budget: 32000,
      rawLimit: 32000,
      source: "default",
    },
  };
}

Deno.test("memory: memory_write stores durable facts and normalizes the legacy journal alias", async () => {
  await withTestEnv(async () => {
    const pref = await memoryWrite({
      content: "User prefers tabs over spaces and dark mode",
      target: "memory",
      section: "Preferences",
    }) as Record<string, unknown>;
    const journal = await memoryWrite({
      content: "Fixed critical auth bug by refreshing OAuth tokens on 401",
      target: "journal",
    }) as Record<string, unknown>;

    assertEquals(pref.written, true);
    assertEquals(journal.written, true);
    assertEquals(journal.target, "memory");
    assertEquals(journal.requestedTarget, "journal");
    assert(
      getValidFacts().some((fact) => fact.content.includes("tabs over spaces")),
    );
    assertEquals(
      getValidFacts().every((fact) => fact.source === "memory"),
      true,
    );

    const prefSearch = await memorySearch({ query: "tabs spaces" }) as Record<
      string,
      unknown
    >;
    const journalSearch = await memorySearch({
      query: "OAuth tokens",
    }) as Record<string, unknown>;

    assert((prefSearch.count as number) > 0);
    assert((journalSearch.count as number) > 0);
  });
});

Deno.test("memory: loadMemoryContext scales with context budget and truncates safely", async () => {
  await withTestEnv(async () => {
    for (let i = 0; i < 60; i++) {
      insertFact({
        content:
          `Decision ${i}: We chose architecture pattern ${i} for module ${i} with extensive rationale`,
        category: "Decisions",
      });
    }

    const small = await loadMemoryContext(8_000);
    const large = await loadMemoryContext(32_000);

    assertStringIncludes(large, "Decision");
    assert(large.length >= small.length);
  });
});

Deno.test("memory: system message warns that memory is not chronology", () => {
  const message = buildMemorySystemMessage(
    "## Preferences\n- User prefers Deno",
  );
  assertStringIncludes(
    message,
    "non-chronological",
  );
  assertStringIncludes(
    message,
    "Do not use it to answer recency questions",
  );
  assertStringIncludes(
    message,
    "treat that as authoritative and do not fill chronology gaps from memory",
  );
  assertStringIncludes(message, "## Preferences");
});

Deno.test("memory: shared conversation extractor emits stable facts", async () => {
  await withTestEnv(async () => {
    const facts = extractConversationFacts([
      {
        role: "user",
        content: "My name is Alice. I prefer tabs. Remember that I use Deno.",
      },
      { role: "assistant", content: "Noted." },
      { role: "user", content: "We decided to keep SQLite." },
    ]);

    assertEquals(
      facts.map((fact) => [fact.category, fact.content]),
      [
        ["Identity", "User's name: Alice"],
        ["Preferences", "I prefer tabs"],
        ["Preferences", "Remember that I use Deno"],
        ["Decisions", "We decided to keep SQLite"],
      ],
    );
  });
});

Deno.test("memory: shared conversation extractor avoids false-positive name matches", async () => {
  await withTestEnv(async () => {
    const facts = extractConversationFacts([
      {
        role: "user",
        content:
          "I'm thinking about Deno.\n```ts\nconst person = 'not a fact';\n```",
      },
    ]);

    assertEquals(facts, []);
  });
});

Deno.test("memory: shared conversation persistence dedupes repeated baseline facts", async () => {
  await withTestEnv(async () => {
    const first = persistConversationFacts([
      { role: "user", content: "My name is Alice. I prefer tabs." },
    ]);
    const second = persistConversationFacts([
      { role: "user", content: "My name is Alice. I prefer tabs." },
    ]);

    assertEquals(first.factsExtracted, 2);
    assertEquals(second.factsExtracted, 0);
    assertEquals(
      getValidFacts().map((fact) => [fact.category, fact.content]),
      [
        ["Preferences", "I prefer tabs"],
        ["Identity", "User's name: Alice"],
      ],
    );
  });
});

Deno.test("memory: canonical insert links entities once even if chat relinks the same fact", async () => {
  await withTestEnv(async () => {
    const content = "uses deno with auth.ts";
    const factId = insertFact({
      content,
      category: "Preferences",
      source: "memory",
    });
    const countRelationships = () =>
      getFactDb().prepare(
        "SELECT COUNT(*) FROM relationships WHERE fact_id = ?",
      ).value<[number]>(factId)?.[0] ?? 0;

    const before = countRelationships();
    const linkedAgain = linkFactEntities(factId, content);
    const after = countRelationships();

    assert(before > 0);
    assert(linkedAgain > 0);
    assertEquals(after, before);
  });
});

Deno.test("memory: sanitizer helper and tool path redact sensitive content before storage", async () => {
  await withTestEnv(async () => {
    const ssn = sanitizeSensitiveContent("My SSN is 123-45-6789");
    const key = sanitizeSensitiveContent(
      "Use sk_live_abcdefghijklmnopqrstuvwxyz",
    );
    const password = sanitizeSensitiveContent("password: hunter2");

    assertStringIncludes(ssn.sanitized, "[REDACTED:SSN]");
    assertStringIncludes(key.sanitized, "[REDACTED:API key]");
    assertStringIncludes(password.sanitized, "[REDACTED:password]");

    await memoryWrite({
      content:
        "User SSN is 123-45-6789 and API key is sk_live_abcdefghijklmnopqrstuvwxyz",
      target: "memory",
    });

    const [stored] = getValidFacts();
    assert(stored !== undefined);
    assertStringIncludes(stored.content, "[REDACTED:SSN]");
    assertStringIncludes(stored.content, "[REDACTED:API key]");
    assertEquals(stored.content.includes("123-45-6789"), false);
    assertEquals(
      stored.content.includes("sk_live_abcdefghijklmnopqrstuvwxyz"),
      false,
    );
  });
});

Deno.test("memory: reuseSession refreshes memory without losing the system prompt", async () => {
  await withTestEnv(async () => {
    insertFact({
      content: "Fresh preference: emacs keybindings and light mode",
      category: "Preferences",
    });

    const context = new ContextManager({ maxTokens: 32_000 });
    context.addMessage({ role: "system", content: "You are an assistant." });
    context.addMessage({
      role: "system",
      content: "# Your Memory\nStale preference: vim keybindings",
    });

    const reused = await reuseSession(createAgentSession(context));
    const messages = reused.context.getMessages();

    assert(
      messages.some((message) => message.content === "You are an assistant."),
    );
    assert(
      messages.some((message) =>
        message.content.includes("Fresh preference: emacs keybindings")
      ),
    );
  });
});

Deno.test("memory: frontier session extraction reuses shared fact pipeline", async () => {
  await withTestEnv(async () => {
    const result = await extractSessionFacts([
      { role: "user", content: "We decided to keep SQLite." },
      { role: "assistant", content: "Sounds good." },
      { role: "user", content: "Fixed auth bug in session resume flow." },
    ], "frontier");

    assertEquals(result.factsExtracted, 2);
    assertEquals(
      getValidFacts().map((fact) => [fact.category, fact.content]),
      [
        ["Bugs", "Fixed auth bug in session resume flow"],
        ["Decisions", "We decided to keep SQLite"],
      ],
    );
  });
});

Deno.test("memory: invalid tool inputs are rejected", async () => {
  await withTestEnv(async () => {
    await assertRejects(async () =>
      await memoryWrite({ content: "", target: "memory" })
    );
    await assertRejects(async () =>
      await memoryWrite({ content: "test", target: "invalid" })
    );
    await assertRejects(async () => await memoryEdit({ action: "invalid" }));
  });
});

Deno.test("memory: memory_edit deletes sections and replaces text across facts", async () => {
  await withTestEnv(async () => {
    await memoryWrite({
      content: "Important stuff",
      target: "memory",
      section: "Keep",
    });
    await memoryWrite({
      content: "Outdated info",
      target: "memory",
      section: "Remove",
    });
    await memoryWrite({
      content: "User prefers tabs. Use tabs everywhere.",
      target: "memory",
    });

    const deleted = await memoryEdit({
      action: "delete_section",
      section: "Remove",
    }) as Record<string, unknown>;
    const replaced = await memoryEdit({
      action: "replace",
      find: "tabs",
      replace_with: "spaces",
    }) as Record<string, unknown>;

    const facts = getValidFacts();
    assertEquals(deleted.edited, true);
    assertEquals(replaced.edited, true);
    assert((replaced.replacements as number) >= 1);
    assertEquals(
      facts.some((fact) => fact.content.includes("Outdated info")),
      false,
    );
    assert(facts.some((fact) => fact.content.includes("spaces")));
  });
});

Deno.test("memory: temporal decay and access boost score recent facts higher", async () => {
  await withTestEnv(async () => {
    // Verify pure helpers
    const now = Math.floor(Date.now() / 1000);
    assert(temporalDecay(now) > 0.99);
    assert(temporalDecay(now - 90 * 86400) < 0.15);
    assertEquals(accessBoost(0), 1);
    assert(accessBoost(5) > accessBoost(1));

    // Insert two facts with identical query-relevant content
    const recentId = insertFact({
      content: "The database uses PostgreSQL for production",
    });
    const oldId = insertFact({
      content: "The database uses PostgreSQL for staging",
    });

    // Backdate the old fact by 90 days
    getFactDb().prepare("UPDATE facts SET created_at = ? WHERE id = ?").run(
      now - 90 * 86400,
      oldId,
    );

    const results = retrieveMemory("PostgreSQL database", 10);
    assert(results.length >= 2);

    const recentResult = results.find((r) => r.factId === recentId);
    const oldResult = results.find((r) => r.factId === oldId);
    assert(recentResult !== undefined);
    assert(oldResult !== undefined);
    assert(
      recentResult!.score > oldResult!.score,
      `Recent (${recentResult!.score}) should score higher than old (${
        oldResult!.score
      })`,
    );
  });
});

Deno.test("memory: memory_edit clear_all requires confirm and wipes all facts", async () => {
  await withTestEnv(async () => {
    await memoryWrite({
      content: "Fact A",
      target: "memory",
      section: "Alpha",
    });
    await memoryWrite({ content: "Fact B", target: "memory", section: "Beta" });
    await memoryWrite({ content: "Fact C", target: "memory" });

    assertEquals(getValidFacts().length, 3);

    // clear_all without confirm: true should throw
    await assertRejects(
      async () => await memoryEdit({ action: "clear_all" }),
    );
    await assertRejects(
      async () => await memoryEdit({ action: "clear_all", confirm: false }),
    );

    // facts should still be intact
    assertEquals(getValidFacts().length, 3);

    // clear_all with confirm: true should invalidate all
    const result = await memoryEdit({
      action: "clear_all",
      confirm: true,
    }) as Record<string, unknown>;
    assertEquals(result.edited, true);
    assertEquals(result.action, "clear_all");
    assertEquals(result.invalidated, 3);
    assertEquals(getValidFacts().length, 0);

    // search should return nothing
    const search = await memorySearch({ query: "Fact" }) as Record<
      string,
      unknown
    >;
    assertEquals(search.count, 0);
  });
});

Deno.test("memory: ensureMemoryDirs async and sync paths create a locked-down directory", async () => {
  await withTestEnv(async () => {
    await ensureMemoryDirs();
    ensureMemoryDirsSync();

    const stat = await platform().fs.stat(getMemoryDir());
    assert(stat.isDirectory);
    const mode = (stat as { mode?: number | null }).mode;
    if (mode !== null && mode !== undefined) {
      assertEquals(mode & 0o777, 0o700);
    }
  });
});

Deno.test("memory: concurrent writes remain queryable and do not corrupt the DB", async () => {
  await withTestEnv(async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        memoryWrite({
          content: `Entry number ${index}`,
          target: "memory",
          section: "Concurrent",
        })),
    );

    const facts = getValidFacts();
    for (let i = 0; i < 10; i++) {
      assert(facts.some((fact) => fact.content.includes(`Entry number ${i}`)));
    }
    assert(searchFactsFts("Entry number 5").length > 0);
  });
});

Deno.test("memory: fact CRUD covers defaults, invalidation, search, touch, and category filters", async () => {
  await withTestEnv(async () => {
    const defaultId = insertFact({ content: "User prefers Deno over Node" });
    const customId = insertFact({
      content: "Auth uses JWT with 1h expiry",
      category: "architecture",
      source: "extracted",
      validFrom: "2025-06-15",
    });
    insertFact({
      content: "function foo(bar) returns baz",
      category: "reference",
    });

    assert(defaultId > 0);
    touchFact(defaultId);
    touchFact(defaultId);
    invalidateFact(customId);

    const valid = getValidFacts();
    const preferences = getValidFacts({ category: "General" });
    const refs = getValidFacts({ category: "reference" });

    assert(
      valid.some((fact) => fact.id === defaultId && fact.accessCount === 2),
    );
    assertEquals(valid.some((fact) => fact.id === customId), false);
    assertEquals(preferences.length, 1);
    assertEquals(refs.length, 1);
    assert(searchFactsFts("Deno Node").length > 0);
    assertEquals(searchFactsFts("").length, 0);
    assertEquals(searchFactsFts("AND OR NOT").length, 0);
    assert(searchFactsFts("foo(bar)").length > 0);

    const row = getFactDb().prepare("SELECT * FROM facts WHERE id = ?").value<
      unknown[]
    >(customId);
    assert(row !== null);
  });
});

Deno.test("memory: parseLLMExtractionResponse handles valid JSON array", () => {
  const input = JSON.stringify([
    { category: "Identity", content: "User's name: Bob" },
    { category: "Preferences", content: "Prefers dark mode" },
  ]);
  const result = parseLLMExtractionResponse(input);
  assertEquals(result.length, 2);
  assertEquals(result[0].category, "Identity");
  assertEquals(result[0].content, "User's name: Bob");
  assertEquals(result[1].category, "Preferences");
  assertEquals(result[1].content, "Prefers dark mode");
});

Deno.test("memory: parseLLMExtractionResponse strips markdown code fences", () => {
  const input =
    '```json\n[{"category": "Decisions", "content": "Chose SQLite"}]\n```';
  const result = parseLLMExtractionResponse(input);
  assertEquals(result.length, 1);
  assertEquals(result[0].content, "Chose SQLite");
});

Deno.test("memory: parseLLMExtractionResponse returns empty array for garbage", () => {
  assertEquals(parseLLMExtractionResponse("not json at all"), []);
  assertEquals(parseLLMExtractionResponse(""), []);
  assertEquals(parseLLMExtractionResponse("{not an array}"), []);
});

Deno.test("memory: parseLLMExtractionResponse filters invalid entries", () => {
  const input = JSON.stringify([
    { category: "Identity", content: "Valid fact" },
    { category: "Bugs" }, // missing content
    { content: "No category" }, // missing category
    { category: "Preferences", content: "" }, // empty content
    { category: 123, content: "Number category" }, // wrong type
    "not an object",
  ]);
  const result = parseLLMExtractionResponse(input);
  assertEquals(result.length, 1);
  assertEquals(result[0].content, "Valid fact");
});

Deno.test("memory: parseLLMExtractionResponse caps at 10 entries", () => {
  const entries = Array.from({ length: 15 }, (_, i) => ({
    category: "General",
    content: `Fact ${i}`,
  }));
  const result = parseLLMExtractionResponse(JSON.stringify(entries));
  assertEquals(result.length, 10);
});

Deno.test("memory: parseLLMExtractionResponse handles empty array", () => {
  assertEquals(parseLLMExtractionResponse("[]"), []);
});

// ── MEMORY.md tests ──────────────────────────────────────────────────────────

Deno.test("memory: MEMORY.md content is loaded when file exists", async () => {
  await withTestEnv(async () => {
    await ensureMemoryDirs();
    const mdPath = getMemoryMdPath();
    await platform().fs.writeTextFile(mdPath, "User prefers dark mode.\nTimezone: Asia/Seoul.");

    const context = await loadMemoryContext(32_000);
    assertStringIncludes(context, "User prefers dark mode.");
    assertStringIncludes(context, "Timezone: Asia/Seoul.");
  });
});

Deno.test("memory: MEMORY.md is auto-created when missing", async () => {
  await withTestEnv(async () => {
    await ensureMemoryDirs();
    const mdPath = getMemoryMdPath();

    // File should not exist yet in fresh temp dir
    const memoryMessage = await loadMemorySystemMessage(32_000);
    assert(memoryMessage !== null);
    assertStringIncludes(memoryMessage.content, "# My Notes");

    // File should now exist on disk
    const onDisk = await platform().fs.readTextFile(mdPath);
    assertStringIncludes(onDisk, "# My Notes");
  });
});

Deno.test("memory: loadMemorySystemMessage returns the canonical system wrapper", async () => {
  await withTestEnv(async () => {
    await ensureMemoryDirs();
    await platform().fs.writeTextFile(
      getMemoryMdPath(),
      "My timezone is Asia/Seoul.",
    );

    const memoryMessage = await loadMemorySystemMessage(32_000);
    assert(memoryMessage !== null);
    assertEquals(memoryMessage.role, "system");
    assertEquals(isMemorySystemMessage(memoryMessage.content), true);
    assertStringIncludes(memoryMessage.content, "# Your Memory");
    assertStringIncludes(memoryMessage.content, "My timezone is Asia/Seoul.");
  });
});

Deno.test("memory: MEMORY.md has token priority over DB facts", async () => {
  await withTestEnv(async () => {
    await ensureMemoryDirs();
    // Write a large MEMORY.md that will consume most of the tiny budget
    const bigContent = "User note: " + "A".repeat(2000);
    await platform().fs.writeTextFile(getMemoryMdPath(), bigContent);

    // Also insert a DB fact
    insertFact({ content: "DB-learned preference: functional style", category: "Preferences" });

    // Use a very small context window so budget is tight (8000 * 0.15 = 1200 tokens)
    const context = await loadMemoryContext(8_000);

    // MEMORY.md content should be present (it's priority 1)
    assertStringIncludes(context, "User note:");
  });
});

Deno.test("memory: empty MEMORY.md is treated as no user notes (DB-only)", async () => {
  await withTestEnv(async () => {
    await ensureMemoryDirs();
    await platform().fs.writeTextFile(getMemoryMdPath(), "   \n  \n  ");

    insertFact({ content: "DB fact about testing", category: "Testing" });

    const context = await loadMemoryContext(32_000);
    // Should contain DB facts but no separator (no user notes section)
    assertStringIncludes(context, "DB fact about testing");
    assertEquals(context.includes("---"), false);
  });
});

Deno.test("memory: MEMORY.md and DB facts are combined with --- separator", async () => {
  await withTestEnv(async () => {
    await ensureMemoryDirs();
    await platform().fs.writeTextFile(getMemoryMdPath(), "Always use TypeScript.");

    insertFact({ content: "Likes functional programming", category: "Preferences" });

    const context = await loadMemoryContext(32_000);
    assertStringIncludes(context, "Always use TypeScript.");
    assertStringIncludes(context, "---");
    assertStringIncludes(context, "Likes functional programming");

    // Verify order: user notes before DB facts
    const mdIndex = context.indexOf("Always use TypeScript.");
    const separatorIndex = context.indexOf("---");
    const dbIndex = context.indexOf("Likes functional programming");
    assert(mdIndex < separatorIndex);
    assert(separatorIndex < dbIndex);
  });
});

// ── Explicit memory (MEMORY.md SSOT module) ─────────────────────────────────

Deno.test("memory: readExplicitMemory creates default file when missing", async () => {
  await withTestEnv(async () => {
    const content = await readExplicitMemory();
    assertStringIncludes(content, "# My Notes");

    // File should exist on disk now
    const onDisk = await platform().fs.readTextFile(getExplicitMemoryPath());
    assertStringIncludes(onDisk, "# My Notes");
  });
});

Deno.test("memory: readExplicitMemory returns trimmed content from existing file", async () => {
  await withTestEnv(async () => {
    await ensureMemoryDirs();
    await platform().fs.writeTextFile(
      getExplicitMemoryPath(),
      "  My custom notes  \n\n",
    );

    const content = await readExplicitMemory();
    assertEquals(content, "My custom notes");
  });
});

Deno.test("memory: appendExplicitMemoryNote appends to existing file", async () => {
  await withTestEnv(async () => {
    await ensureMemoryDirs();
    await platform().fs.writeTextFile(
      getExplicitMemoryPath(),
      "# My Notes\n",
    );

    await appendExplicitMemoryNote("First note");
    await appendExplicitMemoryNote("Second note");

    const content = await platform().fs.readTextFile(getExplicitMemoryPath());
    assertStringIncludes(content, "# My Notes");
    assertStringIncludes(content, "First note");
    assertStringIncludes(content, "Second note");

    // Verify order
    const firstIndex = content.indexOf("First note");
    const secondIndex = content.indexOf("Second note");
    assert(firstIndex < secondIndex);
  });
});

Deno.test("memory: appendExplicitMemoryNote creates file when missing", async () => {
  await withTestEnv(async () => {
    await appendExplicitMemoryNote("Created from scratch");

    const content = await platform().fs.readTextFile(getExplicitMemoryPath());
    assertStringIncludes(content, "# My Notes");
    assertStringIncludes(content, "Created from scratch");
  });
});

Deno.test("memory: getExplicitMemoryPath returns the MEMORY.md path", async () => {
  await withTestEnv(async () => {
    const path = getExplicitMemoryPath();
    assertEquals(path, getMemoryMdPath());
  });
});

Deno.test("memory: legacy journal alias no longer creates a Journal prompt section", async () => {
  await withTestEnv(async () => {
    await memoryWrite({
      content: "Temporary-looking note that still becomes durable memory",
      target: "journal",
    });

    const context = await loadMemoryContext(32_000);
    assertStringIncludes(
      context,
      "Temporary-looking note that still becomes durable memory",
    );
    assertEquals(context.includes("## Journal"), false);
  });
});

Deno.test("memory api: snapshot includes explicit notes and durable facts together", async () => {
  await withTestEnv(async () => {
    await writeExplicitMemory("Manual note");
    insertFact({ content: "Durable fact", category: "Preferences" });

    const snapshot = await memoryApi.get();
    assertEquals(snapshot.notes, "Manual note");
    assertEquals(snapshot.factCount, 1);
    assertEquals(snapshot.facts[0]?.content, "Durable fact");
    assertEquals(snapshot.notesPath, getMemoryMdPath());
  });
});

Deno.test("memory api: replace updates notes and durable facts, clear wipes both", async () => {
  await withTestEnv(async () => {
    await writeExplicitMemory("replace me in notes");
    insertFact({ content: "replace me in facts", category: "General" });

    const replaced = await memoryApi.replace("replace me", "updated");
    assertEquals(replaced.noteReplacements, 1);
    assertEquals(replaced.factReplacements, 1);
    assertEquals(await readExplicitMemory(), "updated in notes");
    assertEquals(getValidFacts()[0]?.content, "updated in facts");

    const cleared = await memoryApi.clear(true);
    assertEquals(cleared.clearedNotes, true);
    assertEquals(cleared.clearedFacts, 1);
    assertEquals(await readExplicitMemory(), "");
    assertEquals(getValidFacts().length, 0);
  });
});
