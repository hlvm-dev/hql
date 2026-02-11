/**
 * Unit tests for HLVM REPL Session Storage (scoped sessions)
 * Tests: hashProjectPath, generateSessionId, CRUD operations
 */

import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import {
  appendMessage,
  createSession,
  deleteSession,
  exportSession,
  generateSessionId,
  getLastSession,
  hashProjectPath,
  listSessions,
  loadSession,
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

// ============================================================================
// hashProjectPath() Tests
// ============================================================================

Deno.test("hashProjectPath: returns consistent hash for same input", () => {
  const hash1 = hashProjectPath("/Users/dev/project");
  const hash2 = hashProjectPath("/Users/dev/project");
  assertEquals(hash1, hash2);
});

Deno.test("hashProjectPath: returns different hash for different inputs", () => {
  const hash1 = hashProjectPath("/Users/dev/project1");
  const hash2 = hashProjectPath("/Users/dev/project2");
  assert(hash1 !== hash2, "Hashes should be different for different paths");
});

Deno.test("hashProjectPath: returns 8-character hex string", () => {
  const hash = hashProjectPath("/some/path");
  assertEquals(hash.length, 8);
  assert(/^[0-9a-f]+$/.test(hash), "Hash should be hexadecimal");
});

Deno.test("hashProjectPath: handles empty string", () => {
  const hash = hashProjectPath("");
  assertEquals(hash.length, 8);
  assert(/^[0-9a-f]+$/.test(hash));
});

Deno.test("hashProjectPath: handles unicode paths", () => {
  const hash = hashProjectPath("/Users/dev/项目");
  assertEquals(hash.length, 8);
  assert(/^[0-9a-f]+$/.test(hash));
});

// ============================================================================
// generateSessionId() Tests
// ============================================================================

Deno.test("generateSessionId: generates unique IDs", () => {
  const id1 = generateSessionId();
  const id2 = generateSessionId();
  assert(id1 !== id2, "Session IDs should be unique");
});

Deno.test("generateSessionId: includes timestamp component", () => {
  const before = Date.now();
  const id = generateSessionId();
  const after = Date.now();

  const timestampPart = parseInt(id.split("_")[0], 10);
  assert(timestampPart >= before, "Timestamp should be >= start time");
  assert(timestampPart <= after, "Timestamp should be <= end time");
});

// ============================================================================
// createSession() Tests
// ============================================================================

Deno.test("createSession: creates session with correct metadata", async () => {
  await withScope(async (scope) => {
    const platform = getPlatform();
    const testPath = `/tmp/test-project-${Date.now()}`;
    const projectHash = hashProjectPath(testPath);

    const meta = await createSession(testPath, "Test Session", scope);

    assertExists(meta.id);
    assertEquals(meta.projectHash, projectHash);
    assertEquals(meta.projectPath, testPath);
    assertEquals(meta.title, "Test Session");
    assertEquals(meta.messageCount, 0);
    assert(meta.createdAt > 0);
    assert(meta.updatedAt > 0);

    const sessionPath = platform.path.join(scope.sessionsDir!, `${meta.id}.jsonl`);
    const stat = await platform.fs.stat(sessionPath);
    assert(stat.isFile);
  });
});

Deno.test("createSession: generates default title if not provided", async () => {
  await withScope(async (scope) => {
    const testPath = `/tmp/test-project-default-title-${Date.now()}`;
    const meta = await createSession(testPath, undefined, scope);
    assert(meta.title.startsWith("Session at "), "Should have default title");
  });
});

// ============================================================================
// appendMessage() Tests
// ============================================================================

Deno.test("appendMessage: appends message and updates count", async () => {
  await withScope(async (scope) => {
    const testPath = `/tmp/test-project-append-${Date.now()}`;
    const meta = await createSession(testPath, "Append Test", scope);

    await appendMessage(meta.id, "user", "(def x 10)", undefined, scope);
    await appendMessage(meta.id, "assistant", "10", undefined, scope);

    const session = await loadSession(meta.id, scope);
    assertExists(session);
    assertEquals(session.messages.length, 2);
    assertEquals(session.messages[0].role, "user");
    assertEquals(session.messages[0].content, "(def x 10)");
    assertEquals(session.messages[1].role, "assistant");
    assertEquals(session.messages[1].content, "10");
  });
});

Deno.test("appendMessage: handles attachments", async () => {
  await withScope(async (scope) => {
    const testPath = `/tmp/test-project-attachments-${Date.now()}`;
    const meta = await createSession(testPath, "Attachment Test", scope);

    await appendMessage(meta.id, "user", "Check this file", ["/path/to/file.txt"], scope);

    const session = await loadSession(meta.id, scope);
    assertExists(session);
    assertEquals(session.messages[0].attachments?.length, 1);
    assertEquals(session.messages[0].attachments?.[0], "/path/to/file.txt");
  });
});

// ============================================================================
// loadSession() Tests
// ============================================================================

Deno.test("loadSession: returns null for non-existent session", async () => {
  await withScope(async (scope) => {
    const session = await loadSession("nonexistent_12345_abcd", scope);
    assertEquals(session, null);
  });
});

// ============================================================================
// listSessions() Tests
// ============================================================================

Deno.test("listSessions: returns empty array when no sessions", async () => {
  await withScope(async (scope) => {
    const sessions = await listSessions({}, scope);
    assertEquals(sessions.length, 0);
  });
});

Deno.test("listSessions: lists all sessions globally", async () => {
  await withScope(async (scope) => {
    const testPath1 = `/tmp/test-project-list-a-${Date.now()}`;
    const testPath2 = `/tmp/test-project-list-b-${Date.now()}`;

    await createSession(testPath1, "Session A1", scope);
    await createSession(testPath1, "Session A2", scope);
    await createSession(testPath2, "Session B1", scope);

    const sessions = await listSessions({}, scope);
    assertEquals(sessions.length, 3);
  });
});

Deno.test("listSessions: sorts by recent first (default)", async () => {
  await withScope(async (scope) => {
    const testPath = `/tmp/test-project-sort-${Date.now()}`;

    await createSession(testPath, "First", scope);
    await new Promise((r) => setTimeout(r, 10));
    await createSession(testPath, "Second", scope);

    const sessions = await listSessions({ sortOrder: "recent" }, scope);
    assertEquals(sessions.length, 2);
    assertEquals(sessions[0].title, "Second");
    assertEquals(sessions[1].title, "First");
  });
});

Deno.test("listSessions: respects limit option", async () => {
  await withScope(async (scope) => {
    const testPath = `/tmp/test-project-limit-${Date.now()}`;
    await createSession(testPath, "Session 1", scope);
    await createSession(testPath, "Session 2", scope);
    await createSession(testPath, "Session 3", scope);

    const sessions = await listSessions({ limit: 2 }, scope);
    assertEquals(sessions.length, 2);
  });
});

// ============================================================================
// getLastSession() Tests
// ============================================================================

Deno.test("getLastSession: returns null when no sessions", async () => {
  await withScope(async (scope) => {
    const last = await getLastSession(scope);
    assertEquals(last, null);
  });
});

// ============================================================================
// deleteSession() Tests
// ============================================================================

Deno.test("deleteSession: removes session file and index entry", async () => {
  await withScope(async (scope) => {
    const testPath = `/tmp/test-project-delete-${Date.now()}`;
    const meta = await createSession(testPath, "Delete Me", scope);

    const sessionBefore = await loadSession(meta.id, scope);
    assertExists(sessionBefore);

    const result = await deleteSession(meta.id, scope);
    assert(result, "Delete should return true");

    const sessionAfter = await loadSession(meta.id, scope);
    assertEquals(sessionAfter, null);
  });
});

Deno.test("deleteSession: returns false for non-existent session", async () => {
  await withScope(async (scope) => {
    const result = await deleteSession("nonexistent_id", scope);
    assertEquals(result, false);
  });
});

// ============================================================================
// updateTitle() Tests
// ============================================================================

Deno.test("updateTitle: updates session title", async () => {
  await withScope(async (scope) => {
    const testPath = `/tmp/test-project-title-${Date.now()}`;
    const meta = await createSession(testPath, "Original Title", scope);

    await updateTitle(meta.id, "New Title", scope);

    const session = await loadSession(meta.id, scope);
    assertExists(session);
    assertEquals(session.meta.title, "New Title");
  });
});

// ============================================================================
// exportSession() Tests
// ============================================================================

Deno.test("exportSession: generates markdown with messages", async () => {
  await withScope(async (scope) => {
    const testPath = `/tmp/test-project-export-${Date.now()}`;
    const meta = await createSession(testPath, "Export Test", scope);

    await appendMessage(meta.id, "user", "Hello there", undefined, scope);
    await appendMessage(meta.id, "assistant", "Hi! How can I help?", undefined, scope);

    const markdown = await exportSession(meta.id, scope);
    assertExists(markdown);
    assert(markdown.includes("# Export Test"));
    assert(markdown.includes("Hello there"));
    assert(markdown.includes("Hi! How can I help?"));
    assert(markdown.includes("**You**"));
    assert(markdown.includes("**Assistant**"));
  });
});

Deno.test("exportSession: returns null for non-existent session", async () => {
  await withScope(async (scope) => {
    const markdown = await exportSession("nonexistent_id", scope);
    assertEquals(markdown, null);
  });
});

// ============================================================================
// Edge Cases & Error Recovery
// ============================================================================

Deno.test("loadSession: handles empty session file gracefully", async () => {
  await withScope(async (scope) => {
    const platform = getPlatform();
    const sessionId = generateSessionId();
    const sessionPath = platform.path.join(scope.sessionsDir!, `${sessionId}.jsonl`);

    await platform.fs.writeTextFile(sessionPath, "");

    const session = await loadSession(sessionId, scope);
    assertEquals(session, null);
  });
});

Deno.test("loadSession: recovers from corrupted lines", async () => {
  await withScope(async (scope) => {
    const platform = getPlatform();
    const testPath = `/tmp/test-project-corrupt-${Date.now()}`;
    const meta = await createSession(testPath, "Corrupt Test", scope);

    const sessionPath = platform.path.join(scope.sessionsDir!, `${meta.id}.jsonl`);
    await platform.fs.writeTextFile(sessionPath, "not valid json\n", { append: true });

    await appendMessage(meta.id, "user", "After corruption", undefined, scope);

    const session = await loadSession(meta.id, scope);
    assertExists(session);
    assertEquals(session.messages.length, 1);
    assertEquals(session.messages[0].content, "After corruption");
  });
});
