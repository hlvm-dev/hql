# HQL Documentation Pipeline

Complete guide to how HQL docs are authored, transformed, tested, published, and served.

## Quick Reference

```
Source of truth:   docs/*.md                        (this repo)
Website app:       website/                         (React SPA, same repo)
Sync script:       website/scripts/sync-docs.mjs    (markdown pipeline)
Firebase project:  hlvm-78dcc                       (hosting)
Live site:         hlvm.dev/docs/*
```

---

## 1. The Big Picture

Everything lives in one repo:

```
 hql/
 ├── docs/                      (source of truth — markdown files)
 │   ├── GUIDE.md
 │   ├── MANUAL.md
 │   ├── HQL-SYNTAX.md
 │   ├── REFERENCE.md
 │   ├── TYPE-SYSTEM.md
 │   ├── BUILD.md
 │   ├── ...
 │   ├── features/
 │   │   ├── 01-binding/
 │   │   ├── 02-class/
 │   │   └── ...
 │   └── api/
 │       ├── stdlib.md
 │       ├── builtins.md
 │       └── ...
 │
 ├── website/                   (React SPA)
 │   ├── src/                   (React app)
 │   ├── public/
 │   │   └── content/           (generated — gitignored)
 │   ├── scripts/
 │   │   └── sync-docs.mjs      (markdown pipeline)
 │   ├── tests/
 │   │   ├── *.test.js          (unit)
 │   │   └── e2e/               (Playwright)
 │   └── package.json
 │
 ├── firebase.json              (hosting config)
 ├── .firebaserc                (Firebase project binding)
 ├── CONTRIBUTING.md            (synced into docs)
 └── .github/workflows/
     └── deploy-website.yml     (CI/CD)
```

**Rule: You edit docs in `docs/`. You never edit files in `website/public/content/`.**

That directory is generated output — the sync script overwrites it every time.

---

## 2. End-to-End Pipeline

Here's every step from editing a markdown file to it appearing on hlvm.dev:

```
 YOU EDIT A DOC
      │
      v
 ┌─────────────────────────────────────────────────────────────────────┐
 │  docs/features/01-binding/README.md                                 │
 │                                                                     │
 │  # Variable Binding                                                 │
 │  HQL supports `var`, `const`, and `let` for variable binding.       │
 │  See also [Type System](../../TYPE-SYSTEM.md) for type annotations. │
 └─────────────────────────────────────────────────────────────────────┘
      │
      │  node website/scripts/sync-docs.mjs
      v
 ┌─────────────────────────────────────────────────────────────────────┐
 │  SYNC SCRIPT (sync-docs.mjs)                                        │
 │                                                                     │
 │  1. Discover all .md files in docs/                                 │
 │  2. Exclude internal docs (ARCHITECTURE, SSOT-CONTRACT, etc.)       │
 │  3. For each file:                                                  │
 │     a. Read markdown source                                         │
 │     b. Strip YAML frontmatter (if any)                              │
 │     c. Protect code blocks (``` and `) from link rewriting          │
 │     d. Convert relative links to /docs/slug format                  │
 │     e. Map ```hql → ```clojure for syntax highlighting              │
 │     f. Restore protected code blocks                                │
 │     g. Write to public/content/{section}/{file}.md                  │
 │  4. Generate manifest.json (sidebar + flat list + search index)     │
 └─────────────────────────────────────────────────────────────────────┘
      │
      v
 ┌─────────────────────────────────────────────────────────────────────┐
 │  GENERATED OUTPUT (website/public/content/)                         │
 │                                                                     │
 │  public/content/                                                    │
 │  ├── manifest.json         ← sidebar tree, prev/next, search index  │
 │  ├── guide.md              ← from docs/GUIDE.md                     │
 │  ├── manual.md             ← from docs/MANUAL.md                    │
 │  ├── type-system.md        ← from docs/TYPE-SYSTEM.md               │
 │  ├── contributing.md       ← from CONTRIBUTING.md (repo root)       │
 │  ├── features/                                                      │
 │  │   ├── binding/                                                   │
 │  │   │   └── readme.md     ← from docs/features/01-binding/         │
 │  │   ├── functions/                                                 │
 │  │   │   ├── readme.md                                              │
 │  │   │   └── spec.md                                                │
 │  │   └── .../                                                       │
 │  └── api/                                                           │
 │      ├── stdlib.md                                                  │
 │      ├── builtins.md                                                │
 │      └── .../                                                       │
 └─────────────────────────────────────────────────────────────────────┘
      │
      │  npm run build  (Vite bundles the React SPA)
      v
 ┌─────────────────────────────────────────────────────────────────────┐
 │  BUILT SPA (website/dist/)                                          │
 │                                                                     │
 │  dist/                                                              │
 │  ├── index.html            ← SPA entry (all routes)                 │
 │  ├── assets/               ← JS/CSS bundles (hashed, immutable)     │
 │  └── content/              ← markdown files + manifest (copied)     │
 └─────────────────────────────────────────────────────────────────────┘
      │
      │  firebase deploy
      v
 ┌─────────────────────────────────────────────────────────────────────┐
 │  FIREBASE HOSTING  →  hlvm.dev                                      │
 │                                                                     │
 │  All routes → index.html (SPA rewrite rule)                         │
 │  assets/**  → 1 year cache (immutable hashed files)                 │
 │  content/** → max-age=3600, s-maxage=86400 (1hr client, 1day CDN)    │
 │  index.html → no-cache (always fresh)                               │
 └─────────────────────────────────────────────────────────────────────┘
      │
      v
 ┌─────────────────────────────────────────────────────────────────────┐
 │  USER VISITS hlvm.dev/docs/features/binding                         │
 │                                                                     │
 │  1. Browser loads index.html (SPA shell)                            │
 │  2. React Router matches /docs/* → lazy-loads DocsPage              │
 │  3. DocsContext fetches /content/manifest.json (once, cached)       │
 │  4. DocsContent looks up slug "features/binding" in manifest        │
 │  5. useDocsFetch fetches /content/features/binding/readme.md        │
 │  6. MarkdownRenderer renders markdown → HTML with:                  │
 │     - react-markdown (parsing)                                      │
 │     - remark-gfm (tables, strikethrough, task lists)                │
 │     - rehype-highlight (syntax coloring via highlight.js)           │
 │     - rehype-slug (heading IDs for anchor links)                    │
 │  7. DocsSidebar shows Features tab, "Binding" highlighted           │
 │  8. DocsTableOfContents shows headings from the page                │
 │  9. DocsPrevNext shows prev/next links from manifest                │
 └─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Link Transformation (the trickiest part)

The sync script rewrites relative markdown links into absolute SPA routes.
This is context-aware — it knows which directory the source file lives in.

```
SOURCE FILE                        LINK IN MARKDOWN               OUTPUT
─────────────────────────────────  ─────────────────────────────  ─────────────────────
docs/GUIDE.md                      [ref](./REFERENCE.md)          [ref](/docs/reference)
docs/features/01-binding/README.md [types](../../TYPE-SYSTEM.md)  [types](/docs/type-system)
docs/features/10-macro/spec.md     [readme](./README.md)          [readme](/docs/features/macro)
docs/api/stdlib.md                 [builtins](./builtins.md)      [builtins](/docs/api/builtins)
CONTRIBUTING.md (repo root)        [build](./docs/BUILD.md)       [build](/docs/build)
```

**How it works:**

1. Before link rewriting, all code spans (``` blocks and `inline`) are replaced
   with `\x00CODE{n}\x00` placeholders so they can't be falsely rewritten
2. The regex matches `[text](relative-link)` patterns (must have `[text]` prefix)
3. `resolveRelative(sourceBasePath, link)` walks `../` segments to compute the
   absolute path from the docs root
4. `cleanDocPath(resolved)` normalizes: lowercase, strip `.md`, strip number
   prefixes (e.g. `01-binding` → `binding`), strip `/readme`
5. Directory-only slugs get redirected: `api` → `api/stdlib`, `features` → `features/binding`
6. Code placeholders are restored

---

## 4. What Gets Published (and What Doesn't)

### Published: Top-Level Docs (14 predefined + auto-discovered extras)

| Source File | URL Slug | Label |
|---|---|---|
| docs/GUIDE.md | /docs/guide | HQL Learning Guide |
| docs/MANUAL.md | /docs/manual | Language Manual |
| docs/HQL-SYNTAX.md | /docs/hql-syntax | HQL Syntax |
| docs/REFERENCE.md | /docs/reference | Reference |
| docs/TYPE-SYSTEM.md | /docs/type-system | Type System |
| docs/ERROR-SYSTEM.md | /docs/error-system | Error System |
| docs/BUILD.md | /docs/build | Build Guide |
| docs/TESTING.md | /docs/testing | Testing |
| docs/PAREDIT.md | /docs/paredit | Paredit Integration |
| docs/style-guide.md | /docs/style-guide | Style Guide |
| docs/SELF-HOSTED-STDLIB.md | /docs/self-hosted-stdlib | Self-Hosted Stdlib |
| docs/MCP.md | /docs/mcp | MCP Integration |
| docs/HLVM-COMPANION.md | /docs/hlvm-companion | HLVM Companion |
| CONTRIBUTING.md | /docs/contributing | Contributing |

### Published: Feature Docs (auto-discovered)

All `docs/features/NN-name/` directories are scanned. Each gets a main page
(from README.md) and optional sub-pages (e.g., spec.md).

```
docs/features/01-binding/README.md    → /docs/features/binding
docs/features/02-class/README.md      → /docs/features/class
docs/features/03-conditional/README.md→ /docs/features/conditional
...
```

### Published: API Docs (ordered)

```
docs/api/stdlib.md        → /docs/api/stdlib        (first)
docs/api/builtins.md      → /docs/api/builtins      (second)
docs/api/runtime.md       → /docs/api/runtime       (third)
docs/api/module-system.md → /docs/api/module-system  (fourth)
(rest alphabetical)
```

### NOT Published (excluded)

These are internal developer docs — never synced to the website:

- `ARCHITECTURE.md` — Internal architecture notes
- `SSOT-CONTRACT.md` — SSOT enforcement rules
- `DOCS-PUBLISHING.md` — This file (meta)
- `companion-agent-*.md` — Companion agent specs
- `memory-system-*.md` — Memory system internals
- `mcp-conformance-matrix.md` — MCP test matrix

---

## 5. The React App Architecture

```
 ┌─────────────────────────────────────────────────────────────┐
 │  App.jsx                                                     │
 │  ├── Route "/"        → LandingPage                          │
 │  ├── Route "/docs/*"  → DocsPage (lazy-loaded)               │
 │  └── Route "*"        → NotFound (404)                       │
 └─────────────────────────────────────────────────────────────┘
                │
                v
 ┌─────────────────────────────────────────────────────────────┐
 │  DocsPage                                                    │
 │  └── DocsProvider (context)                                  │
 │      │   • Fetches manifest.json on mount                    │
 │      │   • Manages: sidebar open/close, search open/close    │
 │      │   • Provides: findDocBySlug(), manifest data          │
 │      │   • Keyboard: Cmd+K = search, Esc = close             │
 │      │                                                       │
 │      └── DocsLayout (CSS Grid)                               │
 │          ┌──────────────┬───────────────┬──────────────┐     │
 │          │  DocsSidebar  │  DocsContent   │    TOC       │     │
 │          │              │               │              │     │
 │          │ Learn tab    │ MarkdownRender│ Auto-generated│     │
 │          │ Features tab │ + rehype-slug │ from h2/h3   │     │
 │          │ API tab      │ + highlight   │ headings     │     │
 │          │              │ + remark-gfm  │              │     │
 │          │ Collapsible  │               │ Scroll spy   │     │
 │          │ groups for   │ DocsPrevNext  │ via          │     │
 │          │ features     │ (bottom nav)  │ Intersection │     │
 │          │              │               │ Observer     │     │
 │          └──────────────┴───────────────┴──────────────┘     │
 │                                                              │
 │          DocsSearch (Cmd+K overlay)                           │
 │          • Fuse.js fuzzy search over manifest.search          │
 │          • Keyboard nav: arrows, Enter, Escape               │
 └─────────────────────────────────────────────────────────────┘
```

### NavBar Morphing

The NavBar changes based on whether you're on the landing page or docs:

```
Landing:  [HLVM]                                  GitHub  Docs  [Theme]  [Download]
Docs:     [HLVM]  Learn  Features  API            [Search]  [Theme]  Home
```

### Content Fetch Flow

```
URL: /docs/features/binding
         │
         v
    useParams("*") → slug = "features/binding"
         │
         v
    findDocBySlug("features/binding")
         │
         v
    manifest.flat.find(d => d.slug === "features/binding")
    → { slug, label, path: "features/binding/readme.md", prev, next }
         │
         v
    useDocsFetch("features/binding/readme.md")
         │
         v
    fetch("/content/features/binding/readme.md")
    → cached in memory Map (never re-fetched)
         │
         v
    MarkdownRenderer renders the markdown string
```

---

## 6. The manifest.json Structure

Generated by `sync-docs.mjs`. Three sections:

```json
{
  "sidebar": {
    "learn": [
      { "slug": "guide", "label": "HQL Learning Guide", "path": "guide.md", "title": "..." },
      { "slug": "manual", "label": "Language Manual", "path": "manual.md", "title": "..." }
    ],
    "features": [
      {
        "slug": "features/binding", "label": "Binding", "path": "features/binding/readme.md",
        "title": "...",
        "children": [
          { "slug": "features/binding/spec", "label": "spec", "path": "features/binding/spec.md" }
        ]
      }
    ],
    "api": [
      { "slug": "api/stdlib", "label": "Standard Library", "path": "api/stdlib.md", "title": "..." }
    ]
  },

  "flat": [
    { "slug": "guide", "label": "...", "path": "guide.md", "title": "...", "prev": null, "next": "manual" },
    { "slug": "manual", "label": "...", "path": "manual.md", "title": "...", "prev": "guide", "next": "hql-syntax" },
    ...
  ],

  "search": [
    {
      "slug": "guide",
      "title": "HQL Learning Guide",
      "label": "HQL Learning Guide",
      "headings": [
        { "text": "Quick Start", "level": 2, "id": "quick-start" },
        { "text": "Installation", "level": 3, "id": "installation" }
      ],
      "excerpt": "First 200 chars of content..."
    }
  ]
}
```

**sidebar** — drives the left sidebar (3 tabs: Learn, Features, API)
**flat** — linear ordering with prev/next pointers (drives bottom navigation)
**search** — pre-computed index for Fuse.js fuzzy search (Cmd+K)

---

## 7. CI/CD Pipeline

A single GitHub Actions workflow handles deployment:

```
 ┌──────────────────────────────────────────────────────────────────┐
 │  .github/workflows/deploy-website.yml                            │
 │                                                                  │
 │  Triggers:                                                       │
 │  • push to main with changes in docs/**, website/**,              │
 │    firebase.json, CONTRIBUTING.md                                 │
 │  • manual workflow_dispatch                                       │
 │                                                                  │
 │  Steps:                                                          │
 │  ┌────────────────────────────────────────────────────────────┐  │
 │  │ 1. Checkout hql repo                                       │  │
 │  │ 2. Setup Node 20 + npm cache                               │  │
 │  │ 3. npm ci  (install dependencies in website/)              │  │
 │  │ 4. node website/scripts/sync-docs.mjs                      │  │
 │  │ 5. npm test  (unit tests gate deploy)                      │  │
 │  │ 6. npm run build  (Vite bundles SPA → dist/)               │  │
 │  │ 7. firebase deploy (dist/ → hlvm.dev)                      │  │
 │  └────────────────────────────────────────────────────────────┘  │
 │                                                                  │
 │  Secrets: FIREBASE_SERVICE_ACCOUNT                               │
 └──────────────────────────────────────────────────────────────────┘
```

**Result:** Edit a doc in `docs/`, push to main, and hlvm.dev updates automatically.

---

## 8. Testing

Two layers of tests ensure nothing breaks:

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  LAYER 1: Unit Tests (vitest + jsdom)                           │
 │  Run: cd website && npm test                                    │
 │  Speed: ~1 second                                               │
 │                                                                 │
 │  tests/constants.test.js (9 tests)                              │
 │  └── NavBar links, footer links, tab config, URL validity       │
 │                                                                 │
 │  tests/docs-utils.test.js (10 tests)                            │
 │  └── getActiveTab() routing, extractHeadings() from DOM         │
 │                                                                 │
 │  tests/sync-output.test.js (6 tests)                            │
 │  └── Validates the GENERATED content in public/content/:        │
 │      • manifest.json exists and is valid                        │
 │      • prev/next chain has no broken pointers                   │
 │      • No /docs/../ path traversal (real past bug)              │
 │      • No bare /docs/api or /docs/features dead links           │
 │      • No link injection inside inline code (real past bug)     │
 │      • All /docs/* links resolve to valid manifest slugs        │
 └─────────────────────────────────────────────────────────────────┘
                              │
                              v
 ┌─────────────────────────────────────────────────────────────────┐
 │  LAYER 2: E2E Tests (Playwright + real Chromium)                │
 │  Run: cd website && npm run test:e2e                            │
 │  Speed: ~15 seconds                                             │
 │                                                                 │
 │  tests/e2e/docs.spec.js (19 tests)                              │
 │                                                                 │
 │  What it does:                                                  │
 │  ┌────────────────────────────────────────────────────────┐     │
 │  │  Playwright launches a REAL Chromium browser             │     │
 │  │  Vite dev server starts on port 5173                     │     │
 │  │  Tests interact with the actual running app:             │     │
 │  │                                                          │     │
 │  │  • Landing page loads, hero visible                      │     │
 │  │  • "Docs" link does SPA navigation (no reload)           │     │
 │  │  • Markdown renders with headings, code blocks, links    │     │
 │  │  • Nonexistent slug shows 404 page                       │     │
 │  │  • Sidebar tabs switch between Learn/Features/API        │     │
 │  │  • Feature groups expand/collapse                        │     │
 │  │  • Internal links navigate within SPA                    │     │
 │  │  • Prev/Next navigation works                            │     │
 │  │  • TOC generated from headings                           │     │
 │  │  • Cmd+K opens search, finds docs, navigates             │     │
 │  │  • Theme toggle switches light/dark                      │     │
 │  │  • Mobile: hamburger menu, TOC hidden                    │     │
 │  │  • Screenshots + traces saved on failure                 │     │
 │  └────────────────────────────────────────────────────────┘     │
 └─────────────────────────────────────────────────────────────────┘
```

---

## 9. How To: Common Tasks

### Edit an existing doc

```bash
# 1. Edit the source file
vim docs/GUIDE.md

# 2. Re-sync to see changes locally
node website/scripts/sync-docs.mjs

# 3. Start dev server (if not running)
cd website && npm run dev

# 4. Visit http://localhost:5173/docs/guide
```

### Add a new top-level doc

1. Create the file in `docs/`, e.g., `docs/MY-NEW-DOC.md`
2. Edit `website/scripts/sync-docs.mjs`:
   - Add to `TOP_LEVEL_DOCS` array:
     ```js
     { file: "MY-NEW-DOC.md", label: "My New Doc", slug: "my-new-doc" },
     ```
3. Re-sync: `node website/scripts/sync-docs.mjs`
4. The doc appears in the sidebar under the "Learn" tab

### Add a new feature doc

1. Create directory: `docs/features/NN-feature-name/`
2. Add `README.md` (required — this is the main page)
3. Optionally add `spec.md` or other sub-pages
4. Re-sync — feature docs are auto-discovered (no script edit needed)

### Run tests after changes

```bash
cd website

# Quick: unit tests only (~1 second)
npm test

# Full: E2E with real browser (~15 seconds)
npm run test:e2e

# Both
npm test && npm run test:e2e
```

### Deploy manually

```bash
# Sync + Build
node website/scripts/sync-docs.mjs
cd website && npm run build

# Deploy (from repo root)
cd ..
npx firebase deploy
```

### Deploy automatically (just push)

```bash
# Push doc changes
git add docs/
git commit -m "docs: update guide"
git push

# deploy-website.yml fires → hlvm.dev updates (~2 minutes)
```

---

## 10. File Reference

| Path | Purpose |
|---|---|
| `docs/*.md` | Top-level documentation files |
| `docs/features/NN-name/` | Feature documentation (auto-discovered) |
| `docs/api/*.md` | API reference documentation |
| `CONTRIBUTING.md` | Contribution guide (synced from repo root) |
| `website/scripts/sync-docs.mjs` | Markdown transformation pipeline |
| `website/public/content/` | Generated markdown + manifest (gitignored) |
| `website/src/App.jsx` | Routes: `/`, `/docs/*`, `*` (404) |
| `website/src/pages/DocsPage.jsx` | Docs shell with DocsProvider |
| `website/src/contexts/DocsContext.jsx` | Manifest loader, UI state, keyboard shortcuts |
| `website/src/hooks/useDocsFetch.js` | Fetch + cache markdown by path |
| `website/src/components/docs/DocsContent.jsx` | Slug → manifest lookup → fetch → render |
| `website/src/components/docs/MarkdownRenderer.jsx` | react-markdown + plugins + SPA link handling |
| `website/src/components/docs/DocsSidebar.jsx` | 3-tab sidebar with collapsible groups |
| `website/src/components/docs/DocsTableOfContents.jsx` | Auto-generated from h2/h3, scroll spy |
| `website/src/components/docs/DocsPrevNext.jsx` | Bottom prev/next navigation |
| `website/src/components/docs/DocsSearch.jsx` | Cmd+K fuzzy search (Fuse.js) |
| `website/src/components/NavBar.jsx` | Contextual morphing (landing vs docs) |
| `website/src/utils/docs-utils.js` | getActiveTab(), extractHeadings() |
| `website/tests/constants.test.js` | Unit: nav/footer config validation |
| `website/tests/docs-utils.test.js` | Unit: tab routing + heading extraction |
| `website/tests/sync-output.test.js` | Unit: generated content quality regression |
| `website/tests/e2e/docs.spec.js` | E2E: full browser interaction tests |
| `website/playwright.config.js` | Playwright E2E configuration |
| `website/vite.config.js` | Vite build + vitest config |
| `firebase.json` | Hosting config (SPA rewrite, cache headers) |
| `.github/workflows/deploy-website.yml` | CI/CD: sync → build → firebase deploy |

---

## 11. Dependencies

### Runtime (shipped to browser)

| Package | Purpose |
|---|---|
| `react` + `react-dom` | UI framework |
| `react-router-dom` | Client-side routing |
| `react-markdown` | Markdown → React rendering |
| `remark-gfm` | GitHub Flavored Markdown (tables, strikethrough) |
| `rehype-highlight` | Syntax highlighting (highlight.js) |
| `rehype-slug` | Auto heading IDs for TOC/anchors |
| `fuse.js` | Client-side fuzzy search |

### Development

| Package | Purpose |
|---|---|
| `vite` | Build tool + dev server |
| `vitest` | Unit test runner |
| `@playwright/test` | E2E browser testing |
| `jsdom` | DOM simulation for unit tests |

---

## 12. Troubleshooting

**Docs not updating locally?**
Re-run sync: `node website/scripts/sync-docs.mjs`

**Broken links after editing?**
Run `cd website && npm test` — the sync-output tests catch broken `/docs/*` links.

**New doc not appearing in sidebar?**
For top-level docs: add to `TOP_LEVEL_DOCS` array in sync-docs.mjs.
For feature docs: ensure directory matches `docs/features/NN-name/` with a `README.md`.

**E2E tests failing?**
Ensure dev server isn't running on :5173 already, or Playwright will reuse it.
Run `npm run test:e2e` from `website/` directory.

**Auto-deploy not triggering?**
Check that `FIREBASE_SERVICE_ACCOUNT` secret is set in the hql repo GitHub settings.

**Code blocks getting mangled?**
The sync script protects code with `\x00CODE{n}\x00` placeholders. If you see
raw placeholders in output, the restore step may have a regex mismatch — check
`transformContent()` in sync-docs.mjs.
