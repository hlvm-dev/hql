/**
 * Recursive Directory Reader
 *
 * Reads all text files in a directory recursively and assembles them
 * into a single string for inclusion as context (via @dir/ completion).
 */

import { getPlatform } from "../../../platform/platform.ts";
import { walkDirectory, loadGitignore } from "../../../common/file-utils.ts";

const DEFAULT_MAX_FILES = 50;
const DEFAULT_MAX_TOTAL_SIZE = 512_000; // 500KB
const BINARY_CHECK_SIZE = 512;

/**
 * Check if a byte buffer appears to be binary (contains null bytes).
 */
function isBinaryContent(bytes: Uint8Array): boolean {
  const checkLen = Math.min(bytes.length, BINARY_CHECK_SIZE);
  for (let i = 0; i < checkLen; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

/**
 * Load gitignore patterns, merging root and target directory .gitignore files.
 * This ensures patterns from the project root (e.g., node_modules/) apply
 * even when reading a subdirectory like src/.
 */
async function loadMergedGitignore(dirPath: string) {
  const platform = getPlatform();
  const cwd = platform.env.get("PWD") ?? ".";
  const resolved = platform.path.resolve(dirPath);

  // Always load from target directory
  const ig = await loadGitignore(resolved);

  // Also load from CWD (project root) if it's a parent of dirPath
  if (resolved !== cwd && resolved.startsWith(cwd)) {
    try {
      const rootGitignorePath = platform.path.join(cwd, ".gitignore");
      const content = await platform.fs.readTextFile(rootGitignorePath);
      ig.add(content);
    } catch {
      // No root .gitignore — fine
    }
  }

  return ig;
}

/**
 * Recursively read all text files in a directory.
 * Respects .gitignore (both root and local), skips binary files,
 * caps at file/size limits.
 *
 * @returns Assembled string with file headers
 */
export async function readDirectoryRecursive(
  dirPath: string,
  options?: { maxFiles?: number; maxTotalSize?: number },
): Promise<string> {
  const platform = getPlatform();
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotalSize = options?.maxTotalSize ?? DEFAULT_MAX_TOTAL_SIZE;
  const decoder = new TextDecoder();

  const dirName = platform.path.basename(dirPath);
  const ig = await loadMergedGitignore(dirPath);

  const parts: string[] = [];
  let fileCount = 0;
  let totalSize = 0;
  let truncated = false;

  for await (const entry of walkDirectory({ baseDir: dirPath, gitignorePatterns: ig })) {
    if (entry.isDirectory) continue;

    if (fileCount >= maxFiles) {
      truncated = true;
      break;
    }

    try {
      // Skip files larger than remaining budget (avoids reading huge binaries into memory)
      const stat = await platform.fs.stat(entry.fullPath);
      if (stat.size > maxTotalSize - totalSize) {
        continue;
      }

      const bytes = await platform.fs.readFile(entry.fullPath);
      if (isBinaryContent(bytes)) continue;

      const content = decoder.decode(bytes);
      parts.push(`--- ${entry.path} ---\n${content}`);
      fileCount++;
      totalSize += content.length;
    } catch {
      // Skip unreadable files
    }
  }

  const truncNote = truncated
    ? `\n(truncated: ${fileCount} files, ${Math.round(totalSize / 1024)}KB shown)`
    : "";

  return `--- Start of directory: ${dirName} ---\n${parts.join("\n\n")}${truncNote}\n--- End of directory: ${dirName} ---`;
}
