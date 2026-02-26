/**
 * Regression tests for sync-docs.mjs output quality.
 *
 * WHY THESE TESTS EXIST:
 * - The sync script transforms markdown links from source docs into /docs/slug format.
 *   Bugs in link transformation produce broken navigation (dead links, 404s).
 *   These regressions have happened multiple times — this prevents recurrence.
 *
 * These tests read the ALREADY-GENERATED content in public/content/.
 * They do NOT run the sync script — they validate its output.
 * Run `node scripts/sync-docs.mjs` before these tests if content is stale.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CONTENT_DIR = join(import.meta.dirname, '..', 'public', 'content');
const MANIFEST_PATH = join(CONTENT_DIR, 'manifest.json');

/**
 * Recursively collect all .md files under a directory.
 */
function collectMarkdownFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdownFiles(full, files);
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

/** All markdown files in generated content */
const mdFiles = collectMarkdownFiles(CONTENT_DIR);

/** All generated content concatenated for cross-file checks */
const allContent = mdFiles.map((f) => ({
  path: f.replace(CONTENT_DIR + '/', ''),
  content: readFileSync(f, 'utf-8'),
}));

// ─── Manifest ──────────────────────────────────────────

describe('Manifest', () => {
  it('manifest.json exists and is valid JSON', () => {
    // WHY: Every page load fetches the manifest. If it's missing or malformed,
    // the entire docs site shows nothing — no sidebar, no content, no search.
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    expect(manifest.sidebar).toBeDefined();
    expect(manifest.flat).toBeDefined();
    expect(manifest.search).toBeDefined();
  });

  it('flat list has prev/next chain with no broken links', () => {
    // WHY: Prev/Next navigation relies on this chain.
    // A broken pointer means users hit a dead end.
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    const slugs = new Set(manifest.flat.map((d) => d.slug));

    for (const doc of manifest.flat) {
      if (doc.prev) expect(slugs.has(doc.prev), `prev "${doc.prev}" from "${doc.slug}" not in flat list`).toBe(true);
      if (doc.next) expect(slugs.has(doc.next), `next "${doc.next}" from "${doc.slug}" not in flat list`).toBe(true);
    }
  });
});

// ─── Link Quality ──────────────────────────────────────

describe('Generated link quality', () => {
  it('no /docs/../ path traversal in any generated file', () => {
    // WHY: This was a real bug — ../../TYPE-SYSTEM.md produced /docs/../type-system.
    // Browsers normalize this but the SPA router does not, causing 404.
    for (const { path, content } of allContent) {
      const matches = content.match(/\/docs\/\.\.\//g);
      expect(matches, `${path} contains /docs/../ path traversal`).toBeNull();
    }
  });

  it('no bare /docs/api or /docs/features directory links', () => {
    // WHY: These slugs have no page — they're section roots.
    // Links should point to /docs/api/stdlib or /docs/features/binding instead.
    for (const { path, content } of allContent) {
      const badApi = content.match(/\]\(\/docs\/api\)/g);
      expect(badApi, `${path} has bare /docs/api link`).toBeNull();
      const badFeatures = content.match(/\]\(\/docs\/features\)/g);
      expect(badFeatures, `${path} has bare /docs/features link`).toBeNull();
    }
  });

  it('no link transform inside inline code spans', () => {
    // WHY: Code like `obj["method"](args)` was falsely rewritten to include /docs/ paths.
    // Inline code must be left untouched.
    for (const { path, content } of allContent) {
      // Match single-line inline code spans only (not fenced code blocks)
      const inlineCode = [];
      for (const line of content.split('\n')) {
        // Skip fenced code block delimiters
        if (line.startsWith('```')) continue;
        const spans = line.match(/`[^`]+`/g) || [];
        inlineCode.push(...spans);
      }
      for (const span of inlineCode) {
        // A /docs/ link injected into inline code = sync bug.
        // Legitimate inline code never contains markdown link syntax like ](/docs/...).
        const hasInjectedLink = /\]\(\/docs\//.test(span);
        expect(hasInjectedLink, `${path} has /docs/ link injected into inline code: ${span}`).toBe(false);
      }
    }
  });

  it('all /docs/* links resolve to slugs in the manifest', () => {
    // WHY: A link to /docs/nonexistent is a 404. Every internal link
    // should point to a page that actually exists in the manifest.
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    const validSlugs = new Set(manifest.flat.map((d) => d.slug));

    // Known exceptions: source docs reference files that don't exist in published docs
    const KNOWN_MISSING = new Set([]);

    const linkRegex = /\]\(\/docs\/([^)#]+)/g;
    const broken = [];

    for (const { path, content } of allContent) {
      let m;
      while ((m = linkRegex.exec(content)) !== null) {
        const slug = m[1];
        if (!validSlugs.has(slug) && !KNOWN_MISSING.has(slug)) {
          broken.push({ file: path, slug });
        }
      }
    }

    expect(broken, `Broken /docs/ links:\n${broken.map((b) => `  ${b.file} → /docs/${b.slug}`).join('\n')}`).toEqual([]);
  });
});
