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

  // Replace all mentions with resolved content
  let result = input;
  for (const [mention, resolved] of replacements) {
    // Escape the mention for regex (handle special chars like .)
    const escaped = mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), resolved);
  }

  return result;
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
      // Extract the path after @
      const match = input.slice(i).match(/^@([a-zA-Z0-9_\-./]+)/);
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
    const stat = await Deno.stat(path);

    if (stat.isDirectory) {
      return await resolveDirectory(path);
    } else if (stat.isFile) {
      return await resolveFile(path);
    } else {
      return `"[${mention}: unknown type]"`;
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
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
    for await (const entry of Deno.readDir(path)) {
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
    const content = await Deno.readTextFile(path);

    // Escape quotes and newlines for string literal
    const escaped = content
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");

    // Truncate if too long (for REPL usability)
    const maxLen = 10000;
    if (escaped.length > maxLen) {
      return `"${escaped.slice(0, maxLen)}\\n... [truncated, ${content.length} chars total]"`;
    }

    return `"${escaped}"`;
  } catch {
    return `"[${path}: cannot read file]"`;
  }
}

/**
 * Check if input contains any @ mentions
 */
export function hasAtMentions(input: string): boolean {
  const mentions = findMentions(input);
  return mentions.length > 0;
}
