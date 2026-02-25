# How HQL Docs Get Published

## Quick Reference

```
You edit:    ~/dev/hql/docs/*.md        ← this repo, SSOT
Published:   hlvm.dev/docs/*            ← Docusaurus website
Built by:    ~/dev/hlvm-web/hlvm-web/docs-site/   ← separate repo
```

Full architecture and instructions: see `hlvm-web/docs-site/README.md`

## The 4-Step Deploy

Build order matters: SPA first (Vite wipes dist/), then docs.

```bash
cd ~/dev/hlvm-web/hlvm-web/react-src
npm run build                    # Step 1: build SPA → dist/

cd ../docs-site
npm run sync                     # Step 2: copies hql/docs → content/
npm run build                    # Step 3: Docusaurus → ../react-src/dist/docs/

cd .. && npx firebase deploy     # Step 4: uploads to hlvm.dev
```

## What Happens to Your Docs

```
hql/docs/GUIDE.md          →  hlvm.dev/docs/guide
hql/docs/features/10-macro →  hlvm.dev/docs/features/macro/
hql/docs/api/stdlib.md     →  hlvm.dev/docs/api/stdlib
```

The sync script (`hlvm-web/docs-site/scripts/sync-docs.mjs`) transforms:
- Lowercases filenames for clean URLs
- Strips `.md` from internal links
- Maps ` ```hql ` to ` ```clojure ` for syntax highlighting
- Injects Docusaurus sidebar metadata

## What's NOT Published

Internal docs excluded from the website:
- ARCHITECTURE.md
- SSOT-CONTRACT.md
- companion-agent-*.md
- memory-system-*.md
- mcp-conformance-matrix.md

## CI/CD (Future)

`hql/.github/workflows/docs-trigger.yml` will auto-trigger a rebuild on
hlvm-web when you push changes to `docs/**`. Needs GitHub secrets to activate.
See `hlvm-web/docs-site/README.md` for details.
