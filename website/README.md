# HLVM Website

React SPA for [hlvm.dev](https://hlvm.dev). Serves documentation, landing page, and download links.

## Development

```bash
# Install dependencies
npm ci

# Sync docs from ../docs/ into public/content/
node scripts/sync-docs.mjs

# Start dev server
npm run dev         # http://localhost:5173

# Run tests
npm test            # unit tests (vitest)
npm run test:e2e    # 19 E2E tests (Playwright)
```

## Deployment

Automatic via GitHub Actions on push to `main` when `docs/**`, `website/**`, or `firebase.json` change.

Manual: `node scripts/sync-docs.mjs && npm run build && cd .. && npx firebase deploy`

See `docs/DOCS-PUBLISHING.md` for the full pipeline documentation.
