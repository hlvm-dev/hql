/**
 * REPL Session Test Helpers - Single Source of Truth
 *
 * All session-related tests should import helper functions from here to avoid duplication.
 */
import {
  deleteSession,
  listSessions,
  type SessionStorageScope,
} from "../../../../src/hlvm/cli/repl/session/storage.ts";
import { getPlatform } from "../../../../src/platform/platform.ts";

export interface TestSessionScope extends SessionStorageScope {
  readonly hlvmDir: string;
  cleanup(): Promise<void>;
}

/**
 * Create an isolated sessions scope for a test or test file.
 */
export async function createTestSessionScope(
  prefix: string = "hlvm-session-test-",
): Promise<TestSessionScope> {
  const platform = getPlatform();
  const hlvmDir = await platform.fs.makeTempDir({ prefix });
  const sessionsDir = platform.path.join(hlvmDir, "sessions");
  await platform.fs.mkdir(sessionsDir, { recursive: true });

  return {
    hlvmDir,
    sessionsDir,
    cleanup: async () => {
      await platform.fs.remove(hlvmDir, { recursive: true });
    },
  };
}

/**
 * Clean up a specific session file.
 * Silently ignores if the file doesn't exist.
 */
export async function cleanupSession(
  sessionId: string,
  scope: SessionStorageScope,
): Promise<void> {
  const sessionsDir = scope.sessionsDir;
  if (!sessionsDir) return;

  const platform = getPlatform();
  const sessionPath = platform.path.join(sessionsDir, `${sessionId}.jsonl`);

  try {
    await platform.fs.remove(sessionPath);
  } catch {
    // Ignore if doesn't exist
  }
}

/**
 * Clean up all sessions in the provided isolated scope.
 */
export async function cleanupAllSessions(scope: SessionStorageScope): Promise<void> {
  const allSessions = await listSessions({ limit: 1000 }, scope);
  for (const s of allSessions) {
    await deleteSession(s.id, scope);
  }
}
