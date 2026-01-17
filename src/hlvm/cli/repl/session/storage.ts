/**
 * HLVM REPL Session Storage
 * JSONL-based persistence for session data
 * Follows patterns from memory.ts for file I/O
 */

import { basename, join, dirname } from "jsr:@std/path@1";
import { ensureDir } from "jsr:@std/fs@1";
import type {
  SessionMeta,
  SessionHeader,
  SessionMessage,
  SessionTitleRecord,
  SessionRecord,
  Session,
  ListSessionsOptions,
} from "./types.ts";
import { getSessionsDir } from "../../../../common/paths.ts";
import { getLegacySessionsDir, listLegacySessionFiles } from "../../../../common/legacy-migration.ts";

// ============================================================================
// Constants
// ============================================================================

const INDEX_FILE = "index.jsonl";
const STORAGE_VERSION = 1;

let legacyMigrationChecked = false;

/** Get index file path: ~/.hlvm/sessions/index.jsonl */
function getIndexPath(): string {
  return join(getSessionsDir(), INDEX_FILE);
}

/** Get session file path (global - no project subdirectory) */
function getSessionPath(sessionId: string): string {
  return join(getSessionsDir(), `${sessionId}.jsonl`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    return false;
  }
}

async function sessionsDirHasData(): Promise<boolean> {
  try {
    for await (const entry of Deno.readDir(getSessionsDir())) {
      if (entry.isFile && entry.name.endsWith(".jsonl")) {
        return true;
      }
    }
    return false;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

async function rebuildIndexFromSessions(): Promise<void> {
  const entries: SessionMeta[] = [];

  try {
    for await (const entry of Deno.readDir(getSessionsDir())) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".jsonl") || entry.name === INDEX_FILE) continue;

      const sessionId = entry.name.replace(/\.jsonl$/, "");
      const records = await readJsonLines<SessionRecord>(getSessionPath(sessionId));

      let header: SessionHeader | null = null;
      let lastTitle: string | null = null;
      let messageCount = 0;
      let lastMessageTs: number | null = null;

      for (const record of records) {
        switch (record.type) {
          case "meta":
            header = record;
            break;
          case "title":
            lastTitle = record.title;
            break;
          case "message":
            messageCount++;
            lastMessageTs = record.ts;
            break;
        }
      }

      if (!header) continue;

      entries.push({
        id: header.id,
        projectHash: header.projectHash,
        projectPath: header.projectPath,
        title: lastTitle || generateDefaultTitle(),
        createdAt: header.createdAt,
        updatedAt: lastMessageTs ?? header.createdAt,
        messageCount,
      });
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  if (entries.length > 0) {
    await writeIndex(entries);
  }
}

async function ensureLegacySessionsMigrated(): Promise<void> {
  if (legacyMigrationChecked) return;
  legacyMigrationChecked = true;

  const legacyDir = getLegacySessionsDir();
  const legacyFiles = await listLegacySessionFiles(legacyDir);
  const hasLegacyFiles = legacyFiles.length > 0;

  if (hasLegacyFiles) {
    await ensureDir(getSessionsDir());
  }

  let copiedAny = false;
  for (const legacyFile of legacyFiles) {
    const filename = basename(legacyFile);
    const targetPath = join(getSessionsDir(), filename);
    if (await pathExists(targetPath)) {
      continue;
    }
    try {
      await Deno.copyFile(legacyFile, targetPath);
      copiedAny = true;
    } catch {
      // Ignore copy errors for individual files.
    }
  }

  const indexPath = getIndexPath();
  const hasCurrentData = await sessionsDirHasData();
  const needsIndex = (hasLegacyFiles || hasCurrentData) && !(await pathExists(indexPath));

  if (copiedAny || needsIndex) {
    await rebuildIndexFromSessions();
  }
}

// ============================================================================
// Hash & ID Generation
// ============================================================================

/**
 * Generate a stable hash for a project path using djb2 algorithm.
 * Fast and collision-resistant enough for this use case.
 * @returns 8-character hex string
 */
export function hashProjectPath(projectPath: string): string {
  let hash = 5381;
  for (let i = 0; i < projectPath.length; i++) {
    hash = ((hash << 5) + hash) ^ projectPath.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Generate a unique session ID.
 * Format: {timestamp}_{random}
 */
export function generateSessionId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}_${random}`;
}

// ============================================================================
// JSONL Helpers
// ============================================================================

/**
 * Append a JSON line to a file.
 * Creates directory if needed.
 */
async function appendJsonLine(path: string, record: unknown): Promise<void> {
  const line = JSON.stringify(record) + "\n";

  try {
    await Deno.writeTextFile(path, line, { append: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      await ensureDir(dirname(path));
      await Deno.writeTextFile(path, line);
    } else {
      throw error;
    }
  }
}

/**
 * Read and parse all JSON lines from a file.
 * Skips empty lines and logs parse errors without failing.
 */
async function readJsonLines<T>(path: string): Promise<T[]> {
  try {
    const content = await Deno.readTextFile(path);
    const lines = content.split("\n").filter((line) => line.trim());
    const results: T[] = [];

    for (const line of lines) {
      try {
        results.push(JSON.parse(line) as T);
      } catch {
        // Skip malformed lines silently - recovery from corruption
      }
    }

    return results;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }
}

/**
 * Atomic write: write to temp file, then rename.
 * Prevents corruption if process crashes mid-write.
 */
async function atomicWriteFile(path: string, content: string): Promise<void> {
  const tempPath = `${path}.tmp.${Date.now()}`;

  try {
    await ensureDir(dirname(path));
    await Deno.writeTextFile(tempPath, content);
    await Deno.rename(tempPath, path);
  } catch (error) {
    try {
      await Deno.remove(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

// ============================================================================
// Index Operations
// ============================================================================

/**
 * Read all session metadata from index.
 */
async function readIndex(): Promise<SessionMeta[]> {
  await ensureLegacySessionsMigrated();
  return readJsonLines<SessionMeta>(getIndexPath());
}

/**
 * Write all session metadata to index (atomic).
 */
async function writeIndex(entries: SessionMeta[]): Promise<void> {
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await atomicWriteFile(getIndexPath(), content);
}

/**
 * Update or add a session entry in the index.
 */
async function updateIndexEntry(entry: SessionMeta): Promise<void> {
  const entries = await readIndex();
  const index = entries.findIndex((e) => e.id === entry.id);

  if (index >= 0) {
    entries[index] = entry;
  } else {
    entries.push(entry);
  }

  await writeIndex(entries);
}

/**
 * Remove a session entry from the index.
 */
async function removeIndexEntry(sessionId: string): Promise<boolean> {
  const entries = await readIndex();
  const filtered = entries.filter((e) => e.id !== sessionId);

  if (filtered.length === entries.length) {
    return false; // Not found
  }

  await writeIndex(filtered);
  return true;
}

// ============================================================================
// Session CRUD Operations
// ============================================================================

/**
 * Create a new session.
 * Sessions are global - projectPath is stored for informational purposes only.
 */
export async function createSession(
  projectPath: string,
  title?: string
): Promise<SessionMeta> {
  const projectHash = hashProjectPath(projectPath);
  const sessionId = generateSessionId();
  const now = Date.now();

  // Create session header record (projectPath stored for reference)
  const header: SessionHeader = {
    type: "meta",
    version: STORAGE_VERSION,
    id: sessionId,
    projectHash,
    projectPath,
    createdAt: now,
  };

  // Create session metadata for index
  const meta: SessionMeta = {
    id: sessionId,
    projectHash,
    projectPath,
    title: title || generateDefaultTitle(),
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };

  // Write header to session file (global path, no project subdirectory)
  const sessionPath = getSessionPath(sessionId);
  await appendJsonLine(sessionPath, header);

  // Write initial title record to session file
  const titleRecord: SessionTitleRecord = {
    type: "title",
    title: meta.title,
    ts: now,
  };
  await appendJsonLine(sessionPath, titleRecord);

  // Update index
  await updateIndexEntry(meta);

  return meta;
}

/**
 * Generate a default session title based on timestamp.
 */
function generateDefaultTitle(): string {
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `Session at ${time}`;
}

/**
 * Create a SessionMessage object.
 */
function createMessage(
  role: "user" | "assistant",
  content: string,
  attachments?: readonly string[]
): SessionMessage {
  return {
    type: "message",
    role,
    content,
    ts: Date.now(),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
}

/**
 * Append a message to an existing session.
 * Note: This updates the index on every call (O(n)). For batch operations,
 * use appendMessageOnly() + updateSessionIndex() instead.
 */
export async function appendMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  attachments?: readonly string[]
): Promise<SessionMessage> {
  const message = createMessage(role, content, attachments);
  const sessionPath = getSessionPath(sessionId);
  await appendJsonLine(sessionPath, message);

  // Update index with new count and timestamp
  const entries = await readIndex();
  const entry = entries.find((e) => e.id === sessionId);

  if (entry) {
    const updated: SessionMeta = {
      ...entry,
      updatedAt: message.ts,
      messageCount: entry.messageCount + 1,
    };
    await updateIndexEntry(updated);
  }

  return message;
}

/**
 * Append a message to session file without updating the index.
 * Use with updateSessionIndex() for lazy/batched index updates.
 * This is O(1) - only appends to the session file.
 */
export async function appendMessageOnly(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  attachments?: readonly string[]
): Promise<SessionMessage> {
  const message = createMessage(role, content, attachments);
  const sessionPath = getSessionPath(sessionId);
  await appendJsonLine(sessionPath, message);
  return message;
}

/**
 * Update index entry for a session with new metadata.
 * Call this after batching multiple appendMessageOnly() calls.
 */
export async function updateSessionIndex(
  sessionId: string,
  messageCount: number,
  updatedAt: number
): Promise<void> {
  const entries = await readIndex();
  const index = entries.findIndex((e) => e.id === sessionId);

  if (index >= 0) {
    entries[index] = {
      ...entries[index],
      messageCount,
      updatedAt,
    };
    await writeIndex(entries);
  }
}

/**
 * Load a session with all its messages.
 */
export async function loadSession(
  sessionId: string
): Promise<Session | null> {
  const sessionPath = getSessionPath(sessionId);

  try {
    const records = await readJsonLines<SessionRecord>(sessionPath);

    if (records.length === 0) {
      return null;
    }

    // Parse records
    let header: SessionHeader | null = null;
    const messages: SessionMessage[] = [];
    let lastTitle: string | null = null;

    for (const record of records) {
      switch (record.type) {
        case "meta":
          header = record;
          break;
        case "message":
          messages.push(record);
          break;
        case "title":
          lastTitle = record.title;
          break;
      }
    }

    if (!header) {
      return null;
    }

    // Build session
    const meta: SessionMeta = {
      id: header.id,
      projectHash: header.projectHash,
      projectPath: header.projectPath,
      title: lastTitle || generateDefaultTitle(),
      createdAt: header.createdAt,
      updatedAt: messages[messages.length - 1]?.ts ?? header.createdAt,
      messageCount: messages.length,
    };

    return { meta, messages };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
}

/**
 * List sessions (global - shows all sessions).
 */
export async function listSessions(
  options: ListSessionsOptions = {}
): Promise<SessionMeta[]> {
  const {
    limit = 50,
    sortOrder = "recent",
  } = options;

  const entries = await readIndex();

  // Sort
  switch (sortOrder) {
    case "recent":
      entries.sort((a, b) => b.updatedAt - a.updatedAt);
      break;
    case "oldest":
      entries.sort((a, b) => a.updatedAt - b.updatedAt);
      break;
    case "alpha":
      entries.sort((a, b) => a.title.localeCompare(b.title));
      break;
  }

  // Limit
  return entries.slice(0, limit);
}

/**
 * Get the most recent session (global).
 */
export async function getLastSession(): Promise<SessionMeta | null> {
  const sessions = await listSessions({
    limit: 1,
    sortOrder: "recent",
  });
  return sessions[0] || null;
}

/**
 * Delete a session.
 */
export async function deleteSession(
  sessionId: string
): Promise<boolean> {
  const sessionPath = getSessionPath(sessionId);

  // Remove session file
  try {
    await Deno.remove(sessionPath);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  // Remove from index
  return removeIndexEntry(sessionId);
}

/**
 * Update session title.
 */
export async function updateTitle(
  sessionId: string,
  title: string
): Promise<void> {
  const titleRecord: SessionTitleRecord = {
    type: "title",
    title,
    ts: Date.now(),
  };

  // Append title record to session file
  const sessionPath = getSessionPath(sessionId);
  await appendJsonLine(sessionPath, titleRecord);

  // Update index
  const entries = await readIndex();
  const entry = entries.find((e) => e.id === sessionId);

  if (entry) {
    const updated: SessionMeta = {
      ...entry,
      title,
      updatedAt: titleRecord.ts,
    };
    await updateIndexEntry(updated);
  }
}

/**
 * Export a session as markdown.
 */
export async function exportSession(
  sessionId: string
): Promise<string | null> {
  const session = await loadSession(sessionId);

  if (!session) {
    return null;
  }

  const lines: string[] = [
    `# ${session.meta.title}`,
    "",
    `**Created:** ${new Date(session.meta.createdAt).toLocaleString()}`,
    `**Messages:** ${session.meta.messageCount}`,
    "",
    "---",
    "",
  ];

  for (const msg of session.messages) {
    const role = msg.role === "user" ? "**You**" : "**Assistant**";
    const time = new Date(msg.ts).toLocaleTimeString();
    lines.push(`### ${role} (${time})`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Initialize sessions directory structure.
 */
export async function initSessionsDir(): Promise<void> {
  await ensureDir(getSessionsDir());
}
