/**
 * Unit tests for docs-utils.js
 *
 * WHY THESE TESTS EXIST:
 * - getActiveTab() controls which NavBar tab is highlighted.
 *   If it returns wrong tab, user sees "Learn" highlighted while reading API docs.
 *   That's confusing navigation — a real UX bug.
 *
 * - extractHeadings() generates the Table of Contents.
 *   If it breaks, the right sidebar TOC is empty or wrong, and users
 *   can't navigate long docs pages. That's a core feature.
 */

import { describe, it, expect } from 'vitest';
import { getActiveTab, extractHeadings } from '../src/utils/docs-utils.js';

// ─── getActiveTab ──────────────────────────────────────

describe('getActiveTab', () => {
  it('returns "learn" for the guide page', () => {
    // User visits /docs/guide → Learn tab should be active
    expect(getActiveTab('guide')).toBe('learn');
  });

  it('returns "learn" for empty/null slug (default landing)', () => {
    // /docs with no slug redirects to guide → Learn tab
    expect(getActiveTab('')).toBe('learn');
    expect(getActiveTab(null)).toBe('learn');
    expect(getActiveTab(undefined)).toBe('learn');
  });

  it('returns "features" for feature pages', () => {
    // User navigates to any feature doc → Features tab should highlight
    expect(getActiveTab('features/binding')).toBe('features');
    expect(getActiveTab('features/binding/spec')).toBe('features');
    expect(getActiveTab('features')).toBe('features');
  });

  it('returns "api" for API reference pages', () => {
    // User navigates to API docs → API tab should highlight
    expect(getActiveTab('api/stdlib')).toBe('api');
    expect(getActiveTab('api/builtins')).toBe('api');
    expect(getActiveTab('api')).toBe('api');
  });

  it('returns "learn" for other learn docs', () => {
    // manual, syntax, build, testing — all Learn section docs
    expect(getActiveTab('manual')).toBe('learn');
    expect(getActiveTab('hql-syntax')).toBe('learn');
    expect(getActiveTab('build')).toBe('learn');
    expect(getActiveTab('testing')).toBe('learn');
  });
});

// ─── extractHeadings ───────────────────────────────────

describe('extractHeadings', () => {
  /** Helper: create a fake DOM container with headings */
  function makeContainer(headingSpecs) {
    const div = document.createElement('div');
    for (const { tag, id, text } of headingSpecs) {
      const el = document.createElement(tag);
      el.id = id;
      el.textContent = text;
      div.appendChild(el);
    }
    return div;
  }

  it('extracts h2 and h3 headings with id and text', () => {
    // TOC needs heading id (for anchor links) and text (for display)
    const container = makeContainer([
      { tag: 'h2', id: 'overview', text: 'Overview' },
      { tag: 'h3', id: 'details', text: 'Details' },
    ]);
    const headings = extractHeadings(container);
    expect(headings).toEqual([
      { id: 'overview', text: 'Overview', level: 2 },
      { id: 'details', text: 'Details', level: 3 },
    ]);
  });

  it('ignores h1 (page title) — TOC only shows subsections', () => {
    // h1 is the page title, not a TOC entry
    const container = makeContainer([
      { tag: 'h1', id: 'title', text: 'Page Title' },
      { tag: 'h2', id: 'section', text: 'Section' },
    ]);
    const headings = extractHeadings(container);
    expect(headings).toHaveLength(1);
    expect(headings[0].id).toBe('section');
  });

  it('returns empty array for null container', () => {
    // Before markdown loads, container ref is null — should not crash
    expect(extractHeadings(null)).toEqual([]);
  });

  it('returns empty array for container with no headings', () => {
    // A doc with only paragraphs and code → no TOC entries
    const container = document.createElement('div');
    container.innerHTML = '<p>Just text</p><code>some code</code>';
    expect(extractHeadings(container)).toEqual([]);
  });

  it('preserves heading order as they appear in the document', () => {
    // TOC must match document reading order
    const container = makeContainer([
      { tag: 'h2', id: 'first', text: 'First' },
      { tag: 'h2', id: 'second', text: 'Second' },
      { tag: 'h3', id: 'nested', text: 'Nested' },
      { tag: 'h2', id: 'third', text: 'Third' },
    ]);
    const headings = extractHeadings(container);
    expect(headings.map((h) => h.id)).toEqual(['first', 'second', 'nested', 'third']);
  });
});
