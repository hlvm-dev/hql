/**
 * Explicit Memory - SSOT for user-facing MEMORY.md I/O
 *
 * Provides read/write access to ~/.hlvm/memory/MEMORY.md,
 * the user-authored notes file that the AI assistant sees every turn.
 */

import { getPlatform } from "../../platform/platform.ts";
import { ensureMemoryDirs, getMemoryMdPath } from "../../common/paths.ts";

const DEFAULT_MEMORY_MD = `# My Notes
Write anything here. The AI assistant will see this content every turn.
`;

/** Get the path to the explicit memory file (~/.hlvm/memory/MEMORY.md) */
export function getExplicitMemoryPath(): string {
  return getMemoryMdPath();
}

async function readOrInitializeExplicitMemory(): Promise<string> {
  const fs = getPlatform().fs;
  const mdPath = getMemoryMdPath();
  try {
    return await fs.readTextFile(mdPath);
  } catch {
    // File doesn't exist — create it with a default template.
    try {
      await ensureMemoryDirs();
      await fs.writeTextFile(mdPath, DEFAULT_MEMORY_MD);
    } catch {
      // Best-effort: if we can't write, that's fine — just return default.
    }
    return DEFAULT_MEMORY_MD;
  }
}

/**
 * Read the user-facing MEMORY.md file. If it doesn't exist, create it with
 * a default header. Returns the trimmed content (empty string if blank).
 */
export async function readExplicitMemory(): Promise<string> {
  return (await readOrInitializeExplicitMemory()).trim();
}

/**
 * Append a note to the user-facing MEMORY.md file.
 * Used by the (remember "text") REPL helper.
 */
export async function appendExplicitMemoryNote(text: string): Promise<void> {
  const fs = getPlatform().fs;
  const mdPath = getMemoryMdPath();
  let content = await readOrInitializeExplicitMemory();

  // Ensure content ends with newline before appending
  if (!content.endsWith("\n")) {
    content += "\n";
  }
  content += `${text}\n`;
  await fs.writeTextFile(mdPath, content);
}

/**
 * Replace literal text inside MEMORY.md.
 * Returns the number of replacements applied.
 */
export async function replaceExplicitMemoryText(
  findText: string,
  replaceWith: string,
): Promise<number> {
  if (!findText) return 0;

  const fs = getPlatform().fs;
  const mdPath = getMemoryMdPath();
  const content = await readOrInitializeExplicitMemory();
  const replacements = content.split(findText).length - 1;
  if (replacements <= 0) return 0;

  await fs.writeTextFile(mdPath, content.split(findText).join(replaceWith));
  return replacements;
}

/**
 * Overwrite MEMORY.md with explicit content.
 */
export async function writeExplicitMemory(content: string): Promise<void> {
  await ensureMemoryDirs();
  await getPlatform().fs.writeTextFile(getMemoryMdPath(), content);
}

/**
 * Clear explicit notes while keeping the notes file in place.
 */
export async function clearExplicitMemory(): Promise<void> {
  await writeExplicitMemory("");
}
