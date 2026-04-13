# HLVM Upgrade & Update Notification

## How It Works

HLVM checks for new versions by querying the GitHub Releases API at startup. If a newer version exists, a notification banner is displayed in the TUI.

```
╭──────────────────────────────────────────────╮
│ ✨ Update available! 0.1.0 → 0.2.0          │
│ Run `curl -fsSL hlvm.dev/install.sh | sh`   │
│ to update.                                   │
│                                              │
│ See full release notes:                      │
│ https://github.com/hlvm-dev/hql/releases/…   │
╰──────────────────────────────────────────────╯
```

### Startup Check

- Runs in the background during TUI initialization (non-blocking)
- Never delays startup — if the check is slow or fails, nothing is shown
- Results cached for 24 hours at `~/.hlvm/update-check.json`
- Cache invalidated automatically when the local version changes (i.e., after upgrading)

### API Endpoint

```
GET https://api.github.com/repos/hlvm-dev/hql/releases/latest
```

Reads `tag_name` (e.g., `v0.2.0`) and compares against the local `VERSION`.

## Upgrading

### Via Installer (recommended)

macOS / Linux:

```sh
curl -fsSL hlvm.dev/install.sh | sh
```

Windows (PowerShell):

```powershell
irm hlvm.dev/install.ps1 | iex
```

### From Source

```sh
git pull origin main
make build
./hlvm --version
```

### Manual Check

```sh
hlvm upgrade --check   # Check only
hlvm upgrade           # Check + show instructions
```

## Opting Out

Set the environment variable to disable the startup check entirely:

```sh
export HLVM_NO_UPDATE_CHECK=1
```

No network requests will be made. The `hlvm upgrade` command still works independently.

## Cutting a New Release (Maintainers)

### 1. Bump version in 3 files

| File | Field |
|------|-------|
| `src/common/version.ts` | `export const VERSION = "X.Y.Z"` |
| `deno.json` | `"version": "X.Y.Z"` |
| `Makefile` | `VERSION := X.Y.Z` |

### 2. Commit and tag

```sh
git add src/common/version.ts deno.json Makefile
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
```

### 3. Push

```sh
git push origin main --tags
```

This triggers `.github/workflows/release.yml` which:

1. Builds cross-platform binaries (macOS ARM/Intel, Linux, Windows)
2. Downloads the pinned Ollama runtime
3. Creates a draft GitHub Release with checksums
4. Runs staged smoke tests on each platform
5. Publishes the release (draft → live)
6. Runs final public smoke tests

After publication, every user's next HLVM launch (post cache expiry) shows the update banner.

## Architecture

```
update-check.ts          Core logic: cache, fetch, compare, build UpdateInfo
  ├─ checkForUpdate()    Main entry — cached, non-blocking, never-throw
  ├─ fetchLatestRelease()  Shared by checkForUpdate() and `hlvm upgrade`
  ├─ isNewer()           Semver comparison via @std/semver
  └─ getUpgradeCommand() Platform detection (curl vs irm)

UpdateBanner.tsx         Ink component — bordered box with version diff
useInitialization.ts     Fires checkForUpdate() in parallel with other init
App.tsx                  Renders <UpdateBanner> between logo and conversation

upgrade.ts               CLI command `hlvm upgrade` — reuses fetchLatestRelease()
```

### Cache Format

`~/.hlvm/update-check.json`:

```json
{
  "latest": "0.2.0",
  "current": "0.1.0",
  "checked_at": 1712886400000,
  "release_url": "https://github.com/hlvm-dev/hql/releases/tag/v0.2.0"
}
```

Cache is valid when:
- `current` matches the running binary's `VERSION`
- `checked_at` is within 24 hours
