import { LRUCache } from "../../common/lru-cache.ts";
import { fnv1aHex } from "../../common/hash.ts";
import { estimateTokensFromCharCount } from "../../common/token-utils.ts";
import { TEXT_ENCODER } from "../../common/utils.ts";

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_RESTORATION_LIMIT = 5;
const MAX_RESTORATION_TOKENS_PER_FILE = 5_000;
const MAX_RESTORATION_TOKENS_TOTAL = 50_000;

interface FileStateEntry {
  path: string;
  contentHash: string;
  mtimeMs?: number;
  readTimestamp: number;
  sizeBytes: number;
  isPartialView: boolean;
  content?: string;
}

interface FileStateConflictResult {
  ok: boolean;
  entry?: FileStateEntry;
  reason?: string;
}

export interface FileRestorationHint {
  path: string;
  content: string;
  estimatedTokens: number;
  readTimestamp: number;
}

interface FileStateCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
}

export class FileStateCache {
  private readonly cache: LRUCache<string, FileStateEntry>;
  private readonly maxBytes: number;
  private totalBytes = 0;

  constructor(options: FileStateCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.cache = new LRUCache<string, FileStateEntry>(
      options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      (_key, value) => {
        this.totalBytes = Math.max(0, this.totalBytes - value.sizeBytes);
      },
    );
  }

  trackRead(input: {
    path: string;
    content: string;
    mtimeMs?: number;
    isPartialView?: boolean;
  }): FileStateEntry {
    const normalizedPath = input.path;
    const isPartialView = input.isPartialView === true;
    const sizeBytes = TEXT_ENCODER.encode(input.content).length;
    const entry: FileStateEntry = {
      path: normalizedPath,
      contentHash: fnv1aHex(input.content),
      mtimeMs: input.mtimeMs,
      readTimestamp: Date.now(),
      sizeBytes,
      isPartialView,
      content: isPartialView ? undefined : input.content,
    };
    const existing = this.cache.get(normalizedPath);
    if (existing) {
      this.totalBytes = Math.max(0, this.totalBytes - existing.sizeBytes);
      this.cache.delete(normalizedPath, true);
    }
    this.cache.set(normalizedPath, entry);
    this.totalBytes += entry.sizeBytes;
    this.trimToBudget();
    return entry;
  }

  get(path: string): FileStateEntry | undefined {
    return this.cache.get(path);
  }

  requireFullView(path: string): FileStateConflictResult {
    const entry = this.cache.get(path);
    if (!entry) {
      return {
        ok: false,
        reason: "File has not been fully read in this session. Re-read with read_file before editing.",
      };
    }
    if (entry.isPartialView) {
      return {
        ok: false,
        entry,
        reason: "File was only partially viewed in this session. Re-read with read_file before editing.",
      };
    }
    return { ok: true, entry };
  }

  checkConflict(
    path: string,
    current: { content: string; mtimeMs?: number },
  ): FileStateConflictResult {
    const entry = this.cache.get(path);
    if (!entry) return { ok: true };
    if (entry.isPartialView) {
      return {
        ok: false,
        entry,
        reason: "File was only partially viewed in this session. Re-read with read_file before overwriting.",
      };
    }
    const currentHash = fnv1aHex(current.content);
    const mtimeChanged = entry.mtimeMs !== undefined &&
      current.mtimeMs !== undefined &&
      entry.mtimeMs !== current.mtimeMs;
    const hashChanged = entry.contentHash !== currentHash;
    if (!mtimeChanged && !hashChanged) {
      return { ok: true, entry };
    }
    return {
      ok: false,
      entry,
      reason: "File changed since it was last read in this session. Re-read before editing or overwriting.",
    };
  }

  invalidate(path: string): void {
    this.cache.delete(path);
  }

  buildRestorationHints(
    maxContextTokens: number,
  ): FileRestorationHint[] {
    const aggregateBudget = Math.min(
      MAX_RESTORATION_TOKENS_TOTAL,
      Math.floor(maxContextTokens * 0.25),
    );
    if (aggregateBudget <= 0) return [];

    const entries = [...this.cache.values()]
      .filter((entry) => !entry.isPartialView && typeof entry.content === "string")
      .sort((a, b) => b.readTimestamp - a.readTimestamp)
      .slice(0, DEFAULT_RESTORATION_LIMIT);

    const hints: FileRestorationHint[] = [];
    let usedBudget = 0;
    for (const entry of entries) {
      const content = entry.content!;
      const charsPerFile = MAX_RESTORATION_TOKENS_PER_FILE * 4;
      const excerpt = content.length > charsPerFile
        ? `${content.slice(0, charsPerFile)}\n[truncated for restoration hint]`
        : content;
      const estimatedTokens = estimateTokensFromCharCount(excerpt.length);
      if (usedBudget + estimatedTokens > aggregateBudget) continue;
      hints.push({
        path: entry.path,
        content: excerpt,
        estimatedTokens,
        readTimestamp: entry.readTimestamp,
      });
      usedBudget += estimatedTokens;
    }
    return hints;
  }

  private trimToBudget(): void {
    while (this.totalBytes > this.maxBytes && this.cache.size > 0) {
      const oldestKey = this.cache.keys().next();
      if (oldestKey.done) break;
      this.cache.delete(oldestKey.value);
    }
  }
}
