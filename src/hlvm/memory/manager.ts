/**
 * Memory Manager - Orchestration layer for the memory system
 *
 * Handles:
 * - Loading memory context for system prompts
 * - One-time migration from JSONL to MEMORY.md
 */

import { getPlatform } from "../../platform/platform.ts";
import {
  getAgentMemoryPath,
  getMemoryMdPath,
} from "../../common/paths.ts";
import { readMemoryMd, readRecentJournals, writeMemoryMd } from "./store.ts";
import { estimateTokensFromText } from "../../common/token-utils.ts";

// ============================================================
// Migration
// ============================================================

let _migrationDone = false;

/**
 * One-time migration from ~/.hlvm/agent-memory.jsonl to MEMORY.md.
 * Idempotent — only runs once per process and only if old file exists.
 */
async function migrateFromJsonl(): Promise<void> {
  if (_migrationDone) return;
  _migrationDone = true;

  const fs = getPlatform().fs;
  const oldPath = getAgentMemoryPath();
  const newPath = getMemoryMdPath();

  // Skip if old file doesn't exist
  try {
    await fs.stat(oldPath);
  } catch {
    return; // No old file to migrate
  }

  // Skip if MEMORY.md already has migrated content
  const existing = await readMemoryMd();
  if (existing.includes("# Migrated")) return;

  // Read old JSONL entries
  try {
    const raw = await fs.readTextFile(oldPath);
    const lines = raw.split("\n").filter((l) => l.trim());
    const entries: string[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry?.content) {
          const tags = entry.tags?.length ? ` [${entry.tags.join(", ")}]` : "";
          const date = entry.createdAt
            ? ` (${entry.createdAt.slice(0, 10)})`
            : "";
          entries.push(`- ${entry.content}${tags}${date}`);
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (entries.length === 0) return;

    // Write to MEMORY.md
    const migrated = `# Migrated\n\n${entries.join("\n")}\n`;
    const newContent = existing
      ? existing.trimEnd() + "\n\n" + migrated
      : migrated;
    await writeMemoryMd(newContent);

    // Rename old file as backup
    try {
      const backupPath = oldPath + ".bak";
      const content = await fs.readTextFile(oldPath);
      await fs.writeTextFile(backupPath, content);
      await fs.remove(oldPath);
    } catch {
      // Best-effort backup — don't fail migration if rename fails
    }
  } catch {
    // Migration is best-effort — don't block agent startup
  }
}

// ============================================================
// Context Loading
// ============================================================

/**
 * Load memory context for injection into the system prompt.
 *
 * Budget-aware:
 * - >= 32K tokens: MEMORY.md + today + yesterday journals
 * - 16K-32K tokens: MEMORY.md + today's journal only
 * - < 16K tokens: MEMORY.md only
 *
 * @param contextWindow Available context window in tokens
 * @returns Formatted memory context string, or "" if no memory exists
 */
export async function loadMemoryContext(
  contextWindow: number,
): Promise<string> {
  // Run migration on first load (idempotent)
  await migrateFromJsonl();

  const memoryMd = await readMemoryMd();

  // Determine how many journal days to include
  let journalDays = 0;
  if (contextWindow >= 32_000) {
    journalDays = 2; // today + yesterday
  } else if (contextWindow >= 16_000) {
    journalDays = 1; // today only
  }

  const journals = journalDays > 0
    ? await readRecentJournals(journalDays)
    : [];

  // Build context string
  const parts: string[] = [];

  if (memoryMd.trim()) {
    parts.push(memoryMd.trim());
  }

  if (journals.length > 0) {
    const journalText = journals
      .map((j) => `### ${j.date}\n${j.content.trim()}`)
      .join("\n\n");
    parts.push(`## Recent Context\n\n${journalText}`);
  }

  if (parts.length === 0) return "";

  const combined = parts.join("\n\n");

  // Warn if memory is getting large
  const tokens = estimateTokensFromText(combined);
  if (tokens > 3000) {
    try {
      const { getAgentLogger } = await import("../agent/logger.ts");
      getAgentLogger().warn(
        `Memory context is large (~${tokens} tokens). Consider consolidating MEMORY.md.`,
      );
    } catch {
      // Logger not available — skip warning
    }
  }

  return combined;
}

/** Reset migration flag (for testing) */
export function resetMigrationForTesting(): void {
  _migrationDone = false;
}
