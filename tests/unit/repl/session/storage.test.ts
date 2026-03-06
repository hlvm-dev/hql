import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import {
  appendMessage,
  appendMessageOnly,
  countSessions,
  createSession,
  deleteSession,
  exportSession,
  generateSessionId,
  getLastSession,
  hashProjectPath,
  listSessions,
  loadSession,
  updateSessionIndex,
  updateTitle,
} from "../../../../src/hlvm/cli/repl/session/storage.ts";
import { getPlatform } from "../../../../src/platform/platform.ts";
import { createTestSessionScope, type TestSessionScope } from "./helpers.ts";

async function withScope(
  fn: (scope: TestSessionScope) => Promise<void>,
): Promise<void> {
  const scope = await createTestSessionScope("hlvm-session-storage-");
  try {
    await fn(scope);
  } finally {
    await scope.cleanup();
  }
}

Deno.test("SessionStorage: hashProjectPath and generateSessionId create stable identifiers", () => {
  const hash = hashProjectPath("/Users/dev/project");

  assertEquals(hashProjectPath("/Users/dev/project"), hash);
  assert(hashProjectPath("/Users/dev/other-project") !== hash);
  assert(/^[0-9a-f]{8}$/.test(hash));

  const before = Date.now();
  const id1 = generateSessionId();
  const id2 = generateSessionId();
  const after = Date.now();

  assert(id1 !== id2);
  const timestamp = Number.parseInt(id1.split("_")[0], 10);
  assert(timestamp >= before);
  assert(timestamp <= after);
});

Deno.test("SessionStorage: createSession + appendMessage + loadSession preserve messages and attachments", async () => {
  await withScope(async (scope) => {
    const projectPath = `/tmp/session-storage-lifecycle-${Date.now()}`;
    const meta = await createSession(projectPath, "Lifecycle", scope);

    await appendMessage(meta.id, "user", "Hello", ["/tmp/input.txt"], scope);
    await appendMessage(meta.id, "assistant", "Hi there", undefined, scope);

    const session = await loadSession(meta.id, scope);
    assertExists(session);
    assertEquals(session.meta.projectHash, hashProjectPath(projectPath));
    assertEquals(session.meta.title, "Lifecycle");
    assertEquals(session.meta.messageCount, 2);
    assertEquals(session.messages.length, 2);
    assertEquals(session.messages[0].attachments, ["/tmp/input.txt"]);
    assertEquals(session.messages[1].content, "Hi there");
  });
});

Deno.test("SessionStorage: appendMessageOnly batches writes until updateSessionIndex is called", async () => {
  await withScope(async (scope) => {
    const meta = await createSession(`/tmp/session-storage-batch-${Date.now()}`, "Batch", scope);
    const first = await appendMessageOnly(meta.id, "user", "One", undefined, scope);
    const second = await appendMessageOnly(meta.id, "assistant", "Two", undefined, scope);

    assertEquals((await listSessions({}, scope))[0].messageCount, 0);

    await updateSessionIndex(meta.id, 2, second.ts, scope);

    const session = await loadSession(meta.id, scope);
    assertExists(session);
    assertEquals(session.messages.length, 2);
    assertEquals(first.content, "One");
    assertEquals((await listSessions({}, scope))[0].messageCount, 2);
  });
});

Deno.test("SessionStorage: listSessions, countSessions, and getLastSession share one consistent ordering model", async () => {
  await withScope(async (scope) => {
    await createSession(`/tmp/session-storage-order-a-${Date.now()}`, "Bravo", scope);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await createSession(`/tmp/session-storage-order-b-${Date.now()}`, "Alpha", scope);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await createSession(`/tmp/session-storage-order-c-${Date.now()}`, "Charlie", scope);

    const recent = await listSessions({ sortOrder: "recent" }, scope);
    const oldest = await listSessions({ sortOrder: "oldest" }, scope);
    const alpha = await listSessions({ sortOrder: "alpha", limit: 2 }, scope);
    const last = await getLastSession(scope);

    assertEquals(await countSessions(scope), 3);
    assertEquals(recent.map((session) => session.title), ["Charlie", "Alpha", "Bravo"]);
    assertEquals(oldest.map((session) => session.title), ["Bravo", "Alpha", "Charlie"]);
    assertEquals(alpha.map((session) => session.title), ["Alpha", "Bravo"]);
    assertEquals(last?.title, "Charlie");
  });
});

Deno.test("SessionStorage: updateTitle and exportSession reflect the latest session state", async () => {
  await withScope(async (scope) => {
    const meta = await createSession(`/tmp/session-storage-export-${Date.now()}`, "Original", scope);
    await appendMessage(meta.id, "user", "Hello there", undefined, scope);
    await appendMessage(meta.id, "assistant", "Hi! How can I help?", undefined, scope);
    await updateTitle(meta.id, "Renamed Session", scope);

    const session = await loadSession(meta.id, scope);
    const markdown = await exportSession(meta.id, scope);

    assertExists(session);
    assertEquals(session.meta.title, "Renamed Session");
    assertExists(markdown);
    assert(markdown.includes("# Renamed Session"));
    assert(markdown.includes("**You**"));
    assert(markdown.includes("Hello there"));
    assert(markdown.includes("**Assistant**"));
  });
});

Deno.test("SessionStorage: deleteSession removes indexed sessions and reports missing sessions", async () => {
  await withScope(async (scope) => {
    const meta = await createSession(`/tmp/session-storage-delete-${Date.now()}`, "Delete Me", scope);

    assertEquals(await deleteSession(meta.id, scope), true);
    assertEquals(await loadSession(meta.id, scope), null);
    assertEquals(await countSessions(scope), 0);
    assertEquals(await deleteSession(meta.id, scope), false);
  });
});

Deno.test("SessionStorage: loadSession returns null for missing and empty session files", async () => {
  await withScope(async (scope) => {
    const platform = getPlatform();
    const missing = await loadSession("nonexistent-session", scope);
    const emptyId = generateSessionId();
    const emptyPath = platform.path.join(scope.sessionsDir!, `${emptyId}.jsonl`);

    await platform.fs.writeTextFile(emptyPath, "");

    assertEquals(missing, null);
    assertEquals(await loadSession(emptyId, scope), null);
    assertEquals(await exportSession("nonexistent-session", scope), null);
  });
});

Deno.test("SessionStorage: loadSession skips corrupted lines and preserves valid records", async () => {
  await withScope(async (scope) => {
    const platform = getPlatform();
    const meta = await createSession(`/tmp/session-storage-corrupt-${Date.now()}`, "Corrupt", scope);
    const sessionPath = platform.path.join(scope.sessionsDir!, `${meta.id}.jsonl`);

    await platform.fs.writeTextFile(sessionPath, "not valid json\n", { append: true });
    await appendMessage(meta.id, "user", "After corruption", undefined, scope);

    const session = await loadSession(meta.id, scope);
    assertExists(session);
    assertEquals(session.messages.length, 1);
    assertEquals(session.messages[0].content, "After corruption");
  });
});
