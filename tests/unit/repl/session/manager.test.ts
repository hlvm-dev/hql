/**
 * Unit tests for HQL REPL Session Manager
 * Tests: lifecycle, recording, session operations
 */

import { assertEquals, assert, assertExists, assertRejects } from "jsr:@std/assert";
import { join } from "jsr:@std/path@1";
import { SessionManager } from "../../../../src/cli/repl/session/manager.ts";
import { hashProjectPath } from "../../../../src/cli/repl/session/storage.ts";

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
// Constructor Tests
// ============================================================================

Deno.test("SessionManager: constructor sets project path and hash", () => {
  const testPath = "/tmp/test-project-" + Date.now();
  const manager = new SessionManager(testPath);

  assertEquals(manager.getProjectPath(), testPath);
  assertEquals(manager.getProjectHash(), hashProjectPath(testPath));
  assertEquals(manager.isInitialized(), false);
  assertEquals(manager.hasActiveSession(), false);
});

Deno.test("SessionManager: constructor defaults to cwd", () => {
  const manager = new SessionManager();

  assertEquals(manager.getProjectPath(), Deno.cwd());
  assertEquals(manager.getProjectHash(), hashProjectPath(Deno.cwd()));
});

// ============================================================================
// initialize() Tests
// ============================================================================

Deno.test("SessionManager: initialize creates new session by default", async () => {
  const testPath = "/tmp/test-manager-init-" + Date.now();
  const projectHash = hashProjectPath(testPath);
  const manager = new SessionManager(testPath);

  try {
    const session = (await manager.initialize({ forceNew: true }))!;

    assertExists(session.id);
    assertEquals(session.projectHash, projectHash);
    assertEquals(session.projectPath, testPath);
    assertEquals(session.messageCount, 0);
    assert(manager.isInitialized());
    assert(manager.hasActiveSession());
  } finally {
    await manager.close();
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("SessionManager: initialize with continue resumes last session", async () => {
  const testPath = "/tmp/test-manager-continue-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  // First manager creates a session
  const manager1 = new SessionManager(testPath);
  try {
    const session1 = (await manager1.initialize({ forceNew: true }))!;
    await manager1.recordMessage("user", "Hello");
    await manager1.close();

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));

    // Second manager with --continue should resume
    const manager2 = new SessionManager(testPath);
    const session2 = (await manager2.initialize({ continue: true }))!;

    assertEquals(session2.id, session1.id);
    assertEquals(session2.messageCount, 1);
    await manager2.close();
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("SessionManager: initialize with resumeId resumes specific session", async () => {
  const testPath = "/tmp/test-manager-resume-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager1 = new SessionManager(testPath);
  try {
    // Create first session
    const session1 = (await manager1.initialize({ forceNew: true }))!;
    await manager1.recordMessage("user", "First session");
    await manager1.close();

    // Create second session
    const manager2 = new SessionManager(testPath);
    await manager2.initialize({ forceNew: true });
    await manager2.recordMessage("user", "Second session");
    await manager2.close();

    // Resume first session by ID
    const manager3 = new SessionManager(testPath);
    const session3 = (await manager3.initialize({ resumeId: session1.id }))!;

    assertEquals(session3.id, session1.id);
    assertEquals(session3.messageCount, 1);
    await manager3.close();
  } finally {
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("SessionManager: initialize defers if resumeId not found", async () => {
  const testPath = "/tmp/test-manager-resume-notfound-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager = new SessionManager(testPath);
  try {
    // When resumeId not found, falls through to deferred mode (returns null)
    const session = await manager.initialize({ resumeId: "nonexistent_id" });

    assertEquals(session, null);
    assert(manager.isInitialized());
    assertEquals(manager.hasActiveSession(), false); // Deferred, no active session yet
  } finally {
    await manager.close();
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("SessionManager: initialize defers if no previous session for continue", async () => {
  const testPath = "/tmp/test-manager-continue-new-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager = new SessionManager(testPath);
  try {
    // When no previous session, falls through to deferred mode (returns null)
    const session = await manager.initialize({ continue: true });

    assertEquals(session, null);
    assert(manager.isInitialized());
    assertEquals(manager.hasActiveSession(), false); // Deferred, no active session yet
  } finally {
    await manager.close();
    await cleanupTestSessions(projectHash);
  }
});

// ============================================================================
// recordMessage() Tests
// ============================================================================

Deno.test("SessionManager: recordMessage appends to session", async () => {
  const testPath = "/tmp/test-manager-record-" + Date.now();
  const projectHash = hashProjectPath(testPath);

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
    await manager.close();
    await cleanupTestSessions(projectHash);
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

Deno.test("SessionManager: recordMessage with attachments", async () => {
  const testPath = "/tmp/test-manager-attach-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager = new SessionManager(testPath);
  try {
    await manager.initialize({ forceNew: true });

    await manager.recordMessage("user", "Check this file", ["/path/to/file.txt"]);

    const messages = await manager.getSessionMessages();
    assertEquals(messages[0].attachments?.length, 1);
    assertEquals(messages[0].attachments?.[0], "/path/to/file.txt");
  } finally {
    await manager.close();
    await cleanupTestSessions(projectHash);
  }
});

// ============================================================================
// newSession() Tests
// ============================================================================

Deno.test("SessionManager: newSession creates new session", async () => {
  const testPath = "/tmp/test-manager-new-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager = new SessionManager(testPath);
  try {
    const session1 = (await manager.initialize({ forceNew: true }))!;
    await manager.recordMessage("user", "Session 1");

    const session2 = await manager.newSession("New Session");

    assert(session2.id !== session1.id);
    assertEquals(session2.title, "New Session");
    assertEquals(session2.messageCount, 0);
    assertEquals(manager.getCurrentSession()?.id, session2.id);
  } finally {
    await manager.close();
    await cleanupTestSessions(projectHash);
  }
});

// ============================================================================
// resumeSession() Tests
// ============================================================================

Deno.test("SessionManager: resumeSession switches to existing session", async () => {
  const testPath = "/tmp/test-manager-switch-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager = new SessionManager(testPath);
  try {
    // Create first session
    const session1 = (await manager.initialize({ forceNew: true }))!;
    await manager.recordMessage("user", "Message in session 1");

    // Create second session
    const session2 = await manager.newSession("Session 2");
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
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("SessionManager: resumeSession returns null for non-existent", async () => {
  const testPath = "/tmp/test-manager-resume-null-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager = new SessionManager(testPath);
  try {
    await manager.initialize({ forceNew: true });

    const result = await manager.resumeSession("nonexistent_id");

    assertEquals(result, null);
  } finally {
    await manager.close();
    await cleanupTestSessions(projectHash);
  }
});

// ============================================================================
// listForProject() Tests
// ============================================================================

Deno.test("SessionManager: listForProject returns sessions for current project", async () => {
  const testPath = "/tmp/test-manager-list-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager = new SessionManager(testPath);
  try {
    await manager.initialize({ forceNew: true });
    await manager.newSession("Session 2");
    await manager.newSession("Session 3");

    const sessions = await manager.listForProject();

    assertEquals(sessions.length, 3);
    // Should be sorted by recent first
    assertEquals(sessions[0].title, "Session 3");
  } finally {
    await manager.close();
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("SessionManager: listForProject respects limit", async () => {
  const testPath = "/tmp/test-manager-list-limit-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager = new SessionManager(testPath);
  try {
    await manager.initialize({ forceNew: true });
    await manager.newSession("Session 2");
    await manager.newSession("Session 3");

    const sessions = await manager.listForProject(2);

    assertEquals(sessions.length, 2);
  } finally {
    await manager.close();
    await cleanupTestSessions(projectHash);
  }
});

// ============================================================================
// deleteSession() Tests
// ============================================================================

Deno.test("SessionManager: deleteSession removes session", async () => {
  const testPath = "/tmp/test-manager-delete-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager = new SessionManager(testPath);
  try {
    const session1 = (await manager.initialize({ forceNew: true }))!;
    const session2 = await manager.newSession("Session 2");

    const result = await manager.deleteSession(session1.id);

    assert(result);

    const sessions = await manager.listForProject();
    assertEquals(sessions.length, 1);
    assertEquals(sessions[0].id, session2.id);
  } finally {
    await manager.close();
    await cleanupTestSessions(projectHash);
  }
});

Deno.test("SessionManager: deleteSession clears current if deleting active", async () => {
  const testPath = "/tmp/test-manager-delete-current-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager = new SessionManager(testPath);
  try {
    const session = (await manager.initialize({ forceNew: true }))!;

    await manager.deleteSession(session.id);

    assertEquals(manager.getCurrentSession(), null);
    assertEquals(manager.hasActiveSession(), false);
  } finally {
    await manager.close();
    await cleanupTestSessions(projectHash);
  }
});

// ============================================================================
// renameSession() Tests
// ============================================================================

Deno.test("SessionManager: renameSession updates title", async () => {
  const testPath = "/tmp/test-manager-rename-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager = new SessionManager(testPath);
  try {
    await manager.initialize({ forceNew: true });

    await manager.renameSession("New Title");

    assertEquals(manager.getCurrentSession()?.title, "New Title");

    // Verify persisted
    const sessions = await manager.listForProject();
    assertEquals(sessions[0].title, "New Title");
  } finally {
    await manager.close();
    await cleanupTestSessions(projectHash);
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
  const testPath = "/tmp/test-manager-messages-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager = new SessionManager(testPath);
  try {
    await manager.initialize({ forceNew: true });

    const messages = await manager.getSessionMessages();

    assertEquals(messages.length, 0);
  } finally {
    await manager.close();
    await cleanupTestSessions(projectHash);
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
  const testPath = "/tmp/test-manager-close-" + Date.now();
  const projectHash = hashProjectPath(testPath);

  const manager = new SessionManager(testPath);
  try {
    await manager.initialize({ forceNew: true });
    assert(manager.isInitialized());

    await manager.close();

    assertEquals(manager.isInitialized(), false);
  } finally {
    await cleanupTestSessions(projectHash);
  }
});
