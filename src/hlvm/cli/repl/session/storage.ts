/**
 * HLVM REPL Session Storage
 * JSONL-based persistence for session data
 * Follows patterns from memory.ts for file I/O
 */

import { getPlatform } from "../../../../platform/platform.ts";
import { isFileNotFoundError } from "../../../../common/utils.ts";
import {
  appendJsonLine,
  atomicWriteTextFile,
  readJsonLines,
  serializeJsonLines,
} from "../../../../common/jsonl.ts";

// SSOT: Use platform layer for all file/path operations
const fs = () => getPlatform().fs;
const path = () => getPlatform().path;
import type {
  ListSessionsOptions,
  Session,
  SessionHeader,
  SessionMessage,
  SessionMeta,
  SessionRecord,
  SessionTitleRecord,
} from "./types.ts";
import { getSessionsDir } from "../../../../common/paths.ts";
import {
  getLegacySessionsDir,
  listLegacySessionFiles,
} from "../../../../common/legacy-migration.ts";

// ============================================================================
// Constants
// ============================================================================

const INDEX_FILE = "index.jsonl";
const STORAGE_VERSION = 1;

let legacyMigrationChecked = false;

export interface SessionStorageScope {
  sessionsDir?: string;
}

function resolveSessionsDir(scope?: SessionStorageScope): string {
  return scope?.sessionsDir ?? getSessionsDir();
}

/** Get index file path: ~/.hlvm/sessions/index.jsonl */
function getIndexPath(sessionsDir: string): string {
  return path().join(sessionsDir, INDEX_FILE);
}

/** Get session file path (global - no project subdirectory) */
function getSessionPath(sessionId: string, sessionsDir: string): string {
  return path().join(sessionsDir, `${sessionId}.jsonl`);
}

async function sessionsDirHasData(sessionsDir: string): Promise<boolean> {
  const platform = getPlatform();
  try {
    for await (const entry of platform.fs.readDir(sessionsDir)) {
      if (entry.isFile && entry.name.endsWith(".jsonl")) {
        return true;
      }
    }
    return false;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function rebuildIndexFromSessions(sessionsDir: string): Promise<void> {
  const platform = getPlatform();
  const entries: SessionMeta[] = [];

  try {
    for await (const entry of platform.fs.readDir(sessionsDir)) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".jsonl") || entry.name === INDEX_FILE) continue;

      const sessionId = entry.name.replace(/\.jsonl$/, "");
      const records = await readJsonLines<SessionRecord>(
        getSessionPath(sessionId, sessionsDir),
      );

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
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }

  if (entries.length > 0) {
    await writeIndex(entries, { sessionsDir });
  }
}

async function ensureLegacySessionsMigrated(sessionsDir: string): Promise<void> {
  if (sessionsDir !== getSessionsDir()) {
    return;
  }
  if (legacyMigrationChecked) return;
  legacyMigrationChecked = true;

  const legacyDir = getLegacySessionsDir();
  const legacyFiles = await listLegacySessionFiles(legacyDir);
  const hasLegacyFiles = legacyFiles.length > 0;

  if (hasLegacyFiles) {
    await fs().ensureDir(sessionsDir);
  }

  const platform = getPlatform();
  let copiedAny = false;
  for (const legacyFile of legacyFiles) {
    const filename = path().basename(legacyFile);
    const targetPath = path().join(sessionsDir, filename);
    if (await getPlatform().fs.exists(targetPath)) {
      continue;
    }
    try {
      await platform.fs.copyFile(legacyFile, targetPath);
      copiedAny = true;
    } catch {
      // Ignore copy errors for individual files.
    }
  }

  const indexPath = getIndexPath(sessionsDir);
  const hasCurrentData = await sessionsDirHasData(sessionsDir);
  const needsIndex = (hasLegacyFiles || hasCurrentData) &&
    !(await getPlatform().fs.exists(indexPath));

  if (copiedAny || needsIndex) {
    await rebuildIndexFromSessions(sessionsDir);
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
// Index Operations
// ============================================================================

/**
 * Read all session metadata from index.
 */
async function readIndex(
  scope?: SessionStorageScope,
): Promise<SessionMeta[]> {
  const sessionsDir = resolveSessionsDir(scope);
  await ensureLegacySessionsMigrated(sessionsDir);
  return readJsonLines<SessionMeta>(getIndexPath(sessionsDir));
}

async function writeIndex(
  entries: SessionMeta[],
  scope?: SessionStorageScope,
): Promise<void> {
  const sessionsDir = resolveSessionsDir(scope);
  const content = serializeJsonLines(entries);
  await atomicWriteTextFile(getIndexPath(sessionsDir), content);
}

async function updateIndexEntry(
  entry: SessionMeta,
  scope?: SessionStorageScope,
): Promise<void> {
  const entries = await readIndex(scope);
  const index = entries.findIndex((e) => e.id === entry.id);

  if (index >= 0) {
    entries[index] = entry;
  } else {
    entries.push(entry);
  }

  await writeIndex(entries, scope);
}

/**
 * Remove a session entry from the index.
 */
async function removeIndexEntry(
  sessionId: string,
  scope?: SessionStorageScope,
): Promise<boolean> {
  const entries = await readIndex(scope);
  const filtered = entries.filter((e) => e.id !== sessionId);

  if (filtered.length === entries.length) {
    return false; // Not found
  }

  await writeIndex(filtered, scope);
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
  title?: string,
  scope?: SessionStorageScope,
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
  const sessionsDir = resolveSessionsDir(scope);
  const sessionPath = getSessionPath(sessionId, sessionsDir);
  await appendJsonLine(sessionPath, header);

  // Write initial title record to session file
  const titleRecord: SessionTitleRecord = {
    type: "title",
    title: meta.title,
    ts: now,
  };
  await appendJsonLine(sessionPath, titleRecord);

  // Update index
  await updateIndexEntry(meta, scope);

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
  attachments?: readonly string[],
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
  attachments?: readonly string[],
  scope?: SessionStorageScope,
): Promise<SessionMessage> {
  const message = createMessage(role, content, attachments);
  const sessionsDir = resolveSessionsDir(scope);
  const sessionPath = getSessionPath(sessionId, sessionsDir);
  await appendJsonLine(sessionPath, message);

  // Update index in a single read-modify-write (no double read)
  const entries = await readIndex(scope);
  const index = entries.findIndex((e) => e.id === sessionId);
  if (index >= 0) {
    entries[index] = {
      ...entries[index],
      updatedAt: message.ts,
      messageCount: entries[index].messageCount + 1,
    };
    await writeIndex(entries, scope);
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
  attachments?: readonly string[],
  scope?: SessionStorageScope,
): Promise<SessionMessage> {
  const message = createMessage(role, content, attachments);
  const sessionsDir = resolveSessionsDir(scope);
  const sessionPath = getSessionPath(sessionId, sessionsDir);
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
  updatedAt: number,
  scope?: SessionStorageScope,
): Promise<void> {
  const entries = await readIndex(scope);
  const index = entries.findIndex((e) => e.id === sessionId);

  if (index >= 0) {
    entries[index] = {
      ...entries[index],
      messageCount,
      updatedAt,
    };
    await writeIndex(entries, scope);
  }
}

/**
 * Load a session with all its messages.
 */
export async function loadSession(
  sessionId: string,
  scope?: SessionStorageScope,
): Promise<Session | null> {
  const sessionsDir = resolveSessionsDir(scope);
  const sessionPath = getSessionPath(sessionId, sessionsDir);

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
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * List sessions (global - shows all sessions).
 */
export async function listSessions(
  options: ListSessionsOptions = {},
  scope?: SessionStorageScope,
): Promise<SessionMeta[]> {
  const {
    limit = 50,
    sortOrder = "recent",
  } = options;

  const entries = await readIndex(scope);

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
export async function getLastSession(
  scope?: SessionStorageScope,
): Promise<SessionMeta | null> {
  const sessions = await listSessions({
    limit: 1,
    sortOrder: "recent",
  }, scope);
  return sessions[0] || null;
}

/**
 * Delete a session.
 */
export async function deleteSession(
  sessionId: string,
  scope?: SessionStorageScope,
): Promise<boolean> {
  const platform = getPlatform();
  const sessionsDir = resolveSessionsDir(scope);
  const sessionPath = getSessionPath(sessionId, sessionsDir);

  // Remove session file
  try {
    await platform.fs.remove(sessionPath);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }

  // Remove from index
  return removeIndexEntry(sessionId, scope);
}

/**
 * Update session title.
 */
export async function updateTitle(
  sessionId: string,
  title: string,
  scope?: SessionStorageScope,
): Promise<void> {
  const titleRecord: SessionTitleRecord = {
    type: "title",
    title,
    ts: Date.now(),
  };

  // Append title record to session file
  const sessionsDir = resolveSessionsDir(scope);
  const sessionPath = getSessionPath(sessionId, sessionsDir);
  await appendJsonLine(sessionPath, titleRecord);

  // Update index in a single read-modify-write (no double read)
  const entries = await readIndex(scope);
  const index = entries.findIndex((e) => e.id === sessionId);
  if (index >= 0) {
    entries[index] = {
      ...entries[index],
      title,
      updatedAt: titleRecord.ts,
    };
    await writeIndex(entries, scope);
  }
}

/**
 * Export a session as markdown.
 */
export async function exportSession(
  sessionId: string,
  scope?: SessionStorageScope,
): Promise<string | null> {
  const session = await loadSession(sessionId, scope);

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
export async function initSessionsDir(
  scope?: SessionStorageScope,
): Promise<void> {
  await fs().ensureDir(resolveSessionsDir(scope));
}
