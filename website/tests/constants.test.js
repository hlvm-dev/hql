/**
 * Unit tests for constants/index.js
 *
 * WHY THESE TESTS EXIST:
 * - If someone accidentally deletes a footer link or nav link,
 *   the site looks broken (empty nav, empty footer).
 * - If URLs break (typo, missing protocol), external links 404.
 * - These are the "source of truth" for all navigation —
 *   catching a mistake here prevents broken UX across the entire site.
 */

import { describe, it, expect } from 'vitest';
import { URLS, NAV_LINKS, DOCS_NAV_TABS, FOOTER_LINKS, BREAKPOINTS } from '../src/constants/index.js';

describe('URLS', () => {
  it('all URLs are valid format (no typos, proper protocol)', () => {
    // A broken URL means a dead link on the site
    for (const [key, url] of Object.entries(URLS)) {
      if (url.startsWith('mailto:')) {
        expect(url).toMatch(/^mailto:.+@.+/);
      } else {
        expect(url, `${key} should be a valid URL`).toMatch(/^https?:\/\/.+/);
      }
    }
  });

  it('contains required social/community links', () => {
    // These are displayed in footer — if missing, footer has dead gaps
    expect(URLS.GITHUB_REPO).toBeDefined();
    expect(URLS.DISCORD).toBeDefined();
    expect(URLS.EMAIL).toBeDefined();
  });
});

describe('NAV_LINKS', () => {
  it('has GitHub and Docs as the two main nav items', () => {
    // Landing page navbar shows exactly these two links
    const labels = NAV_LINKS.map((l) => l.label);
    expect(labels).toContain('GitHub');
    expect(labels).toContain('Docs');
  });

  it('GitHub is external, Docs is internal', () => {
    // GitHub opens new tab, Docs does SPA navigation
    const github = NAV_LINKS.find((l) => l.label === 'GitHub');
    const docs = NAV_LINKS.find((l) => l.label === 'Docs');
    expect(github.external).toBe(true);
    expect(github.href).toMatch(/github\.com/);
    expect(docs.external).toBe(false);
    expect(docs.to).toBe('/docs/guide');
  });
});

describe('DOCS_NAV_TABS', () => {
  it('has exactly 3 tabs: Learn, Features, API', () => {
    // These are the docs section categories — must match sidebar sections
    expect(DOCS_NAV_TABS).toHaveLength(3);
    expect(DOCS_NAV_TABS.map((t) => t.id)).toEqual(['learn', 'features', 'api']);
  });

  it('each tab has a valid internal route', () => {
    // Tabs link to docs pages — must start with /docs/
    for (const tab of DOCS_NAV_TABS) {
      expect(tab.to).toMatch(/^\/docs\//);
    }
  });
});

describe('FOOTER_LINKS', () => {
  it('has at least 5 community/social links', () => {
    // Footer is the site-wide navigation backup — needs all social links
    expect(FOOTER_LINKS.length).toBeGreaterThanOrEqual(5);
  });

  it('external links have href, not to', () => {
    // External links use <a href>, not <Link to>
    const externals = FOOTER_LINKS.filter((l) => l.external);
    for (const link of externals) {
      expect(link.href, `${link.label} should have href`).toBeDefined();
    }
  });
});

describe('BREAKPOINTS', () => {
  it('MOBILE breakpoint is a reasonable value', () => {
    // Used for responsive layout — must be between 320 (tiny) and 1024 (tablet)
    expect(BREAKPOINTS.MOBILE).toBeGreaterThanOrEqual(320);
    expect(BREAKPOINTS.MOBILE).toBeLessThanOrEqual(1024);
  });
});
