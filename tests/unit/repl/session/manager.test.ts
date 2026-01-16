/**
 * Unit tests for HQL REPL Session Manager (Global Sessions)
 * Tests: lifecycle, recording, session operations
 */

import { assertEquals, assert, assertExists, assertRejects } from "jsr:@std/assert";
import { join } from "jsr:@std/path@1";
import { getSessionsDir } from "../../../../src/common/paths.ts";
import { SessionManager } from "../../../../src/cli/repl/session/manager.ts";
import { listSessions, deleteSession } from "../../../../src/cli/repl/session/storage.ts";

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

/** Clean all sessions */
async function cleanupAllSessions(): Promise<void> {
  const allSessions = await listSessions({ limit: 1000 });
  for (const s of allSessions) {
    await deleteSession(s.id);
  }
}

// ============================================================================
// Constructor Tests
// ============================================================================

Deno.test("SessionManager: constructor sets project path", () => {
  const testPath = "/tmp/test-project-" + Date.now();
  const manager = new SessionManager(testPath);

  assertEquals(manager.getProjectPath(), testPath);
  assertEquals(manager.isInitialized(), false);
  assertEquals(manager.hasActiveSession(), false);
});

Deno.test("SessionManager: constructor defaults to cwd", () => {
  const manager = new SessionManager();

  assertEquals(manager.getProjectPath(), Deno.cwd());
});

// ============================================================================
// initialize() Tests
// ============================================================================

Deno.test("SessionManager: initialize creates new session by default", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-init-" + Date.now();
  const manager = new SessionManager(testPath);

  let sessionId: string | undefined;
  try {
    const session = (await manager.initialize({ forceNew: true }))!;
    sessionId = session.id;

    assertExists(session.id);
    assertEquals(session.projectPath, testPath);
    assertEquals(session.messageCount, 0);
    assert(manager.isInitialized());
    assert(manager.hasActiveSession());
  } finally {
    await manager.close();
    if (sessionId) await cleanupSession(sessionId);
  }
});

Deno.test("SessionManager: initialize with continue resumes last session", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-continue-" + Date.now();

  // First manager creates a session
  const manager1 = new SessionManager(testPath);
  try {
    const session1 = (await manager1.initialize({ forceNew: true }))!;
    await manager1.recordMessage("user", "Hello");
    await manager1.close();

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));

    // Second manager with --continue should resume (global - gets last session)
    const manager2 = new SessionManager(testPath);
    const session2 = (await manager2.initialize({ continue: true }))!;

    assertEquals(session2.id, session1.id);
    assertEquals(session2.messageCount, 1);
    await manager2.close();

    await cleanupSession(session1.id);
  } catch (e) {
    await manager1.close();
    throw e;
  }
});

Deno.test("SessionManager: initialize with resumeId resumes specific session", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-resume-" + Date.now();

  const manager1 = new SessionManager(testPath);
  let session1Id: string | undefined;
  let session2Id: string | undefined;

  try {
    // Create first session
    const session1 = (await manager1.initialize({ forceNew: true }))!;
    session1Id = session1.id;
    await manager1.recordMessage("user", "First session");
    await manager1.close();

    // Create second session
    const manager2 = new SessionManager(testPath);
    const session2 = await manager2.newSession("Second");
    session2Id = session2.id;
    await manager2.recordMessage("user", "Second session");
    await manager2.close();

    // Resume first session by ID
    const manager3 = new SessionManager(testPath);
    const session3 = (await manager3.initialize({ resumeId: session1Id }))!;

    assertEquals(session3.id, session1Id);
    assertEquals(session3.messageCount, 1);
    await manager3.close();
  } finally {
    if (session1Id) await cleanupSession(session1Id);
    if (session2Id) await cleanupSession(session2Id);
  }
});

Deno.test("SessionManager: initialize defers if resumeId not found", async () => {
  const testPath = "/tmp/test-manager-resume-notfound-" + Date.now();

  const manager = new SessionManager(testPath);
  try {
    // When resumeId not found, falls through to deferred mode (returns null)
    const session = await manager.initialize({ resumeId: "nonexistent_id" });

    assertEquals(session, null);
    assert(manager.isInitialized());
    assertEquals(manager.hasActiveSession(), false); // Deferred, no active session yet
  } finally {
    await manager.close();
  }
});

Deno.test("SessionManager: initialize defers if no previous session for continue", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-continue-new-" + Date.now();

  const manager = new SessionManager(testPath);
  try {
    // When no previous session, falls through to deferred mode (returns null)
    const session = await manager.initialize({ continue: true });

    assertEquals(session, null);
    assert(manager.isInitialized());
    assertEquals(manager.hasActiveSession(), false); // Deferred, no active session yet
  } finally {
    await manager.close();
  }
});

// ============================================================================
// recordMessage() Tests
// ============================================================================

Deno.test("SessionManager: recordMessage appends to session", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-record-" + Date.now();

  const manager = new SessionManager(testPath);
  try {
    await manager.initialize({ forceNew: true });

    await manager.recordMessage("user", "(def x 10)");
    await manager.recordMessage("assistant", "10");

    // Verify messages were recorded
    const messages = await manager.getSessionMessages();
    assertEquals(messages.length, 2);
    assertEquals(messages[0].role, "user");
    assertEquals(messages[0].content, "(def x 10)");
    assertEquals(messages[1].role, "assistant");
    assertEquals(messages[1].content, "10");

    // Verify local metadata updated
    const current = manager.getCurrentSession();
    assertEquals(current?.messageCount, 2);
  } finally {
    const sessionId = manager.getCurrentSession()?.id;
    await manager.close();
    if (sessionId) await cleanupSession(sessionId);
  }
});

Deno.test("SessionManager: recordMessage throws if not initialized", async () => {
  const manager = new SessionManager("/tmp/test");

  await assertRejects(
    async () => {
      await manager.recordMessage("user", "Hello");
    },
    Error,
    "not initialized"
  );
});

// ============================================================================
// newSession() Tests
// ============================================================================

Deno.test("SessionManager: newSession creates new session", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-new-" + Date.now();

  const manager = new SessionManager(testPath);
  let session1Id: string | undefined;
  let session2Id: string | undefined;

  try {
    const session1 = (await manager.initialize({ forceNew: true }))!;
    session1Id = session1.id;
    await manager.recordMessage("user", "Session 1");

    const session2 = await manager.newSession("New Session");
    session2Id = session2.id;

    assert(session2.id !== session1.id);
    assertEquals(session2.title, "New Session");
    assertEquals(session2.messageCount, 0);
    assertEquals(manager.getCurrentSession()?.id, session2.id);
  } finally {
    await manager.close();
    if (session1Id) await cleanupSession(session1Id);
    if (session2Id) await cleanupSession(session2Id);
  }
});

// ============================================================================
// resumeSession() Tests
// ============================================================================

Deno.test("SessionManager: resumeSession switches to existing session", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-switch-" + Date.now();

  const manager = new SessionManager(testPath);
  let session1Id: string | undefined;
  let session2Id: string | undefined;

  try {
    // Create first session
    const session1 = (await manager.initialize({ forceNew: true }))!;
    session1Id = session1.id;
    await manager.recordMessage("user", "Message in session 1");

    // Create second session
    const session2 = await manager.newSession("Session 2");
    session2Id = session2.id;
    await manager.recordMessage("user", "Message in session 2");

    // Switch back to first session
    const resumed = await manager.resumeSession(session1.id);

    assertExists(resumed);
    assertEquals(resumed!.meta.id, session1.id);
    assertEquals(resumed!.messages.length, 1);
    assertEquals(resumed!.messages[0].content, "Message in session 1");
    assertEquals(manager.getCurrentSession()?.id, session1.id);
  } finally {
    await manager.close();
    if (session1Id) await cleanupSession(session1Id);
    if (session2Id) await cleanupSession(session2Id);
  }
});

Deno.test("SessionManager: resumeSession returns null for non-existent", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-resume-null-" + Date.now();

  const manager = new SessionManager(testPath);
  try {
    await manager.initialize({ forceNew: true });

    const result = await manager.resumeSession("nonexistent_id");

    assertEquals(result, null);
  } finally {
    const sessionId = manager.getCurrentSession()?.id;
    await manager.close();
    if (sessionId) await cleanupSession(sessionId);
  }
});

// ============================================================================
// list() Tests
// ============================================================================

Deno.test("SessionManager: list returns all sessions globally", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-list-" + Date.now();

  const manager = new SessionManager(testPath);
  let sessionIds: string[] = [];

  try {
    const s1 = (await manager.initialize({ forceNew: true }))!;
    sessionIds.push(s1.id);
    // Add delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    const s2 = await manager.newSession("Session 2");
    sessionIds.push(s2.id);
    await new Promise((r) => setTimeout(r, 10));
    const s3 = await manager.newSession("Session 3");
    sessionIds.push(s3.id);

    const sessions = await manager.list();

    assertEquals(sessions.length, 3);
    // Should be sorted by recent first
    assertEquals(sessions[0].title, "Session 3");
  } finally {
    await manager.close();
    for (const id of sessionIds) {
      await cleanupSession(id);
    }
  }
});

// ============================================================================
// deleteSession() Tests
// ============================================================================

Deno.test("SessionManager: deleteSession removes session", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-delete-" + Date.now();

  const manager = new SessionManager(testPath);
  let session2Id: string | undefined;

  try {
    const session1 = (await manager.initialize({ forceNew: true }))!;
    const session2 = await manager.newSession("Session 2");
    session2Id = session2.id;

    const result = await manager.deleteSession(session1.id);

    assert(result);

    const sessions = await manager.list();
    assertEquals(sessions.length, 1);
    assertEquals(sessions[0].id, session2.id);
  } finally {
    await manager.close();
    if (session2Id) await cleanupSession(session2Id);
  }
});

Deno.test("SessionManager: deleteSession clears current if deleting active", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-delete-current-" + Date.now();

  const manager = new SessionManager(testPath);
  try {
    const session = (await manager.initialize({ forceNew: true }))!;

    await manager.deleteSession(session.id);

    assertEquals(manager.getCurrentSession(), null);
    assertEquals(manager.hasActiveSession(), false);
  } finally {
    await manager.close();
  }
});

// ============================================================================
// renameSession() Tests
// ============================================================================

Deno.test("SessionManager: renameSession updates title", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-rename-" + Date.now();

  const manager = new SessionManager(testPath);
  try {
    await manager.initialize({ forceNew: true });

    await manager.renameSession("New Title");

    assertEquals(manager.getCurrentSession()?.title, "New Title");

    // Verify persisted
    const sessions = await manager.list();
    assertEquals(sessions[0].title, "New Title");
  } finally {
    const sessionId = manager.getCurrentSession()?.id;
    await manager.close();
    if (sessionId) await cleanupSession(sessionId);
  }
});

Deno.test("SessionManager: renameSession throws if no active session", async () => {
  const manager = new SessionManager("/tmp/test");

  await assertRejects(
    async () => {
      await manager.renameSession("New Title");
    },
    Error,
    "No active session"
  );
});

// ============================================================================
// Getters Tests
// ============================================================================

Deno.test("SessionManager: getSessionMessages returns empty for new session", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-messages-" + Date.now();

  const manager = new SessionManager(testPath);
  try {
    await manager.initialize({ forceNew: true });

    const messages = await manager.getSessionMessages();

    assertEquals(messages.length, 0);
  } finally {
    const sessionId = manager.getCurrentSession()?.id;
    await manager.close();
    if (sessionId) await cleanupSession(sessionId);
  }
});

Deno.test("SessionManager: getSessionMessages returns empty if not initialized", async () => {
  const manager = new SessionManager("/tmp/test");

  const messages = await manager.getSessionMessages();

  assertEquals(messages.length, 0);
});

// ============================================================================
// close() Tests
// ============================================================================

Deno.test("SessionManager: close resets initialized state", async () => {
  await cleanupAllSessions();
  const testPath = "/tmp/test-manager-close-" + Date.now();

  const manager = new SessionManager(testPath);
  try {
    await manager.initialize({ forceNew: true });
    assert(manager.isInitialized());

    const sessionId = manager.getCurrentSession()?.id;
    await manager.close();

    assertEquals(manager.isInitialized(), false);

    if (sessionId) await cleanupSession(sessionId);
  } catch (e) {
    await manager.close();
    throw e;
  }
});
