# HQL Documentation Publishing

Canonical guide for how docs are authored, generated, tested, and deployed from this monorepo.

Last updated: 2026-02-27

## Quick Reference

```text
Source of truth:   docs/                       (author here)
Website app:       website/                    (React SPA)
Sync script:       website/scripts/sync-docs.mjs
Generated docs:    website/public/content/     (generated, do not edit)
Build output:      website/dist/               (generated, do not edit)
Hosting:           Firebase project hlvm-78dcc
Live:              https://hlvm.dev/docs/*
```

## 1. Architecture (Single Repo)

```text
hql/
├── docs/                               # SSOT markdown docs
│   ├── GUIDE.md
│   ├── MANUAL.md
│   ├── HQL-SYNTAX.md
│   ├── ...
│   ├── features/NN-name/*.md
│   └── api/*.md
│
├── CONTRIBUTING.md                     # also synced into docs output
│
├── website/
│   ├── scripts/sync-docs.mjs           # markdown -> website content pipeline
│   ├── src/                            # React app
│   ├── tests/                          # unit + e2e
│   ├── public/content/                 # generated docs content
│   ├── dist/                           # generated build output
│   └── package.json
│
├── firebase.json                       # hosting config (public: ./website/dist)
├── .firebaserc                         # firebase project binding
└── .github/workflows/deploy-website.yml
```

Rule:
- Edit `docs/` (and `CONTRIBUTING.md` when needed).
- Never hand-edit generated files in `website/public/content/` or `website/dist/`.

## 2. End-to-End Pipeline

```text
Edit markdown in docs/
  -> run sync-docs.mjs
  -> generates website/public/content/*.md + manifest.json
  -> run website build
  -> outputs website/dist/
  -> firebase deploy
  -> hlvm.dev serves SPA + content
```

Detailed flow:
1. Author/update markdown in `docs/`.
2. Run `node website/scripts/sync-docs.mjs`.
3. Script reads docs, transforms links/content, writes generated content to `website/public/content/`.
4. Script creates `website/public/content/manifest.json` (sidebar, flat order, search index).
5. Build with Vite (`npm run build` in `website/`) -> `website/dist/`.
6. Firebase serves `website/dist/`.

## 3. How Sync Works

`website/scripts/sync-docs.mjs` does all markdown generation.

Input roots:
- `docs/*.md` top-level docs (ordered by `TOP_LEVEL_DOCS` plus extra auto-discovered files)
- `docs/features/NN-name/*.md` feature docs (auto-discovered)
- `docs/api/*.md` API docs
- `CONTRIBUTING.md` (included as `/docs/contributing`)

Core transforms:
1. Strip YAML frontmatter.
2. Protect fenced/inline code regions before link rewrite.
3. Rewrite markdown links into `/docs/...` routes.
4. Map ```hql fences to ```clojure for highlighting.
5. Restore protected code regions.
6. Generate manifest with:
- `sidebar`
- `flat` (with `prev` / `next`)
- `search` index

Excluded files from publishing:
- `ARCHITECTURE.md`
- `SSOT-CONTRACT.md`
- `DOCS-PUBLISHING.md`
- `companion-agent-*`
- `memory-system-*`
- `mcp-conformance-*`

Default docs source path:
- Sibling `../docs` from `website/`.
- Optional override: `--hql-path /path/to/repo-root`.

## 4. Runtime Rendering in Website

At runtime (`/docs/*` route):
1. App loads `/content/manifest.json`.
2. Slug resolves to generated markdown path.
3. App fetches markdown from `/content/...`.
4. `react-markdown` renders content with `remark-gfm`, `rehype-highlight`, `rehype-slug`.
5. Sidebar/search/prev-next/TOC all use manifest data.

## 5. Automated Deploy (CI/CD)

Workflow: `.github/workflows/deploy-website.yml`

Triggers:
- Push to `main` when any of these paths changed:
- `docs/**`
- `website/**`
- `firebase.json`
- `CONTRIBUTING.md`
- Manual run via `workflow_dispatch`

Pipeline steps:
1. Checkout repo.
2. Setup Node 20 + npm cache.
3. `npm ci` in `website/`.
4. `node website/scripts/sync-docs.mjs`.
5. `npm run lint` in `website/`.
6. `npm test` in `website/`.
7. `npm run build` in `website/`.
8. Deploy to Firebase Hosting.

Required GitHub secret:
- `FIREBASE_SERVICE_ACCOUNT`

## 6. Manual Local Workflow

### Local dev preview

```bash
cd website
npm ci
node scripts/sync-docs.mjs
npm run dev
```

Open: `http://localhost:5173/docs/guide`

### Manual quality checks

```bash
cd website
npm run lint
npm test
npm run test:e2e
npm run build
```

### Manual production deploy

```bash
node website/scripts/sync-docs.mjs
cd website && npm run lint && npm test && npm run build
cd ..
npx firebase deploy
```

## 7. Source of Truth Rules

SSOT for docs content:
- Primary: `docs/`
- Included root doc: `CONTRIBUTING.md`

Generated artifacts (not SSOT):
- `website/public/content/**`
- `website/dist/**`

If output differs from source, regenerate; do not edit generated output manually.

## 8. Common Operations

### Add a new top-level doc
1. Create `docs/MY-DOC.md`.
2. Add metadata entry in `TOP_LEVEL_DOCS` inside `website/scripts/sync-docs.mjs`.
3. Re-run sync and verify in UI.

### Add a new feature doc
1. Create directory `docs/features/NN-my-feature/`.
2. Add `README.md` (required).
3. Optional additional pages (`spec.md`, etc.).
4. Re-run sync (auto-discovered; no registry edit needed).

### Add a new API doc
1. Add markdown file under `docs/api/`.
2. Re-run sync.
3. If strict ordering is required, update `apiOrder` in `sync-docs.mjs`.

## 9. Troubleshooting

Docs changed but site unchanged locally:
- Run `node website/scripts/sync-docs.mjs` again.
- Verify files exist under `website/public/content/`.

Auto deploy not triggered:
- Confirm push was to `main`.
- Confirm changed files match trigger paths.

Deploy failed in GitHub Actions:
- Check `FIREBASE_SERVICE_ACCOUNT` exists in repo secrets.

Broken internal docs links:
- Run sync and unit tests:
- `cd website && npm test`
- `tests/sync-output.test.js` catches link regressions.

E2E failures:
- Run locally from `website/`: `npm run test:e2e`.
- Failures save screenshot/trace by Playwright config.

## 10. Open Source + Secrets

This repository should not store private keys/API secrets in committed files.

Expected secret handling:
- Store sensitive credentials only in GitHub Actions secrets.
- Keep `firebase.json` / `.firebaserc` as non-secret config only.

## 11. Canonical File Map

- `docs/` -> documentation source content
- `CONTRIBUTING.md` -> included in docs output
- `website/scripts/sync-docs.mjs` -> docs generation pipeline
- `website/src/` -> docs UI runtime
- `website/tests/sync-output.test.js` -> generated-output regression checks
- `website/tests/e2e/docs.spec.js` -> end-to-end browser checks
- `.github/workflows/deploy-website.yml` -> automated deploy pipeline
- `firebase.json` -> hosting behavior/caching/SPA rewrites

---

If you follow this document exactly, both manual and automated publishing paths produce the same deployed output.
