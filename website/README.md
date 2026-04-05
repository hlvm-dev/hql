# HLVM Website

Next.js static-export site for [hlvm.dev](https://hlvm.dev). Serves documentation, landing page, and download links.

## Development

```bash
# Install dependencies
npm ci

# Sync docs from ../docs/ into public/content/
node scripts/sync-docs.mjs

# Start dev server
npm run dev         # http://localhost:3000

# Run tests
npm test            # unit tests (vitest)
npm run test:e2e    # E2E tests (Playwright)
```

## Deployment

Automatic via GitHub Actions on push to `main` when `docs/**`, `website/**`, or `firebase.json` change.

Manual: `node scripts/sync-docs.mjs && npm run build && npm run sync:installers && cd .. && npx firebase deploy`

Firebase now serves Next static export output from `website/out`, including the stable installer URLs:

- `https://hlvm.dev/install.sh`
- `https://hlvm.dev/install.ps1`

See `docs/DOCS-PUBLISHING.md` for the full pipeline documentation.
