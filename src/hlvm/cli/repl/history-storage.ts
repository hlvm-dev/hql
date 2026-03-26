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
} from "../../../common/paths.ts";
import { getLegacyHistoryPath } from "../../../common/legacy-migration.ts";
import {
  appendJsonLines,
  atomicWriteTextFile,
  parseJsonLines,
  readJsonLines,
  serializeJsonLines,
} from "../../../common/jsonl.ts";
import { isFileNotFoundError } from "../../../common/utils.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import type { ComposerLanguage } from "./composer-language.ts";

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
}

export interface HistoryEntry {
  ts: number; // Unix timestamp in milliseconds
  cmd: string; // The command
  source?: HistoryEntrySource;
  language?: ComposerLanguage;
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

let legacyMigrationChecked = false;

function getHistoryEntryKey(entry: Pick<HistoryEntry, "cmd" | "source" | "language">): string {
  return `${entry.cmd}\u0000${entry.source ?? ""}\u0000${entry.language ?? ""}`;
}

function toHistoryEntry(value: unknown): HistoryEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entry = value as {
    cmd?: unknown;
    ts?: unknown;
    source?: unknown;
    language?: unknown;
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
  return {
    cmd: entry.cmd,
    ts: entry.ts,
    source: entry.source as HistoryEntrySource | undefined,
    language: entry.language as ComposerLanguage | undefined,
  };
}

function parseHistoryContent(content: string): HistoryEntry[] {
  return parseJsonLines(content, toHistoryEntry);
}

function readHistoryEntries(path: string): Promise<HistoryEntry[]> {
  return readJsonLines(path, toHistoryEntry);
}

async function writeHistoryEntries(
  path: string,
  entries: HistoryEntry[],
): Promise<void> {
  await ensureHlvmDir();
  const content = serializeJsonLines(entries);
  await getPlatform().fs.writeTextFile(path, content);
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
      const allEntries = parseHistoryContent(content);
      // Derive line count from parsed entries (avoids re-splitting content)
      this.lineCount = allEntries.length;

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
    return this.entries.map((entry) => ({ ...entry }));
  }

  /**
   * Append a command (queues for debounced save).
   * Fire-and-forget - returns immediately.
   */
  append(cmd: string, metadata: HistoryEntryMetadata = {}): HistoryEntry | null {
    const trimmed = cmd.trim();
    if (!trimmed) return null;

    // Skip consecutive duplicates
    const last = this.entries[this.entries.length - 1];
    if (
      last &&
      getHistoryEntryKey(last) === getHistoryEntryKey({
        cmd: trimmed,
        source: metadata.source,
        language: metadata.language,
      })
    ) {
      return null;
    }

    const entry: HistoryEntry = {
      ts: Date.now(),
      cmd: trimmed,
      source: metadata.source,
      language: metadata.language,
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
    return { ...entry };
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
      await appendJsonLines(path, toWrite);
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
      const lines = serializeJsonLines(this.pendingWrites);
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
