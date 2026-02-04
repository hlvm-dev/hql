/**
 * Agent Session Store - persistent sessions for CLI
 *
 * Stores:
 * - sessions.json: session metadata
 * - <sessionId>.jsonl: append-only transcript (messages + compaction)
 *
 * SSOT: uses platform abstraction + common/paths.ts.
 */

import { getPlatform } from "../../platform/platform.ts";
import { getSessionsDir } from "../../common/paths.ts";
import { ValidationError } from "../../common/error.ts";
import { getErrorMessage, isObjectValue } from "../../common/utils.ts";
import { isSummaryMessage, type Message, type MessageRole } from "./context.ts";

// ============================================================
// Types
// ============================================================

interface SessionIndex {
  version: 1;
  sessions: Record<string, AgentSessionEntry>;
}

export interface AgentSessionEntry {
  id: string;
  key: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface TranscriptEntryBase {
  type: "message" | "compaction";
  timestamp: number;
}

interface MessageEntry extends TranscriptEntryBase {
  type: "message";
  role: MessageRole;
  content: string;
}

interface CompactionEntry extends TranscriptEntryBase {
  type: "compaction";
  summary: string;
}

type TranscriptEntry = MessageEntry | CompactionEntry;

// ============================================================
// Session index helpers
// ============================================================

const INDEX_FILE = "sessions.json";

async function ensureSessionsDir(): Promise<string> {
  const platform = getPlatform();
  const dir = getSessionsDir();
  await platform.fs.mkdir(dir, { recursive: true });
  return dir;
}

function getIndexPath(): string {
  const platform = getPlatform();
  return platform.path.join(getSessionsDir(), INDEX_FILE);
}

async function loadIndex(): Promise<SessionIndex> {
  const platform = getPlatform();
  await ensureSessionsDir();
  const path = getIndexPath();
  try {
    const raw = await platform.fs.readTextFile(path);
    const parsed = JSON.parse(raw) as SessionIndex;
    if (!parsed || parsed.version !== 1 || !parsed.sessions) {
      throw new Error("invalid index format");
    }
    return parsed;
  } catch (error) {
    if (String(error).includes("No such file") || String(error).includes("not found")) {
      return { version: 1, sessions: {} };
    }
    if (error instanceof SyntaxError) {
      throw new ValidationError(
        `Invalid session index JSON: ${getErrorMessage(error)}`,
        "session_store",
      );
    }
    return { version: 1, sessions: {} };
  }
}

async function saveIndex(index: SessionIndex): Promise<void> {
  const platform = getPlatform();
  await ensureSessionsDir();
  const path = getIndexPath();
  await platform.fs.writeTextFile(path, JSON.stringify(index, null, 2));
}

function createEntry(key?: string): AgentSessionEntry {
  const id = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : String(Date.now());
  const sessionKey = key?.trim() ? key.trim() : id;
  const now = new Date().toISOString();
  return {
    id,
    key: sessionKey,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
}

function findSession(
  index: SessionIndex,
  keyOrId: string,
): AgentSessionEntry | null {
  const byId = index.sessions[keyOrId];
  if (byId) return byId;
  const entries = Object.values(index.sessions);
  return entries.find((entry) => entry.key === keyOrId) ?? null;
}

export async function listSessions(): Promise<AgentSessionEntry[]> {
  const index = await loadIndex();
  return Object.values(index.sessions);
}

export async function getOrCreateSession(
  keyOrId?: string,
): Promise<AgentSessionEntry> {
  const index = await loadIndex();
  if (keyOrId) {
    const existing = findSession(index, keyOrId);
    if (existing) return existing;
    const created = createEntry(keyOrId);
    index.sessions[created.id] = created;
    await saveIndex(index);
    return created;
  }
  const created = createEntry();
  index.sessions[created.id] = created;
  await saveIndex(index);
  return created;
}

export async function createSession(
  key?: string,
): Promise<AgentSessionEntry> {
  const index = await loadIndex();
  const created = createEntry(key);
  index.sessions[created.id] = created;
  await saveIndex(index);
  return created;
}

export async function updateSession(
  entry: AgentSessionEntry,
): Promise<void> {
  const index = await loadIndex();
  index.sessions[entry.id] = entry;
  await saveIndex(index);
}

export function getTranscriptPath(entry: AgentSessionEntry): string {
  const platform = getPlatform();
  return platform.path.join(getSessionsDir(), `${entry.id}.jsonl`);
}

// ============================================================
// Transcript helpers
// ============================================================

function toTranscriptEntry(message: Message): TranscriptEntry | null {
  if (message.role === "system") return null;
  const timestamp = message.timestamp ?? Date.now();
  if (isSummaryMessage(message)) {
    return { type: "compaction", summary: message.content, timestamp };
  }
  return {
    type: "message",
    role: message.role,
    content: message.content,
    timestamp,
  };
}

function fromTranscriptEntry(entry: TranscriptEntry): Message[] {
  if (entry.type === "compaction") {
    return [{
      role: "assistant",
      content: entry.summary,
      timestamp: entry.timestamp,
    }];
  }
  return [{
    role: entry.role,
    content: entry.content,
    timestamp: entry.timestamp,
  }];
}

export async function loadSessionMessages(
  entry: AgentSessionEntry,
): Promise<Message[]> {
  const platform = getPlatform();
  const path = getTranscriptPath(entry);
  try {
    const raw = await platform.fs.readTextFile(path);
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    let messages: Message[] = [];
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isObjectValue(parsed)) continue;
      const type = (parsed as Record<string, unknown>).type;
      if (type !== "message" && type !== "compaction") continue;
      const timestamp = typeof (parsed as Record<string, unknown>).timestamp === "number"
        ? Number((parsed as Record<string, unknown>).timestamp)
        : Date.now();
      if (type === "compaction") {
        const summary = String((parsed as Record<string, unknown>).summary ?? "");
        messages = fromTranscriptEntry({
          type: "compaction",
          summary,
          timestamp,
        });
      } else {
        const role = String((parsed as Record<string, unknown>).role ?? "");
        const content = String((parsed as Record<string, unknown>).content ?? "");
        if (role === "system" || content.trim() === "") continue;
        messages = messages.concat(fromTranscriptEntry({
          type: "message",
          role: role as MessageRole,
          content,
          timestamp,
        }));
      }
    }
    return messages;
  } catch (error) {
    if (String(error).includes("No such file") || String(error).includes("not found")) {
      return [];
    }
    throw new ValidationError(
      `Failed to read session transcript: ${getErrorMessage(error)}`,
      "session_store",
    );
  }
}

export async function appendSessionMessages(
  entry: AgentSessionEntry,
  messages: Message[],
): Promise<AgentSessionEntry> {
  const platform = getPlatform();
  const path = getTranscriptPath(entry);
  await ensureSessionsDir();

  const persistable = messages.map(toTranscriptEntry).filter((m) => m) as TranscriptEntry[];
  const delta = messages
    .filter((message) => !message.fromSession)
    .map(toTranscriptEntry)
    .filter((m) => m) as TranscriptEntry[];
  if (delta.length === 0) return entry;

  const lines = delta.map((item) => JSON.stringify(item)).join("\n") + "\n";
  await platform.fs.writeTextFile(path, lines, { append: true, create: true });

  const updated: AgentSessionEntry = {
    ...entry,
    updatedAt: new Date().toISOString(),
    messageCount: persistable.length,
  };
  await updateSession(updated);
  return updated;
}
