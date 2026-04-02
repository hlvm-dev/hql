/**
 * HLVM REPL Persistent History Storage
 *
 * JSONL format storage for command history that persists across sessions.
 * Like bash/zsh history but with timestamps for cross-session merge.
 *
 * Storage format: ~/.hlvm/history.jsonl
 * Each line: {"ts":1736784000000,"cmd":"(def x 42)"}
 *
 * Features:
 * - Async non-blocking loading at startup
 * - Fire-and-forget saves with debouncing
 * - Corrupt line recovery (skips bad JSON)
 * - Atomic compaction (temp file + rename)
 */

import {
  ensureHlvmDir,
  ensureHlvmDirSync,
  getHistoryPath,
  getHistoryPasteStoreDir,
} from "../../../common/paths.ts";
import { getLegacyHistoryPath } from "../../../common/legacy-migration.ts";
import {
  parseJsonLines,
  serializeJsonLines,
} from "../../../common/jsonl.ts";
import { atomicWriteTextFile } from "../../../common/atomic-file.ts";
import { isFileNotFoundError, TEXT_ENCODER } from "../../../common/utils.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import type { ComposerLanguage } from "./composer-language.ts";
import {
  cloneAttachments,
  getPastedTextReferenceLineCount,
  type AnyAttachment,
  type AttachmentMetadata,
  type AttachmentType,
} from "./attachment.ts";

// ============================================================================
// Types
// ============================================================================

/** Single history entry stored in JSONL file */
export type HistoryEntrySource =
  | "evaluate"
  | "command"
  | "conversation"
  | "interaction";

export interface HistoryEntryMetadata {
  readonly source?: HistoryEntrySource;
  readonly language?: ComposerLanguage;
  readonly attachments?: readonly AnyAttachment[];
}

export interface HistoryEntry {
  ts: number; // Unix timestamp in milliseconds
  cmd: string; // The command
  source?: HistoryEntrySource;
  language?: ComposerLanguage;
  attachments?: AnyAttachment[];
}

export interface StoredTextHistoryAttachment {
  readonly id: number;
  readonly attachmentId: string;
  readonly type: "text";
  readonly displayName: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly lineCount: number;
  readonly content?: string;
  readonly contentHash?: string;
}

export interface StoredBinaryHistoryAttachment {
  readonly id: number;
  readonly attachmentId: string;
  readonly type: Exclude<AttachmentType, "text">;
  readonly displayName: string;
  readonly path?: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly metadata?: AttachmentMetadata;
}

export type StoredHistoryAttachment =
  | StoredTextHistoryAttachment
  | StoredBinaryHistoryAttachment;

interface PersistedHistoryEntry {
  readonly ts: number;
  readonly cmd: string;
  readonly source?: HistoryEntrySource;
  readonly language?: ComposerLanguage;
  readonly attachments?: StoredHistoryAttachment[];
}

/** Configuration for history storage */
interface HistoryStorageConfig {
  maxEntries: number; // Max entries to keep (default: 1000)
  saveDebounceMs: number; // Debounce time before save (default: 500)
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: HistoryStorageConfig = {
  maxEntries: 1000,
  saveDebounceMs: 500,
};
const MAX_INLINE_HISTORY_TEXT_ATTACHMENT_CHARS = 1024;

let legacyMigrationChecked = false;

function getHistoryAttachmentSignature(
  attachments?: readonly AnyAttachment[],
): string {
  return attachments?.map((attachment) =>
    [
      attachment.id,
      attachment.attachmentId,
      attachment.type,
      attachment.displayName,
    ].join(":")
  ).join("\u0001") ?? "";
}

function getHistoryEntryKey(
  entry: Pick<HistoryEntry, "cmd" | "source" | "language" | "attachments">,
): string {
  return [
    entry.cmd,
    entry.source ?? "",
    entry.language ?? "",
    getHistoryAttachmentSignature(entry.attachments),
  ].join("\u0000");
}

function isAttachmentMetadata(value: unknown): value is AttachmentMetadata {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toStoredHistoryAttachment(
  value: unknown,
): StoredHistoryAttachment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const attachment = value as {
    id?: unknown;
    attachmentId?: unknown;
    type?: unknown;
    displayName?: unknown;
    path?: unknown;
    fileName?: unknown;
    mimeType?: unknown;
    size?: unknown;
    metadata?: unknown;
    lineCount?: unknown;
    content?: unknown;
    contentHash?: unknown;
  };
  if (
    typeof attachment.id !== "number" ||
    typeof attachment.attachmentId !== "string" ||
    typeof attachment.type !== "string" ||
    typeof attachment.displayName !== "string" ||
    typeof attachment.fileName !== "string" ||
    typeof attachment.mimeType !== "string" ||
    typeof attachment.size !== "number"
  ) {
    return undefined;
  }
  if (attachment.type === "text") {
    if (typeof attachment.lineCount !== "number") {
      return undefined;
    }
    if (
      attachment.content !== undefined &&
      typeof attachment.content !== "string"
    ) {
      return undefined;
    }
    if (
      attachment.contentHash !== undefined &&
      typeof attachment.contentHash !== "string"
    ) {
      return undefined;
    }
    if (
      attachment.content === undefined && attachment.contentHash === undefined
    ) {
      return undefined;
    }
    return {
      id: attachment.id,
      attachmentId: attachment.attachmentId,
      type: "text",
      displayName: attachment.displayName,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      lineCount: attachment.lineCount,
      content: attachment.content,
      contentHash: attachment.contentHash,
    };
  }
  if (attachment.path !== undefined && typeof attachment.path !== "string") {
    return undefined;
  }
  if (
    attachment.metadata !== undefined &&
    !isAttachmentMetadata(attachment.metadata)
  ) {
    return undefined;
  }
  return {
    id: attachment.id,
    attachmentId: attachment.attachmentId,
    type: attachment.type as Exclude<AttachmentType, "text">,
    displayName: attachment.displayName,
    path: attachment.path,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    metadata: attachment.metadata,
  };
}

function parsePersistedHistoryEntry(
  value: unknown,
): PersistedHistoryEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entry = value as {
    cmd?: unknown;
    ts?: unknown;
    source?: unknown;
    language?: unknown;
    attachments?: unknown;
  };
  if (typeof entry.cmd !== "string" || typeof entry.ts !== "number") {
    return undefined;
  }
  if (entry.source !== undefined && typeof entry.source !== "string") {
    return undefined;
  }
  if (entry.language !== undefined && typeof entry.language !== "string") {
    return undefined;
  }
  if (
    entry.attachments !== undefined &&
    !Array.isArray(entry.attachments)
  ) {
    return undefined;
  }
  const attachments = Array.isArray(entry.attachments)
    ? entry.attachments.map((attachment) => toStoredHistoryAttachment(attachment))
      .filter((attachment): attachment is StoredHistoryAttachment =>
        attachment !== undefined
      )
    : undefined;
  return {
    cmd: entry.cmd,
    ts: entry.ts,
    source: entry.source as HistoryEntrySource | undefined,
    language: entry.language as ComposerLanguage | undefined,
    attachments,
  };
}

function parsePersistedHistoryContent(content: string): PersistedHistoryEntry[] {
  return parseJsonLines(content, parsePersistedHistoryEntry);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(text));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function getHistoryPastePath(contentHash: string): string {
  return getPlatform().path.join(getHistoryPasteStoreDir(), `${contentHash}.txt`);
}

async function storeHistoryPasteContent(
  contentHash: string,
  content: string,
): Promise<void> {
  const fs = getPlatform().fs;
  await ensureHlvmDir();
  await fs.mkdir(getHistoryPasteStoreDir(), { recursive: true });
  await fs.writeTextFile(getHistoryPastePath(contentHash), content);
}

async function readHistoryPasteContent(
  contentHash: string,
): Promise<string | undefined> {
  try {
    return await getPlatform().fs.readTextFile(getHistoryPastePath(contentHash));
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function restoreStoredAttachment(
  attachment: StoredHistoryAttachment,
): Promise<AnyAttachment | undefined> {
  if (attachment.type === "text") {
    const content = attachment.content ??
      (attachment.contentHash
        ? await readHistoryPasteContent(attachment.contentHash)
        : undefined);
    if (content === undefined) {
      return undefined;
    }
    return {
      id: attachment.id,
      attachmentId: attachment.attachmentId,
      type: "text",
      displayName: attachment.displayName,
      content,
      lineCount: attachment.lineCount ??
        getPastedTextReferenceLineCount(content),
      size: attachment.size,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    };
  }
  return {
    id: attachment.id,
    attachmentId: attachment.attachmentId,
    type: attachment.type,
    displayName: attachment.displayName,
    path: attachment.path ?? attachment.fileName,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    metadata: attachment.metadata ? { ...attachment.metadata } : undefined,
  };
}

async function restorePersistedHistoryEntry(
  entry: PersistedHistoryEntry,
): Promise<HistoryEntry> {
  const attachments = entry.attachments
    ? (await Promise.all(
      entry.attachments.map((attachment) => restoreStoredAttachment(attachment)),
    )).filter((attachment): attachment is AnyAttachment => attachment !== undefined)
    : undefined;
  return {
    cmd: entry.cmd,
    ts: entry.ts,
    source: entry.source,
    language: entry.language,
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
  };
}

async function readHistoryEntries(path: string): Promise<HistoryEntry[]> {
  try {
    const content = await getPlatform().fs.readTextFile(path);
    const persistedEntries = parsePersistedHistoryContent(content);
    return await Promise.all(
      persistedEntries.map((entry) => restorePersistedHistoryEntry(entry)),
    );
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

async function toPersistedAttachment(
  attachment: AnyAttachment,
): Promise<StoredHistoryAttachment> {
  if ("content" in attachment) {
    if (attachment.content.length <= MAX_INLINE_HISTORY_TEXT_ATTACHMENT_CHARS) {
      return {
        id: attachment.id,
        attachmentId: attachment.attachmentId,
        type: "text",
        displayName: attachment.displayName,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        lineCount: attachment.lineCount,
        content: attachment.content,
      };
    }
    const contentHash = await sha256Hex(attachment.content);
    await storeHistoryPasteContent(contentHash, attachment.content);
    return {
      id: attachment.id,
      attachmentId: attachment.attachmentId,
      type: "text",
      displayName: attachment.displayName,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      lineCount: attachment.lineCount,
      contentHash,
    };
  }
  return {
    id: attachment.id,
    attachmentId: attachment.attachmentId,
    type: attachment.type as Exclude<AttachmentType, "text">,
    displayName: attachment.displayName,
    path: attachment.path,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    metadata: attachment.metadata ? { ...attachment.metadata } : undefined,
  };
}

function toPersistedAttachmentSync(
  attachment: AnyAttachment,
): StoredHistoryAttachment {
  if ("content" in attachment) {
    return {
      id: attachment.id,
      attachmentId: attachment.attachmentId,
      type: "text",
      displayName: attachment.displayName,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      lineCount: attachment.lineCount,
      content: attachment.content,
    };
  }
  return {
    id: attachment.id,
    attachmentId: attachment.attachmentId,
    type: attachment.type as Exclude<AttachmentType, "text">,
    displayName: attachment.displayName,
    path: attachment.path,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    metadata: attachment.metadata ? { ...attachment.metadata } : undefined,
  };
}

async function toPersistedHistoryEntry(
  entry: HistoryEntry,
): Promise<PersistedHistoryEntry> {
  const attachments = entry.attachments?.length
    ? await Promise.all(
      entry.attachments.map((attachment) => toPersistedAttachment(attachment)),
    )
    : undefined;
  return {
    ts: entry.ts,
    cmd: entry.cmd,
    source: entry.source,
    language: entry.language,
    attachments,
  };
}

function toPersistedHistoryEntrySync(entry: HistoryEntry): PersistedHistoryEntry {
  return {
    ts: entry.ts,
    cmd: entry.cmd,
    source: entry.source,
    language: entry.language,
    attachments: entry.attachments?.length
      ? entry.attachments.map((attachment) => toPersistedAttachmentSync(attachment))
      : undefined,
  };
}

async function serializeHistoryEntries(
  entries: HistoryEntry[],
): Promise<string> {
  const persistedEntries = await Promise.all(
    entries.map((entry) => toPersistedHistoryEntry(entry)),
  );
  return serializeJsonLines(persistedEntries);
}

async function writeHistoryEntries(
  path: string,
  entries: HistoryEntry[],
): Promise<void> {
  await ensureHlvmDir();
  const content = await serializeHistoryEntries(entries);
  await atomicWriteTextFile(path, content);
}

async function ensureLegacyHistoryMerged(maxEntries: number): Promise<void> {
  if (legacyMigrationChecked) return;
  legacyMigrationChecked = true;

  const legacyPath = getLegacyHistoryPath();
  const currentPath = getHistoryPath();

  const legacyEntries = await readHistoryEntries(legacyPath);
  if (legacyEntries.length === 0) {
    return;
  }

  const currentEntries = await readHistoryEntries(currentPath);
  if (currentEntries.length === 0) {
    await writeHistoryEntries(currentPath, legacyEntries);
    return;
  }

  const currentKeys = new Set(
    currentEntries.map((entry) => `${entry.ts}:${getHistoryEntryKey(entry)}`),
  );
  if (
    legacyEntries.every((entry) =>
      currentKeys.has(`${entry.ts}:${getHistoryEntryKey(entry)}`)
    )
  ) {
    return;
  }

  // Merge with deduplication using a single pass
  const mergedKeys = new Set<string>();
  const merged: HistoryEntry[] = [];
  for (const entry of [...currentEntries, ...legacyEntries]) {
    const key = `${entry.ts}:${getHistoryEntryKey(entry)}`;
    if (mergedKeys.has(key)) continue;
    mergedKeys.add(key);
    merged.push(entry);
  }

  merged.sort((a, b) => a.ts - b.ts);
  const trimmed = maxEntries > 0 ? merged.slice(-maxEntries) : merged;
  await writeHistoryEntries(currentPath, trimmed);
}

// ============================================================================
// History Storage Class
// ============================================================================

export class HistoryStorage {
  private entries: HistoryEntry[] = [];
  private pendingWrites: HistoryEntry[] = [];
  private saveTimeoutId: number | null = null;
  private config: HistoryStorageConfig;
  private initialized = false;
  private lineCount = 0;
  private compactScheduled = false;
  private compacting = false;

  constructor(config: Partial<HistoryStorageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize storage - loads entries from disk.
   * Safe to call multiple times (idempotent).
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.load();
    this.maybeScheduleCompaction();
  }

  /**
   * Load history from disk.
   * Skips corrupt lines gracefully.
   */
  private async load(): Promise<void> {
    await ensureLegacyHistoryMerged(this.config.maxEntries);
    const platform = getPlatform();
    const path = getHistoryPath();

    try {
      const content = await platform.fs.readTextFile(path);
      const persistedEntries = parsePersistedHistoryContent(content);
      this.lineCount = persistedEntries.length;
      const allEntries = await Promise.all(
        persistedEntries.map((entry) => restorePersistedHistoryEntry(entry)),
      );

      // Sort by timestamp (oldest first)
      allEntries.sort((a, b) => a.ts - b.ts);

      // Deduplicate consecutive commands
      const deduplicated: HistoryEntry[] = [];
      for (const entry of allEntries) {
        const last = deduplicated[deduplicated.length - 1];
        if (!last || getHistoryEntryKey(last) !== getHistoryEntryKey(entry)) {
          deduplicated.push(entry);
        }
      }

      // Keep only max entries (most recent)
      this.entries = deduplicated.slice(-this.config.maxEntries);
    } catch (err) {
      if (!isFileNotFoundError(err)) {
        // Log error but continue with empty history
        log.error(`Failed to load history: ${err}`);
      }
      this.entries = [];
      this.lineCount = 0;
    }
  }

  /**
   * Get commands as string array (for ReplState compatibility).
   * Returns commands in chronological order (oldest first).
   */
  getCommands(): string[] {
    return this.entries.map((e) => e.cmd);
  }

  /**
   * Get structured history entries in chronological order (oldest first).
   */
  getEntries(): HistoryEntry[] {
    return this.entries.map((entry) => ({
      ...entry,
      attachments: entry.attachments?.length
        ? cloneAttachments(entry.attachments)
        : undefined,
    }));
  }

  /**
   * Append a command (queues for debounced save).
   * Fire-and-forget - returns immediately.
   */
  append(cmd: string, metadata: HistoryEntryMetadata = {}): HistoryEntry | null {
    const trimmed = cmd.trim();
    if (!trimmed) return null;
    const attachments = metadata.attachments?.length
      ? cloneAttachments(metadata.attachments)
      : undefined;

    // Skip consecutive duplicates
    const last = this.entries[this.entries.length - 1];
    if (
      last &&
      getHistoryEntryKey(last) === getHistoryEntryKey({
        cmd: trimmed,
        source: metadata.source,
        language: metadata.language,
        attachments,
      })
    ) {
      return null;
    }

    const entry: HistoryEntry = {
      ts: Date.now(),
      cmd: trimmed,
      source: metadata.source,
      language: metadata.language,
      attachments,
    };

    // Add to in-memory array
    this.entries.push(entry);

    // Trim if over limit
    if (this.entries.length > this.config.maxEntries) {
      this.entries = this.entries.slice(-this.config.maxEntries);
    }

    // Queue for save
    this.pendingWrites.push(entry);
    this.scheduleSave();
    return {
      ...entry,
      attachments: entry.attachments?.length
        ? cloneAttachments(entry.attachments)
        : undefined,
    };
  }

  /**
   * Schedule a debounced save.
   */
  private scheduleSave(): void {
    if (this.saveTimeoutId !== null) return;

    this.saveTimeoutId = setTimeout(async () => {
      this.saveTimeoutId = null;
      await this.flush();
    }, this.config.saveDebounceMs);
  }

  /**
   * Schedule a compaction if the on-disk file is oversized.
   */
  private maybeScheduleCompaction(): void {
    if (this.compacting || this.compactScheduled) return;
    if (this.lineCount <= this.config.maxEntries * 2) return;

    this.compactScheduled = true;
    queueMicrotask(async () => {
      this.compactScheduled = false;
      await this.compact();
    });
  }

  /**
   * Flush pending writes to disk.
   * Appends to file (no read-modify-write).
   */
  async flush(): Promise<void> {
    if (this.pendingWrites.length === 0) return;

    const toWrite = this.pendingWrites.splice(0);
    const path = getHistoryPath();

    try {
      await ensureHlvmDir();
      const lines = await serializeHistoryEntries(toWrite);
      await getPlatform().fs.writeTextFile(path, lines, { append: true });
      this.lineCount += toWrite.length;
      this.maybeScheduleCompaction();
    } catch (err) {
      // Re-queue on failure
      this.pendingWrites.unshift(...toWrite);
      log.error(`Failed to save history: ${err}`);
    }
  }

  /**
   * Force synchronous flush (for process exit).
   * Best effort - errors are ignored.
   */
  flushSync(): void {
    if (this.pendingWrites.length === 0) return;

    try {
      const path = getHistoryPath();
      ensureHlvmDirSync();
      const lines = serializeJsonLines(
        this.pendingWrites.map((entry) => toPersistedHistoryEntrySync(entry)),
      );
      getPlatform().fs.writeTextFileSync(path, lines, { append: true });
      this.lineCount += this.pendingWrites.length;
      this.pendingWrites = [];
      this.maybeScheduleCompaction();
    } catch {
      // Best effort - ignore errors on exit
    }
  }

  /**
   * Clear all history (memory and disk).
   */
  async clear(): Promise<void> {
    // Clear pending saves
    if (this.saveTimeoutId !== null) {
      clearTimeout(this.saveTimeoutId);
      this.saveTimeoutId = null;
    }

    this.entries = [];
    this.pendingWrites = [];
    this.lineCount = 0;

    try {
      await getPlatform().fs.remove(getHistoryPath());
    } catch (err) {
      if (!isFileNotFoundError(err)) {
        throw err;
      }
    }

    try {
      await getPlatform().fs.remove(getHistoryPasteStoreDir(), { recursive: true });
    } catch (err) {
      if (!isFileNotFoundError(err)) {
        throw err;
      }
    }
  }

  /**
   * Compact history file.
   * Atomic operation: write to temp file, then rename.
   */
  async compact(): Promise<void> {
    if (this.compacting) return;
    this.compacting = true;

    try {
      // Flush pending writes first
      await this.flush();

      const path = getHistoryPath();
      // Keep only maxEntries
      const toKeep = this.entries.slice(-this.config.maxEntries);

      // Atomic write: temp file + rename
      await atomicWriteTextFile(path, serializeJsonLines(toKeep));

      this.entries = toKeep;
      this.lineCount = toKeep.length;
    } catch (err) {
      log.error(`Failed to compact history: ${err}`);
    } finally {
      this.compacting = false;
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _instance: HistoryStorage | null = null;

/**
 * Get the singleton HistoryStorage instance.
 * Creates it on first call.
 */
export function getHistoryStorage(
  config?: Partial<HistoryStorageConfig>,
): HistoryStorage {
  if (!_instance) {
    _instance = new HistoryStorage(config);
  }
  return _instance;
}
