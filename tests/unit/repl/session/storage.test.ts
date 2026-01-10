/**
 * Unit tests for HQL REPL Session Storage
 * Tests: hashProjectPath, generateSessionId, CRUD operations
 */

import { assertEquals, assert, assertExists } from "jsr:@std/assert";
import { join } from "jsr:@std/path@1";
import {
  hashProjectPath,
  generateSessionId,
  createSession,
  appendMessage,
  loadSession,
  listSessions,
  getLastSession,
  deleteSession,
  updateTitle,
  exportSession,
} from "../../../../src/cli/repl/session/storage.ts";

// ============================================================================
// Test Helpers
// ============================================================================

/** Get test sessions directory */
function getTestSessionsDir(): string {
  return join(Deno.env.get("HOME") || ".", ".hql", "sessions");
}

/** Clean up test sessions */
async function cleanupTestSessions(projectHash: string): Promise<void> {
  const projectDir = join(getTestSessionsDir(), projectHash);
  try {
    await Deno.remove(projectDir, { recursive: true });
  } catch {
    // Ignore if doesn't exist
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

Deno.test("generateSessionId: has underscore separator", () => {
  const id = generateSessionId();
  assert(id.includes("_"), "Session ID should contain underscore separator");
});

// ============================================================================
// createSession() Tests
// ============================================================================

Deno.test("createSession: creates session with correct metadata", async () => {
  const testPath = "/tmp/test-project-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  try {
    const meta = await createSession(testPath, "Test Session");

    assertExists(meta.id);
    assertEquals(meta.projectHash, projectHash);
    assertEquals(meta.projectPath, testPath);
    assertEquals(meta.title, "Test Session");
    assertEquals(meta.messageCount, 0);
    assert(meta.createdAt > 0);
    assert(meta.updatedAt > 0);

    // Verify session file was created
    const sessionPath = join(getTestSessionsDir(), projectHash, `${meta.id}.jsonl`);
    const stat = await Deno.stat(sessionPath);
    assert(stat.isFile);
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("createSession: generates default title if not provided", async () => {
  const testPath = "/tmp/test-project-default-title-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  try {
    const meta = await createSession(testPath);

    assert(meta.title.startsWith("Session at "), "Should have default title");
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

// ============================================================================
// appendMessage() Tests
// ============================================================================

Deno.test("appendMessage: appends message and updates count", async () => {
  const testPath = "/tmp/test-project-append-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  try {
    const meta = await createSession(testPath, "Append Test");

    await appendMessage(projectHash, meta.id, "user", "(def x 10)");
    await appendMessage(projectHash, meta.id, "assistant", "10");

    const session = await loadSession(projectHash, meta.id);
    assertExists(session);
    assertEquals(session.messages.length, 2);
    assertEquals(session.messages[0].role, "user");
    assertEquals(session.messages[0].content, "(def x 10)");
    assertEquals(session.messages[1].role, "assistant");
    assertEquals(session.messages[1].content, "10");
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("appendMessage: preserves message order", async () => {
  const testPath = "/tmp/test-project-order-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  try {
    const meta = await createSession(testPath, "Order Test");

    await appendMessage(projectHash, meta.id, "user", "first");
    await appendMessage(projectHash, meta.id, "assistant", "second");
    await appendMessage(projectHash, meta.id, "user", "third");

    const session = await loadSession(projectHash, meta.id);
    assertExists(session);
    assertEquals(session.messages.length, 3);
    assertEquals(session.messages[0].content, "first");
    assertEquals(session.messages[1].content, "second");
    assertEquals(session.messages[2].content, "third");
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("appendMessage: handles attachments", async () => {
  const testPath = "/tmp/test-project-attachments-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  try {
    const meta = await createSession(testPath, "Attachment Test");

    await appendMessage(projectHash, meta.id, "user", "Check this file", [
      "/path/to/file.txt",
    ]);

    const session = await loadSession(projectHash, meta.id);
    assertExists(session);
    assertEquals(session.messages[0].attachments?.length, 1);
    assertEquals(session.messages[0].attachments?.[0], "/path/to/file.txt");
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

// ============================================================================
// loadSession() Tests
// ============================================================================

Deno.test("loadSession: returns null for non-existent session", async () => {
  const session = await loadSession("nonexistent", "nonexistent_12345_abcd");
  assertEquals(session, null);
});

Deno.test("loadSession: loads session with all messages", async () => {
  const testPath = "/tmp/test-project-load-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  try {
    const meta = await createSession(testPath, "Load Test");

    await appendMessage(projectHash, meta.id, "user", "Hello");
    await appendMessage(projectHash, meta.id, "assistant", "Hi there!");

    const session = await loadSession(projectHash, meta.id);
    assertExists(session);
    assertEquals(session.meta.id, meta.id);
    assertEquals(session.meta.title, "Load Test");
    assertEquals(session.messages.length, 2);
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

// ============================================================================
// listSessions() Tests
// ============================================================================

Deno.test("listSessions: returns empty array when no sessions", async () => {
  const projectHash = hashProjectPath("/nonexistent/project/" + Date.now());
  const sessions = await listSessions({ projectHash });
  assertEquals(sessions.length, 0);
});

Deno.test("listSessions: filters by project hash", async () => {
  const testPath1 = "/tmp/test-project-list-a-" + Date.now();
  const testPath2 = "/tmp/test-project-list-b-" + Date.now();
  const projectHash1 = hashProjectPath(testPath1);
  const projectHash2 = hashProjectPath(testPath2);

  try {
    await createSession(testPath1, "Session A1");
    await createSession(testPath1, "Session A2");
    await createSession(testPath2, "Session B1");

    const sessionsA = await listSessions({ projectHash: projectHash1 });
    const sessionsB = await listSessions({ projectHash: projectHash2 });

    assertEquals(sessionsA.length, 2);
    assertEquals(sessionsB.length, 1);
  } finally {
    await cleanupTestSessions(projectHash1);
    await cleanupTestSessions(projectHash2);
  }
});

Deno.test("listSessions: sorts by recent first (default)", async () => {
  const testPath = "/tmp/test-project-sort-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  try {
    const meta1 = await createSession(testPath, "First");
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    const meta2 = await createSession(testPath, "Second");

    const sessions = await listSessions({ projectHash, sortOrder: "recent" });

    assertEquals(sessions.length, 2);
    assertEquals(sessions[0].title, "Second"); // Most recent first
    assertEquals(sessions[1].title, "First");
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("listSessions: respects limit option", async () => {
  const testPath = "/tmp/test-project-limit-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  try {
    await createSession(testPath, "Session 1");
    await createSession(testPath, "Session 2");
    await createSession(testPath, "Session 3");

    const sessions = await listSessions({ projectHash, limit: 2 });

    assertEquals(sessions.length, 2);
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

// ============================================================================
// getLastSession() Tests
// ============================================================================

Deno.test("getLastSession: returns most recent session", async () => {
  const testPath = "/tmp/test-project-last-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  try {
    await createSession(testPath, "First Session");
    await new Promise((r) => setTimeout(r, 10));
    await createSession(testPath, "Last Session");

    const last = await getLastSession(testPath);
    assertExists(last);
    assertEquals(last.title, "Last Session");
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("getLastSession: returns null for project with no sessions", async () => {
  const testPath = "/tmp/nonexistent-project-" + Date.now();
  const last = await getLastSession(testPath);
  assertEquals(last, null);
});

// ============================================================================
// deleteSession() Tests
// ============================================================================

Deno.test("deleteSession: removes session file and index entry", async () => {
  const testPath = "/tmp/test-project-delete-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  try {
    const meta = await createSession(testPath, "Delete Me");

    // Verify exists
    const sessionBefore = await loadSession(projectHash, meta.id);
    assertExists(sessionBefore);

    // Delete
    const result = await deleteSession(projectHash, meta.id);
    assert(result, "Delete should return true");

    // Verify gone
    const sessionAfter = await loadSession(projectHash, meta.id);
    assertEquals(sessionAfter, null);
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("deleteSession: returns false for non-existent session", async () => {
  const result = await deleteSession("nonexistent", "nonexistent_id");
  assertEquals(result, false);
});

// ============================================================================
// updateTitle() Tests
// ============================================================================

Deno.test("updateTitle: updates session title", async () => {
  const testPath = "/tmp/test-project-title-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  try {
    const meta = await createSession(testPath, "Original Title");

    await updateTitle(projectHash, meta.id, "New Title");

    const session = await loadSession(projectHash, meta.id);
    assertExists(session);
    assertEquals(session.meta.title, "New Title");
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

// ============================================================================
// exportSession() Tests
// ============================================================================

Deno.test("exportSession: generates markdown with messages", async () => {
  const testPath = "/tmp/test-project-export-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  try {
    const meta = await createSession(testPath, "Export Test");

    await appendMessage(projectHash, meta.id, "user", "Hello there");
    await appendMessage(projectHash, meta.id, "assistant", "Hi! How can I help?");

    const markdown = await exportSession(projectHash, meta.id);
    assertExists(markdown);
    assert(markdown.includes("# Export Test"));
    assert(markdown.includes("Hello there"));
    assert(markdown.includes("Hi! How can I help?"));
    assert(markdown.includes("**You**"));
    assert(markdown.includes("**Assistant**"));
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("exportSession: returns null for non-existent session", async () => {
  const markdown = await exportSession("nonexistent", "nonexistent_id");
  assertEquals(markdown, null);
});

// ============================================================================
// Edge Cases & Error Recovery
// ============================================================================

Deno.test("loadSession: handles empty session file gracefully", async () => {
  const testPath = "/tmp/test-project-empty-" + Date.now();
  const projectHash = hashProjectPath(testPath);
  const sessionId = generateSessionId();
  const sessionPath = join(getTestSessionsDir(), projectHash, `${sessionId}.jsonl`);

  try {
    // Create empty file
    await Deno.mkdir(join(getTestSessionsDir(), projectHash), { recursive: true });
    await Deno.writeTextFile(sessionPath, "");

    const session = await loadSession(projectHash, sessionId);
    assertEquals(session, null);
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("loadSession: recovers from corrupted lines", async () => {
  const testPath = "/tmp/test-project-corrupt-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  try {
    const meta = await createSession(testPath, "Corrupt Test");

    // Manually append a corrupted line
    const sessionPath = join(getTestSessionsDir(), projectHash, `${meta.id}.jsonl`);
    await Deno.writeTextFile(sessionPath, "not valid json\n", { append: true });

    // Append valid message after corruption
    await appendMessage(projectHash, meta.id, "user", "After corruption");

    const session = await loadSession(projectHash, meta.id);
    assertExists(session);
    assertEquals(session.messages.length, 1);
    assertEquals(session.messages[0].content, "After corruption");
  } finally {
    await cleanupTestSessions(projectHash);
  }
});
