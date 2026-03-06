import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
} from "jsr:@std/assert";
import { getPlatform } from "../../../../src/platform/platform.ts";
import { SessionManager } from "../../../../src/hlvm/cli/repl/session/manager.ts";
import { createTestSessionScope } from "./helpers.ts";

async function createIsolatedManager() {
  const platform = getPlatform();
  const scope = await createTestSessionScope("hlvm-session-manager-");
  const projectPath = platform.path.join(scope.hlvmDir, "project");
  await platform.fs.mkdir(projectPath, { recursive: true });

  return {
    scope,
    projectPath,
    manager: new SessionManager(projectPath, { sessionsDir: scope.sessionsDir }),
  };
}

Deno.test("SessionManager: constructor tracks explicit and default project paths", () => {
  const explicit = new SessionManager("/tmp/explicit-project");
  assertEquals(explicit.getProjectPath(), "/tmp/explicit-project");
  assertEquals(explicit.isInitialized(), false);
  assertEquals(explicit.hasActiveSession(), false);

  const fallback = new SessionManager();
  assertEquals(fallback.getProjectPath(), getPlatform().process.cwd());
});

Deno.test("SessionManager: initialize(forceNew) creates an active session immediately", async () => {
  const { scope, projectPath, manager } = await createIsolatedManager();

  try {
    const session = await manager.initialize({ forceNew: true });
    assertExists(session);
    assertEquals(session.projectPath, projectPath);
    assertEquals(session.messageCount, 0);
    assert(manager.isInitialized());
    assert(manager.hasActiveSession());
  } finally {
    await manager.close();
    await scope.cleanup();
  }
});

Deno.test("SessionManager: continue resumes last session and resumeId targets a specific session", async () => {
  const { scope, projectPath, manager: manager1 } = await createIsolatedManager();
  const manager2 = new SessionManager(projectPath, { sessionsDir: scope.sessionsDir });
  const manager3 = new SessionManager(projectPath, { sessionsDir: scope.sessionsDir });

  try {
    const first = await manager1.initialize({ forceNew: true });
    assertExists(first);
    await manager1.recordMessage("user", "first");
    await manager1.close();

    const resumedLast = await manager2.initialize({ continue: true });
    assertExists(resumedLast);
    assertEquals(resumedLast.id, first.id);
    assertEquals(resumedLast.messageCount, 1);

    await manager2.newSession("Second");
    await manager2.recordMessage("user", "second");
    await manager2.close();

    const resumedSpecific = await manager3.initialize({ resumeId: first.id });
    assertExists(resumedSpecific);
    assertEquals(resumedSpecific.id, first.id);
    assertEquals(resumedSpecific.messageCount, 1);
  } finally {
    await manager1.close();
    await manager2.close();
    await manager3.close();
    await scope.cleanup();
  }
});

Deno.test("SessionManager: deferred initialize creates a session lazily on first message", async () => {
  const { scope, manager } = await createIsolatedManager();

  try {
    const session = await manager.initialize({ continue: true });
    assertEquals(session, null);
    assert(manager.isInitialized());
    assertEquals(manager.hasActiveSession(), false);

    await manager.recordMessage("user", "hello");

    assert(manager.hasActiveSession());
    const messages = await manager.getSessionMessages();
    assertEquals(messages.map((message) => message.content), ["hello"]);
    assertEquals(manager.getCurrentSession()?.messageCount, 1);
  } finally {
    await manager.close();
    await scope.cleanup();
  }
});

Deno.test("SessionManager: record, newSession, and resumeSession preserve per-session history", async () => {
  const { scope, manager } = await createIsolatedManager();

  try {
    const first = await manager.initialize({ forceNew: true });
    assertExists(first);
    await manager.recordMessage("user", "session one");
    await manager.recordMessage("assistant", "reply one");

    const second = await manager.newSession("Second");
    assert(second.id !== first.id);
    await manager.recordMessage("user", "session two");

    const resumed = await manager.resumeSession(first.id);
    assertExists(resumed);
    assertEquals(resumed.meta.id, first.id);
    assertEquals(
      resumed.messages.map((message) => [message.role, message.content]),
      [["user", "session one"], ["assistant", "reply one"]],
    );
  } finally {
    await manager.close();
    await scope.cleanup();
  }
});

Deno.test("SessionManager: list, rename, and delete reflect persisted session state", async () => {
  const { scope, manager } = await createIsolatedManager();

  try {
    const first = await manager.initialize({ forceNew: true });
    assertExists(first);
    await manager.renameSession("Renamed First");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await manager.newSession("Second");

    const listed = await manager.list();
    assertEquals(listed.length, 2);
    assertEquals(listed[0].id, second.id);
    assertEquals(listed[1].title, "Renamed First");

    const deleted = await manager.deleteSession(second.id);
    assertEquals(deleted, true);
    assertEquals(manager.getCurrentSession(), null);
    assertEquals(manager.hasActiveSession(), false);

    const remaining = await manager.list();
    assertEquals(remaining.map((session) => session.title), ["Renamed First"]);
  } finally {
    await manager.close();
    await scope.cleanup();
  }
});

Deno.test("SessionManager: recordMessage and renameSession reject invalid lifecycle usage", async () => {
  const manager = new SessionManager("/tmp/invalid-session-manager");

  await assertRejects(
    () => manager.recordMessage("user", "Hello"),
    Error,
    "not initialized",
  );
  await assertRejects(
    () => manager.renameSession("Renamed"),
    Error,
    "No active session",
  );
});
