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
  resetHlvmDirCacheForTests,
} from "../../../src/common/paths.ts";
import {
  closeFactDb,
  extractConversationFacts,
  extractSessionFacts,
  getFactDb,
  getValidFacts,
  insertFact,
  invalidateFact,
  linkFactEntities,
  loadMemoryContext,
  MEMORY_TOOLS,
  persistConversationFacts,
  searchFactsFts,
  touchFact,
} from "../../../src/hlvm/memory/mod.ts";
import { sanitizeSensitiveContent } from "../../../src/hlvm/memory/store.ts";
import { reuseSession } from "../../../src/hlvm/agent/agent-runner.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import type { AgentSession } from "../../../src/hlvm/agent/session.ts";
import { ENGINE_PROFILES } from "../../../src/hlvm/agent/constants.ts";

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
  const tempDir = await setupTestEnv();
  try {
    await fn();
  } finally {
    await teardownTestEnv(tempDir);
  }
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
    resolvedContextBudget: {
      budget: 32000,
      rawLimit: 32000,
      source: "default",
    },
  };
}

Deno.test("memory: memory_write and memory_search cover both memory and journal targets", async () => {
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
    assertEquals(journal.target, "journal");
    assert(
      getValidFacts().some((fact) => fact.content.includes("tabs over spaces")),
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
    const result = extractSessionFacts([
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
