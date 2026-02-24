/**
 * Memory Store - File I/O layer for MEMORY.md and journal files
 *
 * All I/O via getPlatform().fs.* (SSOT). Paths from paths.ts.
 */

import { getPlatform } from "../../platform/platform.ts";
import {
  ensureMemoryDirs,
  getJournalDir,
  getMemoryMdPath,
} from "../../common/paths.ts";

// ============================================================
// Write Lock — serializes concurrent MEMORY.md / journal writes
// ============================================================

let _lockTail: Promise<void> = Promise.resolve();

/** Serialize async writes to prevent concurrent file corruption. */
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _lockTail;
  let resolve: () => void;
  _lockTail = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

/**
 * Atomic write: write to .tmp then rename (POSIX-atomic).
 * Prevents half-written files if process crashes mid-write.
 */
async function atomicWriteTextFile(path: string, content: string): Promise<void> {
  const platform = getPlatform();
  const tmpPath = path + ".tmp";
  await platform.fs.writeTextFile(tmpPath, content);
  await platform.fs.rename(tmpPath, path);
}

// ============================================================
// Logger Helper — DRY wrapper for optional agent logger
// ============================================================

export async function warnMemory(msg: string): Promise<void> {
  try {
    const { getAgentLogger } = await import("../agent/logger.ts");
    getAgentLogger().warn(msg);
  } catch { /* Logger not available */ }
}

// ============================================================
// Sensitive Content Filter
// ============================================================

const SENSITIVE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, label: "SSN" },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, label: "credit card" },
  { pattern: /\b(sk|pk|api[_-]?key|secret)[_-]?\w{20,}/gi, label: "API key" },
  { pattern: /(password|passwd|pwd)\s*[:=]\s*\S+/gi, label: "password" },
];

/**
 * Strip sensitive content from text before writing to memory.
 * Returns sanitized text and a list of what was stripped.
 */
export function sanitizeSensitiveContent(
  text: string,
): { sanitized: string; stripped: string[] } {
  const stripped: string[] = [];
  let sanitized = text;
  for (const { pattern, label } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(sanitized)) {
      stripped.push(label);
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, `[REDACTED:${label}]`);
    }
  }
  return { sanitized, stripped };
}

// ============================================================
// MEMORY.md Operations
// ============================================================

/**
 * Find the start index of a ## section header in content.
 * Returns -1 if not found. Uses exact match with \n to avoid prefix collisions.
 */
function findSectionStart(content: string, section: string): number {
  const header = `## ${section}`;
  if (content.includes(header + "\n")) return content.indexOf(header + "\n");
  if (content.endsWith(header)) return content.length - header.length;
  return -1;
}

/**
 * Find the end index of a section (start of next ## or end of content).
 */
function findSectionEnd(content: string, sectionStartIdx: number, section: string): number {
  const afterHeader = sectionStartIdx + `## ${section}`.length;
  const nextSection = content.indexOf("\n## ", afterHeader);
  return nextSection >= 0 ? nextSection : content.length;
}

/** Read MEMORY.md content, return "" if missing */
export async function readMemoryMd(): Promise<string> {
  try {
    return await getPlatform().fs.readTextFile(getMemoryMdPath());
  } catch {
    return "";
  }
}

/** Write full MEMORY.md content (sanitizes sensitive data before writing) */
export function writeMemoryMd(content: string): Promise<void> {
  return withWriteLock(async () => {
    const { sanitized, stripped } = sanitizeSensitiveContent(content);
    if (stripped.length > 0) {
      await warnMemory(`Memory: stripped sensitive content from full write (${stripped.join(", ")})`);
    }
    await ensureMemoryDirs();
    await atomicWriteTextFile(getMemoryMdPath(), sanitized);
  });
}

/**
 * Append content to MEMORY.md, optionally under a section header.
 * Creates the file if it doesn't exist.
 */
export function appendToMemoryMd(
  content: string,
  section?: string,
): Promise<void> {
  return withWriteLock(async () => {
    const { sanitized, stripped } = sanitizeSensitiveContent(content);
    if (stripped.length > 0) {
      await warnMemory(`Memory: stripped sensitive content (${stripped.join(", ")})`);
    }

    await ensureMemoryDirs();
    const existing = await readMemoryMd();

    let newContent: string;
    if (section) {
      const idx = findSectionStart(existing, section);
      if (idx >= 0) {
        const insertPoint = findSectionEnd(existing, idx, section);
        newContent = existing.slice(0, insertPoint) +
          "\n" + sanitized + "\n" +
          existing.slice(insertPoint);
      } else {
        newContent = existing.trimEnd() + "\n\n" + `## ${section}` + "\n" +
          sanitized + "\n";
      }
    } else {
      newContent = existing.trimEnd() + "\n\n" + sanitized + "\n";
    }

    await atomicWriteTextFile(getMemoryMdPath(), newContent);
  });
}

// ============================================================
// Journal Operations
// ============================================================

function getJournalPath(date: string): string {
  return getPlatform().path.join(getJournalDir(), `${date}.md`);
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentTime(): string {
  return new Date().toISOString().slice(11, 16);
}

/** Append to today's journal with HH:MM timestamp */
export function appendToJournal(content: string): Promise<void> {
  return withWriteLock(async () => {
    const { sanitized, stripped } = sanitizeSensitiveContent(content);
    if (stripped.length > 0) {
      await warnMemory(`Memory: stripped sensitive content from journal (${stripped.join(", ")})`);
    }

    await ensureMemoryDirs();
    const date = todayDate();
    const journalPath = getJournalPath(date);
    const time = currentTime();

    let existing = "";
    try {
      existing = await getPlatform().fs.readTextFile(journalPath);
    } catch {
      // File doesn't exist yet
    }

    const entry = `## ${time}\n${sanitized}\n`;
    const newContent = existing
      ? existing.trimEnd() + "\n\n" + entry
      : `# Journal ${date}\n\n${entry}`;

    await atomicWriteTextFile(journalPath, newContent);
  });
}

/** Read a specific day's journal */
export async function readJournal(date: string): Promise<string> {
  try {
    return await getPlatform().fs.readTextFile(getJournalPath(date));
  } catch {
    return "";
  }
}

/** Read today + N previous days of journals */
export async function readRecentJournals(
  days: number,
): Promise<{ date: string; content: string }[]> {
  const results: { date: string; content: string }[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const content = await readJournal(date);
    if (content) {
      results.push({ date, content });
    }
  }

  return results;
}

// ============================================================
// MEMORY.md Edit Operations
// ============================================================

/** Remove an entire ## section from MEMORY.md. Returns true if found and removed. */
export function removeSectionFromMemoryMd(section: string): Promise<boolean> {
  return withWriteLock(async () => {
    const existing = await readMemoryMd();
    const idx = findSectionStart(existing, section);
    if (idx < 0) return false;

    const endIdx = findSectionEnd(existing, idx, section);
    const newContent = (existing.slice(0, idx) + existing.slice(endIdx))
      .replace(/\n{3,}/g, "\n\n").trim();

    await ensureMemoryDirs();
    await atomicWriteTextFile(getMemoryMdPath(), newContent ? newContent + "\n" : "");
    return true;
  });
}

/** Find and replace text in MEMORY.md. Returns number of replacements made. */
export function replaceInMemoryMd(find: string, replaceWith: string): Promise<number> {
  return withWriteLock(async () => {
    const existing = await readMemoryMd();
    if (!existing.includes(find)) return 0;

    const { sanitized, stripped } = sanitizeSensitiveContent(replaceWith);
    if (stripped.length > 0) {
      await warnMemory(`Memory: stripped sensitive content from replacement (${stripped.join(", ")})`);
    }

    let count = 0;
    const newContent = existing.replaceAll(find, () => { count++; return sanitized; });

    await ensureMemoryDirs();
    await atomicWriteTextFile(getMemoryMdPath(), newContent);
    return count;
  });
}
