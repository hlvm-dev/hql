/**
 * @ Mention Resolver
 *
 * Resolves @path mentions in REPL input before evaluation.
 * - @file.txt → reads file content as string
 * - @directory/ → lists directory contents
 *
 * This allows Claude Code-style file references in HQL:
 *   (ask @docs/)  →  (ask "[docs/: README.md, api/, features/]")
 *   (ask @file.ts) →  (ask "...file content...")
 */

import { escapeString } from "./string-utils.ts";
import { MAX_SEQ_LENGTH } from "../../../common/limits.ts";
import { getPlatform } from "../../../platform/platform.ts";

// Pre-compiled regex patterns (avoid repeated compilation)
const MENTION_PATH_REGEX = /^@([a-zA-Z0-9_\-./]+)/;

/**
 * Resolve all @ mentions in input to their actual content
 */
export async function resolveAtMentions(input: string): Promise<string> {
  // Find all mentions (avoiding those inside strings)
  const mentions = findMentions(input);

  if (mentions.length === 0) {
    return input;
  }

  // Resolve each mention and build replacement map
  const replacements = new Map<string, string>();

  for (const mention of mentions) {
    if (replacements.has(mention)) continue; // Already resolved

    const resolved = await resolveMention(mention);
    replacements.set(mention, resolved);
  }

  // Replace all mentions in a single pass using regex alternation
  // This is O(n) instead of O(n²) from multiple replaceAll calls
  const entries = Array.from(replacements.entries());
  const pattern = new RegExp(
    entries.map(([k]) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "g"
  );
  return input.replace(pattern, (match) => replacements.get(match) ?? match);
}

/**
 * Find all @mentions in input (not inside string literals)
 */
function findMentions(input: string): string[] {
  const mentions: string[] = [];
  let inString = false;
  let stringChar = "";
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Handle string boundaries
    if ((ch === '"' || ch === "'") && (i === 0 || input[i - 1] !== "\\")) {
      if (!inString) {
        inString = true;
        stringChar = ch;
      } else if (ch === stringChar) {
        inString = false;
      }
      i++;
      continue;
    }

    // Skip if inside string
    if (inString) {
      i++;
      continue;
    }

    // Check for @ mention
    if (ch === "@") {
      // Extract the path after @ (uses module-level pre-compiled regex)
      const match = input.slice(i).match(MENTION_PATH_REGEX);
      if (match) {
        mentions.push(match[0]); // Include the @
        i += match[0].length;
        continue;
      }
    }

    i++;
  }

  return mentions;
}

/**
 * Resolve a single @mention to its content
 */
async function resolveMention(mention: string): Promise<string> {
  // Remove @ prefix
  const path = mention.slice(1);

  try {
    const stat = await getPlatform().fs.stat(path);

    if (stat.isDirectory) {
      return await resolveDirectory(path);
    } else if (stat.isFile) {
      return await resolveFile(path);
    } else {
      return `"[${mention}: unknown type]"`;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "NotFound") {
      return `"[${mention}: not found]"`;
    }
    return `"[${mention}: error reading]"`;
  }
}

/**
 * Resolve a directory mention to a listing
 */
async function resolveDirectory(path: string): Promise<string> {
  const entries: string[] = [];

  try {
    for await (const entry of getPlatform().fs.readDir(path)) {
      const name = entry.isDirectory ? `${entry.name}/` : entry.name;
      entries.push(name);
    }

    // Sort: directories first, then files
    entries.sort((a, b) => {
      const aIsDir = a.endsWith("/");
      const bIsDir = b.endsWith("/");
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });

    // Format as a readable string
    const listing = entries.join(", ");
    return `"[${path}: ${listing}]"`;
  } catch {
    return `"[${path}: cannot read directory]"`;
  }
}

/**
 * Resolve a file mention to its content
 */
async function resolveFile(path: string): Promise<string> {
  try {
    const content = await getPlatform().fs.readTextFile(path);

    // Escape quotes and newlines for string literal
    const escaped = escapeString(content);

    // Truncate if too long (for REPL usability)
    if (escaped.length > MAX_SEQ_LENGTH) {
      return `"${escaped.slice(0, MAX_SEQ_LENGTH)}\\n... [truncated, ${content.length} chars total]"`;
    }

    return `"${escaped}"`;
  } catch {
    return `"[${path}: cannot read file]"`;
  }
}

