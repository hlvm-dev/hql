/**
 * E2E Tests — Documentation Site
 *
 * These tests launch a real browser, load the real app, and interact with it
 * exactly like a user would. Each test has a comment explaining WHY it exists —
 * what real user scenario or business requirement it protects.
 *
 * HOW TO RUN:
 *   npx playwright test
 *
 * HOW IT WORKS:
 *   1. Playwright starts a real Chromium browser (invisible)
 *   2. It starts your Vite dev server automatically (see playwright.config.js)
 *   3. Each test navigates to a page, interacts, and checks results
 *   4. If anything fails, you get a screenshot + error message
 */

import { test, expect } from '@playwright/test';


// ═══════════════════════════════════════════════════════
// LANDING PAGE
// ═══════════════════════════════════════════════════════

test.describe('Landing Page', () => {
  test('loads with hero, navigation, and footer', async ({ page }) => {
    // WHY: This is the first thing every visitor sees.
    // If landing page is broken, 100% of visitors bounce.
    await page.goto('/');

    // Hero content visible
    await expect(page.getByRole('heading', { name: 'AI Spotlight' })).toBeVisible();

    // NavBar has essential links
    await expect(page.getByRole('link', { name: 'GitHub' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Docs' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();

    // Footer with copyright and community links
    await expect(page.getByText(/© \d{4} HLVM/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Discord' })).toBeVisible();
  });

  test('Docs link navigates to docs without full page reload', async ({ page }) => {
    // WHY: SPA navigation means no full-page reload between routes.
    // If clicking Docs triggers a reload, the SPA routing is broken.
    await page.goto('/');

    // Plant a marker in window — a full reload would destroy it
    await page.evaluate(() => { window.__spaMarker = true; });

    await Promise.all([
      page.waitForURL('/docs/guide'),
      page.getByRole('link', { name: 'Docs' }).click(),
    ]);

    // Content loaded
    await expect(page.getByRole('heading', { name: 'HQL Learning Guide' })).toBeVisible();

    // Marker survives → no full page reload happened
    const markerSurvived = await page.evaluate(() => window.__spaMarker === true);
    expect(markerSurvived).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// DOCS RENDERING
// ═══════════════════════════════════════════════════════

test.describe('Docs Content Rendering', () => {
  test('renders markdown with headings, code blocks, and links', async ({ page }) => {
    // WHY: The core purpose of the docs site is rendering markdown correctly.
    // If markdown doesn't render, docs are useless.
    await page.goto('/docs/guide');

    // H1 title from markdown
    await expect(page.getByRole('heading', { name: 'HQL Learning Guide' })).toBeVisible();

    // At least one code block rendered (pre > code)
    const codeBlocks = page.locator('pre code');
    await expect(codeBlocks.first()).toBeVisible();

    // Internal links exist and are clickable (use .first() — content may have multiple "Build Guide" refs)
    await expect(page.getByRole('link', { name: 'Build Guide' }).first()).toBeVisible();
  });

  test('shows 404 for nonexistent doc slug', async ({ page }) => {
    // WHY: Users bookmark docs, then pages get renamed/deleted.
    // They need a helpful error, not a blank screen or crash.
    await page.goto('/docs/this-page-does-not-exist');
    await expect(page.getByRole('heading', { name: 'Page Not Found' })).toBeVisible();
    await expect(page.getByText('this-page-does-not-exist')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Guide' })).toBeVisible();
  });

  test('footer is visible on docs pages (not just landing)', async ({ page }) => {
    // WHY: Footer was previously hidden on docs due to CSS min-height bug.
    // This regression test ensures it stays visible.
    await page.goto('/docs/guide');
    const footer = page.locator('footer');
    // Scroll to bottom to make footer visible
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeVisible();
    await expect(footer.getByText(/© \d{4} HLVM/)).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// NAVIGATION — SIDEBAR & TABS
// ═══════════════════════════════════════════════════════

test.describe('Docs Navigation', () => {
  test('sidebar shows Learn docs and navigates between them', async ({ page }) => {
    // WHY: Sidebar is the primary way users browse docs.
    // If sidebar links don't work, users can't find documentation.
    await page.goto('/docs/guide');

    // Sidebar has multiple doc links
    const sidebar = page.locator('.docs-sidebar');
    await expect(sidebar.getByRole('link', { name: 'Guide', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Manual', exact: true })).toBeVisible();

    // Click Manual → content changes
    await sidebar.getByRole('link', { name: 'Manual', exact: true }).click();
    await expect(page).toHaveURL('/docs/manual');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('Features tab shows collapsible feature groups', async ({ page }) => {
    // WHY: Features section has 23 topics organized in groups.
    // Users need to expand groups to find specific features.
    await page.goto('/docs/features/binding');

    // Should see feature groups as buttons (collapsible)
    const sidebar = page.locator('.docs-sidebar');
    await expect(sidebar.getByRole('button', { name: 'Binding' })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Function' })).toBeVisible();

    // Binding group should be expanded (we're on binding page)
    await expect(sidebar.getByRole('link', { name: 'Binding', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Binding Specification' })).toBeVisible();
  });

  test('NavBar tabs switch between Learn/Features/API sections', async ({ page }) => {
    // WHY: The 3 tabs (Learn, Features, API) are the top-level navigation.
    // Wrong tab highlighted = user doesn't know where they are.
    await page.goto('/docs/guide');
    const navbar = page.locator('.navbar');
    const learnTab = navbar.getByRole('link', { name: 'Learn' });
    const apiTab = navbar.getByRole('link', { name: 'API' });

    // Learn tab is active on guide page
    await expect(learnTab).toHaveClass(/nav-link--active/);

    // Click API tab → navigates to API section
    await apiTab.click();
    await expect(page).toHaveURL('/docs/api/stdlib');
    await expect(apiTab).toHaveClass(/nav-link--active/);
  });

  test('internal doc links navigate within SPA (no reload)', async ({ page }) => {
    // WHY: Links inside markdown content must use SPA navigation.
    // Full page reload = slow, loses scroll position, bad UX.
    await page.goto('/docs/guide');

    // Plant a marker — if page reloads, this is destroyed
    await page.evaluate(() => { window.__spaMarker = true; });

    // Click an internal link in the content (use .first() — content may have multiple refs)
    const buildLink = page.getByRole('link', { name: 'Build Guide' }).first();
    await buildLink.click();
    await expect(page).toHaveURL('/docs/build');
    await expect(page.getByRole('heading', { name: 'Building HLVM from Source' })).toBeVisible();

    // Marker survives → SPA navigation, not hard reload
    const markerSurvived = await page.evaluate(() => window.__spaMarker === true);
    expect(markerSurvived).toBe(true);
  });

  test('prev/next navigation chains through docs', async ({ page }) => {
    // WHY: Prev/Next is how users read docs linearly, like a book.
    // If the chain breaks, users get stuck or skip content.
    await page.goto('/docs/guide');

    // Guide should have "Next" but no "Previous" (it's the first doc)
    const prevNext = page.locator('.docs-prev-next');
    await expect(prevNext.getByRole('link', { name: 'Next' })).toBeVisible();

    // Click Next → goes to manual
    await prevNext.getByRole('link', { name: 'Next' }).click();
    await expect(page).toHaveURL('/docs/manual');

    // Manual should have both Previous and Next
    const prevNext2 = page.locator('.docs-prev-next');
    await expect(prevNext2.getByRole('link', { name: 'Previous' })).toBeVisible();
    await expect(prevNext2.getByRole('link', { name: 'Next' })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// TABLE OF CONTENTS
// ═══════════════════════════════════════════════════════

test.describe('Table of Contents', () => {
  test('generates TOC from page headings', async ({ page }) => {
    // WHY: TOC helps users navigate long docs (stdlib has 50+ sections).
    // Without TOC, users must scroll endlessly to find what they need.
    await page.goto('/docs/guide');

    // Wait for TOC to populate (needs DOM render + heading extraction)
    const toc = page.locator('.docs-toc');
    await expect(toc.getByText('On this page')).toBeVisible();

    // Should have links matching the guide's sections
    await expect(toc.getByRole('link', { name: /Quick Start/ })).toBeVisible();
    await expect(toc.getByRole('link', { name: /Level 1/ })).toBeVisible();
  });

  test('TOC links scroll to correct section', async ({ page }) => {
    // WHY: TOC links must actually work — clicking "Prerequisites"
    // should scroll to that section, not do nothing.
    await page.goto('/docs/guide');

    const toc = page.locator('.docs-toc');
    await toc.getByRole('link', { name: 'Prerequisites' }).click();

    // URL should have hash
    await expect(page).toHaveURL(/.*#prerequisites/);
  });
});

// ═══════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════

test.describe('Search', () => {
  // Helper: open search reliably in headless Chromium.
  // Ctrl+K / Cmd+K can be intercepted by the browser before reaching the page,
  // so we dispatch the custom event the app already listens for.
  async function openSearch(page) {
    // Click the search trigger button instead of dispatching a raw event.
    // Raw Event dispatch races with React's useEffect listener attachment.
    const searchBtn = page.locator('.docs-search-trigger');
    await searchBtn.click();
  }

  test('search opens, typing finds relevant docs', async ({ page }) => {
    // WHY: Search is how experienced users find specific docs fast.
    // Without search, users must browse sidebar manually — slow for 64 docs.
    await page.goto('/docs/guide');
    await page.waitForSelector('.docs-sidebar'); // ensure DocsProvider mounted

    await openSearch(page);
    const searchInput = page.getByPlaceholder('Search documentation...');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();

    // Type a query → results should appear
    await searchInput.fill('binding');
    const results = page.locator('.docs-search-results button');
    await expect(results.first()).toBeVisible();

    // First result should be relevant to "binding"
    const firstResultText = await results.first().textContent();
    expect(firstResultText.toLowerCase()).toContain('binding');
  });

  test('clicking search result navigates to that doc', async ({ page }) => {
    // WHY: Search is useless if results don't navigate anywhere.
    await page.goto('/docs/guide');
    await page.waitForSelector('.docs-sidebar');

    await openSearch(page);
    await page.getByPlaceholder('Search documentation...').fill('stdlib');

    const results = page.locator('.docs-search-results button');
    await expect(results.first()).toBeVisible();
    await results.first().click();

    // Search should close and we should be on a new page
    await expect(page.getByPlaceholder('Search documentation...')).not.toBeVisible();
    await expect(page).not.toHaveURL('/docs/guide');
  });

  test('Escape closes search', async ({ page }) => {
    // WHY: Users expect Escape to dismiss overlays. Standard UX pattern.
    await page.goto('/docs/guide');
    await page.waitForSelector('.docs-sidebar');

    await openSearch(page);
    await expect(page.getByPlaceholder('Search documentation...')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder('Search documentation...')).not.toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════

test.describe('Theme Toggle', () => {
  test('toggles between light and dark mode', async ({ page }) => {
    // WHY: Many developers prefer dark mode. If toggle breaks,
    // they're stuck with a theme that strains their eyes.
    await page.goto('/docs/guide');

    const html = page.locator('html');
    const themeBefore = await html.getAttribute('data-theme');

    // Click theme toggle
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    const themeAfter = await html.getAttribute('data-theme');

    // Theme should have changed
    expect(themeAfter).not.toBe(themeBefore);

    // Toggle back
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    const themeRestored = await html.getAttribute('data-theme');
    expect(themeRestored).toBe(themeBefore);
  });
});

// ═══════════════════════════════════════════════════════
// 404 PAGE
// ═══════════════════════════════════════════════════════

test.describe('404 Page', () => {
  test('unknown routes show 404 with way back home', async ({ page }) => {
    // WHY: Users type wrong URLs, follow broken external links,
    // or bookmark pages that get moved. They need a way back.
    await page.goto('/this-does-not-exist');
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to Home' })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// MOBILE RESPONSIVE
// ═══════════════════════════════════════════════════════

test.describe('Mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('docs page is usable on mobile', async ({ page }) => {
    // WHY: ~50% of web traffic is mobile. If docs don't work on phone,
    // half the audience can't read them.
    await page.goto('/docs/guide');

    // Content should be visible (not hidden behind sidebar)
    await expect(page.getByRole('heading', { name: 'HQL Learning Guide' })).toBeVisible();

    // TOC should be hidden on mobile (too narrow)
    await expect(page.locator('.docs-toc')).not.toBeVisible();

    // Hamburger menu should exist (exact: true to avoid matching "Close menu")
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  });

  test('mobile menu opens and has navigation links', async ({ page }) => {
    // WHY: On mobile, the full navbar is hidden behind a hamburger menu.
    // If that menu doesn't work, mobile users can't navigate at all.
    await page.goto('/');

    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const overlay = page.locator('.mobile-menu-overlay.open');
    await expect(overlay).toBeVisible();

    // Should have key navigation links
    await expect(overlay.getByRole('link', { name: 'GitHub' })).toBeVisible();
    await expect(overlay.getByRole('link', { name: 'Docs' })).toBeVisible();
    await expect(overlay.getByRole('button', { name: 'Download' })).toBeVisible();
  });
});
