/**
 * REPL Session Test Helpers - Single Source of Truth
 *
 * All session-related tests should import helper functions from here to avoid duplication.
 */
import { join } from "jsr:@std/path@1";
import { getSessionsDir } from "../../../../src/common/paths.ts";

// Re-export join for test files that need it
export { join };
import { listSessions, deleteSession } from "../../../../src/hlvm/cli/repl/session/storage.ts";

// ============================================================================
// Session Directory Helpers
// ============================================================================

/**
 * Get the test sessions directory.
 * Returns the global sessions directory path.
 */
export function getTestSessionsDir(): string {
  return getSessionsDir();
}

/**
 * Clean up a specific session file.
 * Silently ignores if the file doesn't exist.
 */
export async function cleanupSession(sessionId: string): Promise<void> {
  const sessionPath = join(getTestSessionsDir(), `${sessionId}.jsonl`);
  try {
    await Deno.remove(sessionPath);
  } catch {
    // Ignore if doesn't exist
  }
}

/**
 * Clean up all sessions using storage API.
 * Useful for test cleanup.
 */
export async function cleanupAllSessions(): Promise<void> {
  const allSessions = await listSessions({ limit: 1000 });
  for (const s of allSessions) {
    await deleteSession(s.id);
  }
}
