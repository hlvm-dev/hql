/**
 * Unit tests for HLVM REPL Session Storage (Global Sessions)
 * Tests: hashProjectPath, generateSessionId, CRUD operations
 */

import { assertEquals, assert, assertExists } from "jsr:@std/assert";
import { join } from "jsr:@std/path@1";
import { getSessionsDir } from "../../../../src/common/paths.ts";
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
} from "../../../../src/hlvm/cli/repl/session/storage.ts";

// ============================================================================
// Test Helpers
// ============================================================================

/** Get test sessions directory */
function getTestSessionsDir(): string {
  return getSessionsDir();
}

/** Clean up a specific session file */
async function cleanupSession(sessionId: string): Promise<void> {
  const sessionPath = join(getTestSessionsDir(), `${sessionId}.jsonl`);
  try {
    await Deno.remove(sessionPath);
  } catch {
    // Ignore if doesn't exist
  }
}

/** Track created sessions for cleanup */
const createdSessionIds: string[] = [];

/** Cleanup all created sessions after tests */
async function cleanupAllSessions(): Promise<void> {
  for (const id of createdSessionIds) {
    await cleanupSession(id);
  }
  createdSessionIds.length = 0;
}

// ============================================================================
// hashProjectPath() Tests (still used for metadata)
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
  const testPath = "/tmp/test-project-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const meta = await createSession(testPath, "Test Session");
  createdSessionIds.push(meta.id);

  try {
    assertExists(meta.id);
    assertEquals(meta.projectHash, projectHash);
    assertEquals(meta.projectPath, testPath);
    assertEquals(meta.title, "Test Session");
    assertEquals(meta.messageCount, 0);
    assert(meta.createdAt > 0);
    assert(meta.updatedAt > 0);

    // Verify session file was created (global path, no project subdirectory)
    const sessionPath = join(getTestSessionsDir(), `${meta.id}.jsonl`);
    const stat = await Deno.stat(sessionPath);
    assert(stat.isFile);
  } finally {
    await cleanupSession(meta.id);
  }
});

Deno.test("createSession: generates default title if not provided", async () => {
  const testPath = "/tmp/test-project-default-title-" + Date.now();

  const meta = await createSession(testPath);
  createdSessionIds.push(meta.id);

  try {
    assert(meta.title.startsWith("Session at "), "Should have default title");
  } finally {
    await cleanupSession(meta.id);
  }
});

// ============================================================================
// appendMessage() Tests
// ============================================================================

Deno.test("appendMessage: appends message and updates count", async () => {
  const testPath = "/tmp/test-project-append-" + Date.now();

  const meta = await createSession(testPath, "Append Test");
  createdSessionIds.push(meta.id);

  try {
    await appendMessage(meta.id, "user", "(def x 10)");
    await appendMessage(meta.id, "assistant", "10");

    const session = await loadSession(meta.id);
    assertExists(session);
    assertEquals(session.messages.length, 2);
    assertEquals(session.messages[0].role, "user");
    assertEquals(session.messages[0].content, "(def x 10)");
    assertEquals(session.messages[1].role, "assistant");
    assertEquals(session.messages[1].content, "10");
  } finally {
    await cleanupSession(meta.id);
  }
});

Deno.test("appendMessage: handles attachments", async () => {
  const testPath = "/tmp/test-project-attachments-" + Date.now();

  const meta = await createSession(testPath, "Attachment Test");
  createdSessionIds.push(meta.id);

  try {
    await appendMessage(meta.id, "user", "Check this file", [
      "/path/to/file.txt",
    ]);

    const session = await loadSession(meta.id);
    assertExists(session);
    assertEquals(session.messages[0].attachments?.length, 1);
    assertEquals(session.messages[0].attachments?.[0], "/path/to/file.txt");
  } finally {
    await cleanupSession(meta.id);
  }
});

// ============================================================================
// loadSession() Tests
// ============================================================================

Deno.test("loadSession: returns null for non-existent session", async () => {
  const session = await loadSession("nonexistent_12345_abcd");
  assertEquals(session, null);
});

// ============================================================================
// listSessions() Tests (Global - no project filtering)
// ============================================================================

Deno.test("listSessions: returns empty array when no sessions", async () => {
  // Clean all sessions first
  const allSessions = await listSessions({ limit: 1000 });
  for (const s of allSessions) {
    await deleteSession(s.id);
  }

  const sessions = await listSessions();
  assertEquals(sessions.length, 0);
});

Deno.test("listSessions: lists all sessions globally", async () => {
  // Clean all sessions first
  const allSessions = await listSessions({ limit: 1000 });
  for (const s of allSessions) {
    await deleteSession(s.id);
  }

  const testPath1 = "/tmp/test-project-list-a-" + Date.now();
  const testPath2 = "/tmp/test-project-list-b-" + Date.now();

  const meta1 = await createSession(testPath1, "Session A1");
  createdSessionIds.push(meta1.id);
  const meta2 = await createSession(testPath1, "Session A2");
  createdSessionIds.push(meta2.id);
  const meta3 = await createSession(testPath2, "Session B1");
  createdSessionIds.push(meta3.id);

  try {
    // All sessions are visible globally
    const sessions = await listSessions();
    assertEquals(sessions.length, 3);
  } finally {
    await cleanupSession(meta1.id);
    await cleanupSession(meta2.id);
    await cleanupSession(meta3.id);
  }
});

Deno.test("listSessions: sorts by recent first (default)", async () => {
  // Clean all sessions first
  const allSessions = await listSessions({ limit: 1000 });
  for (const s of allSessions) {
    await deleteSession(s.id);
  }

  const testPath = "/tmp/test-project-sort-" + Date.now();

  const meta1 = await createSession(testPath, "First");
  createdSessionIds.push(meta1.id);
  // Small delay to ensure different timestamps
  await new Promise((r) => setTimeout(r, 10));
  const meta2 = await createSession(testPath, "Second");
  createdSessionIds.push(meta2.id);

  try {
    const sessions = await listSessions({ sortOrder: "recent" });

    assertEquals(sessions.length, 2);
    assertEquals(sessions[0].title, "Second"); // Most recent first
    assertEquals(sessions[1].title, "First");
  } finally {
    await cleanupSession(meta1.id);
    await cleanupSession(meta2.id);
  }
});

Deno.test("listSessions: respects limit option", async () => {
  // Clean all sessions first
  const allSessions = await listSessions({ limit: 1000 });
  for (const s of allSessions) {
    await deleteSession(s.id);
  }

  const testPath = "/tmp/test-project-limit-" + Date.now();

  const meta1 = await createSession(testPath, "Session 1");
  createdSessionIds.push(meta1.id);
  const meta2 = await createSession(testPath, "Session 2");
  createdSessionIds.push(meta2.id);
  const meta3 = await createSession(testPath, "Session 3");
  createdSessionIds.push(meta3.id);

  try {
    const sessions = await listSessions({ limit: 2 });
    assertEquals(sessions.length, 2);
  } finally {
    await cleanupSession(meta1.id);
    await cleanupSession(meta2.id);
    await cleanupSession(meta3.id);
  }
});

// ============================================================================
// getLastSession() Tests
// ============================================================================

Deno.test("getLastSession: returns null when no sessions", async () => {
  // Clean all sessions first
  const allSessions = await listSessions({ limit: 1000 });
  for (const s of allSessions) {
    await deleteSession(s.id);
  }

  const last = await getLastSession();
  assertEquals(last, null);
});

// ============================================================================
// deleteSession() Tests
// ============================================================================

Deno.test("deleteSession: removes session file and index entry", async () => {
  const testPath = "/tmp/test-project-delete-" + Date.now();

  const meta = await createSession(testPath, "Delete Me");

  // Verify exists
  const sessionBefore = await loadSession(meta.id);
  assertExists(sessionBefore);

  // Delete
  const result = await deleteSession(meta.id);
  assert(result, "Delete should return true");

  // Verify gone
  const sessionAfter = await loadSession(meta.id);
  assertEquals(sessionAfter, null);
});

Deno.test("deleteSession: returns false for non-existent session", async () => {
  const result = await deleteSession("nonexistent_id");
  assertEquals(result, false);
});

// ============================================================================
// updateTitle() Tests
// ============================================================================

Deno.test("updateTitle: updates session title", async () => {
  const testPath = "/tmp/test-project-title-" + Date.now();

  const meta = await createSession(testPath, "Original Title");
  createdSessionIds.push(meta.id);

  try {
    await updateTitle(meta.id, "New Title");

    const session = await loadSession(meta.id);
    assertExists(session);
    assertEquals(session.meta.title, "New Title");
  } finally {
    await cleanupSession(meta.id);
  }
});

// ============================================================================
// exportSession() Tests
// ============================================================================

Deno.test("exportSession: generates markdown with messages", async () => {
  const testPath = "/tmp/test-project-export-" + Date.now();

  const meta = await createSession(testPath, "Export Test");
  createdSessionIds.push(meta.id);

  try {
    await appendMessage(meta.id, "user", "Hello there");
    await appendMessage(meta.id, "assistant", "Hi! How can I help?");

    const markdown = await exportSession(meta.id);
    assertExists(markdown);
    assert(markdown.includes("# Export Test"));
    assert(markdown.includes("Hello there"));
    assert(markdown.includes("Hi! How can I help?"));
    assert(markdown.includes("**You**"));
    assert(markdown.includes("**Assistant**"));
  } finally {
    await cleanupSession(meta.id);
  }
});

Deno.test("exportSession: returns null for non-existent session", async () => {
  const markdown = await exportSession("nonexistent_id");
  assertEquals(markdown, null);
});

// ============================================================================
// Edge Cases & Error Recovery
// ============================================================================

Deno.test("loadSession: handles empty session file gracefully", async () => {
  const sessionId = generateSessionId();
  const sessionPath = join(getTestSessionsDir(), `${sessionId}.jsonl`);

  try {
    // Create empty file directly in sessions directory
    const { ensureDir } = await import("jsr:@std/fs@1");
    await ensureDir(getTestSessionsDir());
    await Deno.writeTextFile(sessionPath, "");

    const session = await loadSession(sessionId);
    assertEquals(session, null);
  } finally {
    await cleanupSession(sessionId);
  }
});

Deno.test("loadSession: recovers from corrupted lines", async () => {
  const testPath = "/tmp/test-project-corrupt-" + Date.now();

  const meta = await createSession(testPath, "Corrupt Test");
  createdSessionIds.push(meta.id);

  try {
    // Manually append a corrupted line
    const sessionPath = join(getTestSessionsDir(), `${meta.id}.jsonl`);
    await Deno.writeTextFile(sessionPath, "not valid json\n", { append: true });

    // Append valid message after corruption
    await appendMessage(meta.id, "user", "After corruption");

    const session = await loadSession(meta.id);
    assertExists(session);
    assertEquals(session.messages.length, 1);
    assertEquals(session.messages[0].content, "After corruption");
  } finally {
    await cleanupSession(meta.id);
  }
});
