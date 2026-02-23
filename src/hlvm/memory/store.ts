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
    await getPlatform().fs.writeTextFile(getMemoryMdPath(), sanitized);
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
      const sectionHeader = `## ${section}`;
      // Match "## Section\n" exactly to avoid prefix collisions (e.g. "Prefer" vs "Preferences")
      const idx = existing.includes(sectionHeader + "\n")
        ? existing.indexOf(sectionHeader + "\n")
        : existing.endsWith(sectionHeader)
          ? existing.length - sectionHeader.length
          : -1;
      if (idx >= 0) {
        // Find end of section (next ## or end of file)
        const afterHeader = idx + sectionHeader.length;
        const nextSection = existing.indexOf("\n## ", afterHeader);
        const insertPoint = nextSection >= 0 ? nextSection : existing.length;
        newContent = existing.slice(0, insertPoint) +
          "\n" + sanitized + "\n" +
          existing.slice(insertPoint);
      } else {
        // Create new section at end
        newContent = existing.trimEnd() + "\n\n" + sectionHeader + "\n" +
          sanitized + "\n";
      }
    } else {
      newContent = existing.trimEnd() + "\n\n" + sanitized + "\n";
    }

    await getPlatform().fs.writeTextFile(getMemoryMdPath(), newContent);
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

    await getPlatform().fs.writeTextFile(journalPath, newContent);
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
