# HLVM Release Pipeline

## Overview

The HLVM release pipeline builds, tests, and ships a self-bootstrapping binary
to four platforms. One user command installs the binary, which then downloads
the AI engine and model during bootstrap. Returns only when HLVM is ready.

```
THE USER EXPERIENCE
───────────────────

  $ curl -fsSL https://hlvm.dev/install.sh | sh

    > Platform: darwin/aarch64 → hlvm-mac-arm
    > Version:  v0.2.0
    > Downloading hlvm-mac-arm... (120 MB)
    ✓ Checksum verified.
    ✓ Installed to /usr/local/bin/hlvm
    > Bootstrapping...
      Downloading Ollama v0.20.1...               ✓
      Starting AI engine...                        ✓
      Pulling gemma4:e4b... ████████████████ 100%
      Downloading Chromium...                      ✓
      Verifying readiness...                       ✓
    ✓ HLVM v0.2.0 is ready!

  $ hlvm ask "hello"
  Hello! How can I help you today?
```

---

## Pipeline Architecture

One tag push triggers the entire pipeline. No manual steps.

```
══════════════════════════════════════════════════════════════════════
 RELEASE PIPELINE — ONE TAG, ONE WORKFLOW
══════════════════════════════════════════════════════════════════════

 $ git tag v0.2.0 && git push origin v0.2.0
          │
          │  .github/workflows/release.yml
          ▼

 ┌─────────────────────────────────────────────────────────────────┐
 │  PHASE 1: RESOLVE                                               │
 │  Extract release tag from trigger                               │
 └──────────────────────────────┬──────────────────────────────────┘
                                │
 ┌──────────────────────────────▼──────────────────────────────────┐
 │  PHASE 2: BUILD (4 platforms in parallel, ~3-5 min)             │
 │                                                                 │
 │  ALL PLATFORMS BUILD IDENTICALLY:                               │
 │    checkout → setup Deno → build stdlib → embed packages        │
 │    → deno compile → upload ~120 MB artifact                     │
 │                                                                 │
 │  ┌───────────────┐ ┌───────────────┐ ┌────────┐ ┌────────────┐ │
 │  │ macOS ARM     │ │ macOS Intel   │ │ Linux  │ │ Windows    │ │
 │  │ ~120 MB       │ │ ~120 MB       │ │ ~120 MB│ │ ~120 MB    │ │
 │  └───────────────┘ └───────────────┘ └────────┘ └────────────┘ │
 └──────────────────────────────┬──────────────────────────────────┘
                                │ artifacts uploaded (~480 MB total)
 ┌──────────────────────────────▼──────────────────────────────────┐
 │  PHASE 3: CREATE DRAFT RELEASE                                  │
 │  Download artifacts → generate SHA-256 checksums                │
 │  → add install scripts → create DRAFT on hlvm-dev/hql           │
 │  → upload 7 assets                                              │
 └──────────────────────────────┬──────────────────────────────────┘
                                │
 ┌──────────────────────────────▼──────────────────────────────────┐
 │  PHASE 4: STAGED SMOKE TEST (4 platforms)                       │
 │  Download draft → install → bootstrap → hlvm ask "hello"        │
 │                                                                 │
 │  macOS Intel = MUST PASS (gate)                                 │
 │  Others = continue-on-error (model load patience)               │
 └──────────────────────────────┬──────────────────────────────────┘
                                │ Intel passed?
 ┌──────────────────────────────▼──────────────────────────────────┐
 │  PHASE 5: PUBLISH                                               │
 │  Validate assets → validate installer URLs → draft=false        │
 └──────────────────────────────┬──────────────────────────────────┘
                                │
 ┌──────────────────────────────▼──────────────────────────────────┐
 │  PHASE 6: PUBLIC SMOKE TEST (4 platforms)                       │
 │  Real user path: curl install.sh → download → bootstrap → ask   │
 │  No draft token. No local files. Real public URLs end to end.   │
 └─────────────────────────────────────────────────────────────────┘
```

---

## Build Matrix

All four platforms build identically. No special cases.

| Platform    | Runner           | Binary Name      | Size    |
| ----------- | ---------------- | ---------------- | ------- |
| macOS ARM   | `macos-latest`   | `hlvm-mac-arm`   | ~120 MB |
| macOS Intel | `macos-15-intel` | `hlvm-mac-intel` | ~120 MB |
| Linux x64   | `macos-latest`   | `hlvm-linux`     | ~120 MB |
| Windows x64 | `macos-latest`   | `hlvm-windows.exe` | ~120 MB |

Linux and Windows are cross-compiled on macOS via Deno's built-in cross-compile.

### Build Steps (per platform, identical)

```
1. Checkout code
2. Setup Deno v2.x
3. Build stdlib (scripts/build-stdlib.ts)
4. Embed HLVM packages (scripts/embed-packages.ts)
5. Compile: deno compile --target <target> --output <name>
6. Upload as GitHub Actions artifact (~120 MB)
```

No Ollama download. No engine embedding. No file splitting. No zip packaging.

---

## Release Assets (7 total, ~480 MB)

```
hlvm-mac-arm         ~120 MB
hlvm-mac-intel       ~120 MB
hlvm-linux           ~120 MB
hlvm-windows.exe     ~120 MB
checksums.sha256     ~1 KB
install.sh           ~5 KB
install.ps1          ~5 KB
```

Compare to previous approach: 10 assets, 8.5 GB, with file splitting.

---

## Staged Smoke Test

Downloads draft assets locally and tests the full install flow.

### Unix (staged-unix job)

```
1. Download draft assets via gh release download
2. Run install.sh with local file:// overrides
3. Installer downloads binary, runs bootstrap
4. Bootstrap downloads Ollama, pulls model, verifies
5. hlvm ask "hello"
6. Cleanup
```

### continue-on-error Strategy

The 9.6 GB model download + first-boot warmup exceeds CI runner patience on
some platforms.

```
Platform       │ Must Pass? │ Why
───────────────┼────────────┼──────────────────────────────────
macOS Intel    │ YES (gate) │ Consistently passes; blocks publish
macOS ARM      │ No         │ Model warmup exceeds runner patience
Linux x86_64   │ No         │ Model load exceeds runner patience
Windows x86_64 │ No         │ Model load exceeds runner patience
```

---

## Publish

```
1. Validate draft release has all required assets
2. Validate hlvm.dev/install.sh is reachable
3. Validate hlvm.dev/install.ps1 is reachable
4. gh release edit <tag> --draft=false
```

---

## Public Smoke Test

After publish, tests the EXACT path a real user takes. No draft tokens, no
file:// overrides. Real public URLs end to end.

```
1. Validate api.github.com/.../releases/latest = our tag
2. curl -fsSL https://hlvm.dev/install.sh | sh
3. hlvm ask "hello"
```

---

## How The Install Chain Connects

```
Firebase Hosting (hlvm.dev)           GitHub Releases (hlvm-dev/hql)
───────────────────────────           ────────────────────────────
install.sh   (~5 KB)                  hlvm-mac-arm      ~120 MB
install.ps1  (~5 KB)                  hlvm-mac-intel    ~120 MB
                                      hlvm-linux        ~120 MB
These scripts tell the user's         hlvm-windows.exe  ~120 MB
computer WHAT to download             checksums.sha256  ~1 KB
and WHERE from.                       install.sh        ~5 KB (backup)
                                      install.ps1       ~5 KB (backup)


THE FULL DOWNLOAD CHAIN
───────────────────────

  $ curl -fsSL https://hlvm.dev/install.sh | sh

  ┌──────────────────────────────────────────────────────────┐
  │  Step 1: curl contacts hlvm.dev (Firebase)                │
  │  Step 2: Firebase returns install.sh (5 KB)               │
  │  Step 3: Script detects platform                          │
  │  Step 4: Script asks GitHub API for latest version        │
  │  Step 5: Script downloads binary from GitHub Releases     │
  │  Step 6: Verify SHA-256 checksum                          │
  │  Step 7: Install to /usr/local/bin/hlvm                   │
  │  Step 8: hlvm bootstrap                                   │
  │          ├─ download Ollama from ollama/ollama releases   │
  │          ├─ extract to ~/.hlvm/.runtime/engine/           │
  │          ├─ start Ollama on :11439                        │
  │          ├─ pull model from Ollama registry               │
  │          ├─ download Chromium from CDN                    │
  │          ├─ verify model + engine + Chromium              │
  │          ├─ write manifest.json { state: "verified" }     │
  │          └─ keep Ollama running (warm model for hlvm ask) │
  │  Step 9: ✓ HLVM vX.Y.Z is ready!                         │
  └──────────────────────────────────────────────────────────┘
```

---

## Ollama Version Pinning

The Ollama version is pinned in `embedded-ollama-version.txt` at the repo root.
This file is baked into the binary at compile time. At bootstrap, the binary
reads it to know which Ollama version to download.

**Current version**: `v0.20.1`

To upgrade:
```bash
echo "v0.21.0" > embedded-ollama-version.txt
# Test: make build && ./hlvm bootstrap
```

---

## Warm Model Reuse

After `hlvm bootstrap`, Ollama keeps running with the model loaded in RAM.
The subsequent `hlvm ask` reuses this warm process for fast inference.

```
install.sh runs:
  hlvm bootstrap
    └─ starts Ollama on :11439
    └─ pulls model
    └─ keeps Ollama RUNNING with model in RAM  ← critical

  hlvm ask "hello"
    └─ connects to warm Ollama on :11439
    └─ model already loaded → fast response
```

Do NOT kill the Ollama process between bootstrap and ask.

---

## Secrets and Environment

### GitHub Actions Secrets

| Secret                   | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| `PUBLIC_RELEASE_TOKEN`   | GitHub PAT for creating/editing releases           |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account for hlvm.dev deploy     |

### Workflow Environment Variables

| Variable               | Value           | Purpose                    |
| ---------------------- | --------------- | -------------------------- |
| `PUBLIC_RELEASE_REPO`  | `hlvm-dev/hql`  | Target repo for releases   |
| `SMOKE_PROMPT`         | `hello`         | Prompt for smoke tests     |

---

## Workflow Files

| File                                  | Purpose                                 |
| ------------------------------------- | --------------------------------------- |
| `.github/workflows/release.yml`       | Build + proof + publish + public proof  |
| `.github/workflows/ci.yml`            | Test/lint on push to main               |
| `.github/workflows/deploy-website.yml`| Website + install scripts to Firebase   |

---

## Operational Runbook

### Full Release

```bash
# 1. Bump version, tag, push
git tag v0.2.0 && git push origin v0.2.0

# 2. Monitor (~10-15 min total)
gh run list --repo hlvm-dev/hql --workflow release.yml --limit 5

# 3. After pipeline completes, verify manually
curl -fsSL https://hlvm.dev/install.sh | sh
hlvm ask "hello"
```

### Re-run Proof Without Rebuilding

```bash
gh workflow run release.yml --repo hlvm-dev/hql -f tag=v0.2.0
```

### Rebuild After a Fix

```bash
gh release delete v0.2.0 --repo hlvm-dev/hql --yes
git push origin --delete v0.2.0
git tag -d v0.2.0
git tag v0.2.0
git push origin main v0.2.0
```

---

## What Changed From v0.1.0

v0.1.0 used an "embedded Ollama" approach where the AI engine was baked into
the binary at compile time. This caused:

- 587 MB - 5.2 GB binary sizes (Ollama + GPU libraries inside)
- GitHub Release assets totaling 8.5 GB
- File splitting for Linux (3 parts) and Windows (2 parts)
- Windows needed special zip+sidecar packaging (PE32+ 2 GB limit)
- Complex CI builds (~20 min, downloading/embedding Ollama per platform)

The new approach downloads Ollama at bootstrap instead of embedding it:

| Dimension           | v0.1.0 (embedded)      | v0.2.0+ (lean binary)    |
| ------------------- | ---------------------- | ------------------------ |
| Binary size         | 587 MB - 5.2 GB        | ~120 MB (all platforms)  |
| GitHub Release      | 8.5 GB, 10 files       | ~480 MB, 7 files         |
| File splitting      | Required               | None                     |
| Windows packaging   | Zip + sidecar          | Same as all platforms    |
| CI build time       | ~20 min                | ~5 min                   |
| User total download | 10-15 GB               | ~10 GB (same)            |
| First download      | 587 MB - 5.2 GB        | ~120 MB                  |
