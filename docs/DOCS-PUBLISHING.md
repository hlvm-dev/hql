# How HQL Docs Get Published

## Quick Reference

```
You edit:    ~/dev/hql/docs/*.md              ← this repo, SSOT
Published:   hlvm.dev/docs/*                  ← in-app docs renderer
Built by:    ~/dev/hlvm-web/hlvm-web/react-src/  ← React SPA (single app)
```

## Architecture

Docs are rendered **in-app** within the React SPA (no Docusaurus). The flow:

1. `sync-docs.mjs` copies markdown files from `hql/docs/` into `react-src/public/content/`
2. Generates `manifest.json` (sidebar tree, flat doc list with prev/next, search index)
3. React SPA fetches markdown at runtime, renders with `react-markdown` + syntax highlighting
4. All routes are SPA routes (`/docs/guide`, `/docs/features/binding`, `/docs/api/stdlib`)

## Local Development

```bash
cd ~/dev/hlvm-web/hlvm-web/react-src

# Step 1: Sync docs from hql repo
node scripts/sync-docs.mjs --hql-path ~/dev/hql

# Step 2: Start dev server
npm run dev
# Visit http://localhost:5173/docs/guide
```

## Deploy

```bash
cd ~/dev/hlvm-web/hlvm-web/react-src
node scripts/sync-docs.mjs --hql-path ~/dev/hql   # sync docs
npm run build                                       # build SPA
cd .. && npx firebase deploy                        # deploy
```

## What Happens to Your Docs

```
hql/docs/GUIDE.md          →  hlvm.dev/docs/guide
hql/docs/features/10-macro →  hlvm.dev/docs/features/macro
hql/docs/api/stdlib.md     →  hlvm.dev/docs/api/stdlib
```

The sync script (`react-src/scripts/sync-docs.mjs`) transforms:
- Lowercases filenames for clean URLs
- Strips `.md` from internal links, converts to `/docs/slug` format
- Maps ` ```hql ` to ` ```clojure ` for syntax highlighting
- Strips frontmatter (not needed — manifest.json provides metadata)
- Generates search index with headings and excerpts

## What's NOT Published

Internal docs excluded from the website:
- ARCHITECTURE.md
- SSOT-CONTRACT.md
- DOCS-PUBLISHING.md
- companion-agent-*.md
- memory-system-*.md
- mcp-conformance-matrix.md

## CI/CD

`hql/.github/workflows/docs-trigger.yml` auto-triggers a rebuild on
hlvm-web when you push changes to `docs/**`. The hlvm-web deploy workflow
runs sync + build + Firebase deploy automatically.
