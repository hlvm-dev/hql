# HQL Documentation Pipeline

Complete guide to how HQL docs are authored, transformed, tested, published, and served.

## Quick Reference

```
Source of truth:   ~/dev/hql/docs/*.md                     (this repo)
Website:           hlvm.dev/docs/*                         (live site)
Web app:           ~/dev/hlvm-web/hlvm-web/react-src/      (React SPA)
Sync script:       react-src/scripts/sync-docs.mjs         (markdown pipeline)
Firebase project:  hlvm-78dcc                              (hosting)
```

---

## 1. The Big Picture

Two separate Git repos collaborate to produce the docs website:

```
 ┌─────────────────────────────┐       ┌──────────────────────────────────┐
 │  REPO: hql                  │       │  REPO: hlvm-web                  │
 │  ~/dev/hql                  │       │  ~/dev/hlvm-web/hlvm-web         │
 │                             │       │                                  │
 │  docs/                      │       │  react-src/                      │
 │  ├── GUIDE.md               │       │  ├── src/          (React app)   │
 │  ├── MANUAL.md              │       │  ├── public/                     │
 │  ├── HQL-SYNTAX.md          │       │  │   └── content/  (generated)   │
 │  ├── REFERENCE.md           │       │  ├── scripts/                    │
 │  ├── TYPE-SYSTEM.md         │       │  │   └── sync-docs.mjs           │
 │  ├── BUILD.md               │       │  ├── tests/                      │
 │  ├── ...                    │       │  │   ├── *.test.js  (unit)       │
 │  ├── features/              │       │  │   └── e2e/       (Playwright) │
 │  │   ├── 01-binding/        │       │  └── package.json                │
 │  │   ├── 02-functions/      │       │                                  │
 │  │   └── ...                │       │  firebase.json                   │
 │  └── api/                   │       │  .github/workflows/deploy.yml    │
 │      ├── stdlib.md          │       │                                  │
 │      ├── builtins.md        │       └──────────────────────────────────┘
 │      └── ...                │
 │                             │
 │  .github/workflows/         │
 │  └── docs-trigger.yml       │
 └─────────────────────────────┘
```

**Rule: You edit docs in `hql/docs/`. You never edit files in `react-src/public/content/`.**

That directory is generated output — the sync script overwrites it every time.

---

## 2. End-to-End Pipeline

Here's every step from editing a markdown file to it appearing on hlvm.dev:

```
 YOU EDIT A DOC
      │
      v
 ┌─────────────────────────────────────────────────────────────────────┐
 │  ~/dev/hql/docs/features/01-binding/README.md                      │
 │                                                                     │
 │  # Variable Binding                                                 │
 │  HQL supports `var`, `const`, and `let` for variable binding.       │
 │  See also [Type System](../../TYPE-SYSTEM.md) for type annotations. │
 └─────────────────────────────────────────────────────────────────────┘
      │
      │  node scripts/sync-docs.mjs --hql-path ~/dev/hql
      v
 ┌─────────────────────────────────────────────────────────────────────┐
 │  SYNC SCRIPT (sync-docs.mjs)                                        │
 │                                                                     │
 │  1. Discover all .md files in hql/docs/                             │
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
 │  GENERATED OUTPUT (react-src/public/content/)                       │
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
 │  BUILT SPA (react-src/dist/)                                        │
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

### Published: 14 Top-Level Docs

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
docs/features/02-functions/README.md  → /docs/features/functions
docs/features/02-functions/spec.md    → /docs/features/functions/spec
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

Two GitHub Actions workflows work together for automatic deployment:

```
 ┌──────────────────────────────────────────────────────────────────┐
 │  hql repo: .github/workflows/docs-trigger.yml                    │
 │                                                                  │
 │  Trigger: push to main branch with changes in docs/**            │
 │  Action:  POST repository_dispatch "docs-updated"                │
 │           → hlvm-dev/hlvm-web                                    │
 │           (uses HLVM_WEB_DISPATCH_TOKEN secret)                  │
 └──────────────────────────────────────────────────────────────────┘
            │
            │  repository_dispatch event
            v
 ┌──────────────────────────────────────────────────────────────────┐
 │  hlvm-web repo: .github/workflows/deploy.yml                     │
 │                                                                  │
 │  Triggers: push to master | repository_dispatch | manual          │
 │                                                                  │
 │  Steps:                                                          │
 │  ┌────────────────────────────────────────────────────────────┐  │
 │  │ 1. Checkout hlvm-web repo                                  │  │
 │  │ 2. Sparse checkout hql/docs/ into ./hql-docs-source/       │  │
 │  │ 3. Setup Node 20 + npm cache                               │  │
 │  │ 4. npm ci  (install dependencies)                          │  │
 │  │ 5. node scripts/sync-docs.mjs --hql-path ./hql-docs-source │  │
 │  │ 6. npm run build  (Vite bundles SPA → dist/)               │  │
 │  │ 7. firebase deploy (dist/ → hlvm.dev)                      │  │
 │  └────────────────────────────────────────────────────────────┘  │
 │                                                                  │
 │  Secrets: FIREBASE_SERVICE_ACCOUNT, (inherited dispatch token)   │
 └──────────────────────────────────────────────────────────────────┘
```

**Result:** Edit a doc in `hql/docs/`, push to main, and hlvm.dev updates automatically.

---

## 8. Testing

Three layers of tests ensure nothing breaks:

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  LAYER 1: Unit Tests (vitest + jsdom)                           │
 │  Run: npm test                                                  │
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
 │  Run: npm run test:e2e                                          │
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

### How Playwright Works

```
 ┌──────────────┐         ┌──────────────────┐         ┌─────────────┐
 │  Test Script  │ ──────> │  Playwright API   │ ──────> │  Chromium    │
 │  (Node.js)   │ <────── │  (WebSocket CDP)  │ <────── │  (headless)  │
 └──────────────┘         └──────────────────┘         └─────────────┘
                                   │
                            ┌──────┴──────┐
                            │  Vite Dev    │
                            │  Server      │
                            │  :5173       │
                            └─────────────┘

 1. playwright.config.js tells Playwright to start `npm run dev` on :5173
 2. Playwright launches headless Chromium
 3. Test code calls page.goto(), page.click(), page.getByRole(), etc.
 4. Playwright sends Chrome DevTools Protocol commands to the browser
 5. Browser executes, returns DOM state
 6. Test asserts with expect()
 7. On failure: screenshot + trace saved to test-results/
```

---

## 9. How To: Common Tasks

### Edit an existing doc

```bash
# 1. Edit the source file
vim ~/dev/hql/docs/GUIDE.md

# 2. Re-sync to see changes locally
cd ~/dev/hlvm-web/hlvm-web/react-src
node scripts/sync-docs.mjs --hql-path ~/dev/hql

# 3. Start dev server (if not running)
npm run dev

# 4. Visit http://localhost:5173/docs/guide
```

### Add a new top-level doc

1. Create the file in `hql/docs/`, e.g., `docs/MY-NEW-DOC.md`
2. Edit `react-src/scripts/sync-docs.mjs`:
   - Add to `TOP_LEVEL_DOCS` array:
     ```js
     { file: "MY-NEW-DOC.md", label: "My New Doc", slug: "my-new-doc" },
     ```
3. Re-sync: `node scripts/sync-docs.mjs --hql-path ~/dev/hql`
4. The doc appears in the sidebar under the "Learn" tab

### Add a new feature doc

1. Create directory: `hql/docs/features/NN-feature-name/`
2. Add `README.md` (required — this is the main page)
3. Optionally add `spec.md` or other sub-pages
4. Re-sync — feature docs are auto-discovered (no script edit needed)

### Run tests after changes

```bash
cd ~/dev/hlvm-web/hlvm-web/react-src

# Quick: unit tests only (~1 second)
npm test

# Full: E2E with real browser (~15 seconds)
npm run test:e2e

# Both
npm test && npm run test:e2e
```

### Deploy manually

```bash
cd ~/dev/hlvm-web/hlvm-web/react-src

# Sync + Build
node scripts/sync-docs.mjs --hql-path ~/dev/hql
npm run build

# Deploy
cd ..
npx firebase deploy
```

### Deploy automatically (just push)

```bash
# Push doc changes to hql repo
cd ~/dev/hql
git add docs/
git commit -m "docs: update guide"
git push

# docs-trigger.yml fires → deploy.yml runs → hlvm.dev updates
# (takes ~2 minutes)
```

---

## 10. File Reference

### hql repo (source of truth)

| Path | Purpose |
|---|---|
| `docs/*.md` | Top-level documentation files |
| `docs/features/NN-name/` | Feature documentation (auto-discovered) |
| `docs/api/*.md` | API reference documentation |
| `CONTRIBUTING.md` | Contribution guide (synced from repo root) |
| `.github/workflows/docs-trigger.yml` | Fires webhook to hlvm-web on docs/** changes |

### hlvm-web repo (website)

| Path | Purpose |
|---|---|
| `react-src/scripts/sync-docs.mjs` | Markdown transformation pipeline |
| `react-src/public/content/` | Generated markdown + manifest (gitignored) |
| `react-src/src/App.jsx` | Routes: `/`, `/docs/*`, `*` (404) |
| `react-src/src/pages/DocsPage.jsx` | Docs shell with DocsProvider |
| `react-src/src/contexts/DocsContext.jsx` | Manifest loader, UI state, keyboard shortcuts |
| `react-src/src/hooks/useDocsFetch.js` | Fetch + cache markdown by path |
| `react-src/src/components/docs/DocsContent.jsx` | Slug → manifest lookup → fetch → render |
| `react-src/src/components/docs/MarkdownRenderer.jsx` | react-markdown + plugins + SPA link handling |
| `react-src/src/components/docs/DocsSidebar.jsx` | 3-tab sidebar with collapsible groups |
| `react-src/src/components/docs/DocsTableOfContents.jsx` | Auto-generated from h2/h3, scroll spy |
| `react-src/src/components/docs/DocsPrevNext.jsx` | Bottom prev/next navigation |
| `react-src/src/components/docs/DocsSearch.jsx` | Cmd+K fuzzy search (Fuse.js) |
| `react-src/src/components/NavBar.jsx` | Contextual morphing (landing vs docs) |
| `react-src/src/utils/docs-utils.js` | getActiveTab(), extractHeadings() |
| `react-src/tests/constants.test.js` | Unit: nav/footer config validation |
| `react-src/tests/docs-utils.test.js` | Unit: tab routing + heading extraction |
| `react-src/tests/sync-output.test.js` | Unit: generated content quality regression |
| `react-src/tests/e2e/docs.spec.js` | E2E: full browser interaction tests |
| `react-src/playwright.config.js` | Playwright E2E configuration |
| `react-src/vite.config.js` | Vite build + vitest config |
| `firebase.json` | Hosting config (SPA rewrite, cache headers) |
| `.github/workflows/deploy.yml` | CI/CD: sync → build → firebase deploy |

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
Re-run sync: `node scripts/sync-docs.mjs --hql-path ~/dev/hql`

**Broken links after editing?**
Run `npm test` — the sync-output tests catch broken `/docs/*` links.

**New doc not appearing in sidebar?**
For top-level docs: add to `TOP_LEVEL_DOCS` array in sync-docs.mjs.
For feature docs: ensure directory matches `docs/features/NN-name/` with a `README.md`.

**E2E tests failing?**
Ensure dev server isn't running on :5173 already, or Playwright will reuse it.
Run `npm run test:e2e` from `react-src/` directory.

**Auto-deploy not triggering?**
Check that `HLVM_WEB_DISPATCH_TOKEN` secret is set in the hql repo.
Check that `FIREBASE_SERVICE_ACCOUNT` secret is set in the hlvm-web repo.

**Code blocks getting mangled?**
The sync script protects code with `\x00CODE{n}\x00` placeholders. If you see
raw placeholders in output, the restore step may have a regex mismatch — check
`transformContent()` in sync-docs.mjs.
