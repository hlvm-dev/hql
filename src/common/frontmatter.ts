/**
 * Shared YAML Frontmatter Parser
 *
 * Extracts YAML frontmatter from markdown files. Used by agent profiles
 * (.hlvm/agents/*.md) and skills (.hlvm/skills/*.md).
 *
 * Format:
 * ---
 * key: value
 * ---
 * Body content here.
 */

import { parse as parseYaml } from "npm:yaml@2.0.0-1";

/** Split markdown text into optional YAML frontmatter string and body. */
export function splitFrontmatter(
  text: string,
): { frontmatter?: string; body: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { body: normalized.trim() };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    return { body: normalized.trim() };
  }
  return {
    frontmatter: normalized.slice(4, end),
    body: normalized.slice(end + 5).trim(),
  };
}

/** Split and parse frontmatter as YAML. Returns null meta on parse error. */
export function parseFrontmatter<T = Record<string, unknown>>(
  text: string,
): { meta: T | null; body: string } {
  const { frontmatter, body } = splitFrontmatter(text);
  if (!frontmatter) return { meta: null, body };
  try {
    return { meta: parseYaml(frontmatter) as T, body };
  } catch {
    return { meta: null, body };
  }
}
