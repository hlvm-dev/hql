# HLVM Release Pipeline

## Overview

The HLVM release pipeline builds, tests, and ships a single-binary local AI
runtime to four platforms. One user command installs everything — binary,
embedded AI engine, and default model — and returns only when HLVM is ready.

```
THE USER EXPERIENCE (what we are shipping)
──────────────────────────────────────────

  $ curl -fsSL https://hlvm.dev/install.sh | sh

    > Platform: darwin/aarch64 → hlvm-mac-arm
    > Version:  v0.1.0
    > Downloading hlvm-mac-arm...
    ✓ Checksum verified.
    ✓ Installed to /usr/local/bin/hlvm
    > Bootstrapping local AI substrate...
      [extracting embedded engine...]
      [pulling gemma4:e4b model... 100% ████████████████]
      [verifying model readiness...]
    ✓ HLVM v0.1.0 is ready!

  $ hlvm ask "hello"
  Hello! How can I help you today?
```

---

## Pipeline Architecture — Single Workflow

One tag push triggers the entire pipeline. No separate proof tags, no manual
publish step. Everything is automated and gated.

```
══════════════════════════════════════════════════════════════════════════
 FULL RELEASE PIPELINE — ONE TAG, ONE WORKFLOW
══════════════════════════════════════════════════════════════════════════

 $ git tag v0.1.0 && git push origin v0.1.0
          │
          │  .github/workflows/release.yml
          │  Trigger: on.push.tags: 'v*'
          ▼

 ┌─────────────────────────────────────────────────────────────────────┐
 │  PHASE 1: RESOLVE                                                   │
 │  Extract release tag from trigger (tag push or workflow_dispatch)    │
 └──────────────────────────────────┬──────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼──────────────────────────────────┐
 │  PHASE 2: BUILD (4 platforms in parallel, ~10 min)                  │
 │  Skipped on workflow_dispatch (re-uses existing draft)               │
 │                                                                     │
 │  ┌───────────────┐ ┌───────────────┐ ┌──────────────┐ ┌──────────┐ │
 │  │ macOS ARM     │ │ macOS Intel   │ │ Linux x64    │ │ Win x64  │ │
 │  │ hlvm-mac-arm  │ │ hlvm-mac-intel│ │ hlvm-linux   │ │ hlvm-win │ │
 │  │ ~587 MB       │ │ ~587 MB       │ │ ~1.9 GB      │ │ ~1 GB    │ │
 │  └───────┬───────┘ └───────┬───────┘ └──────┬───────┘ └────┬─────┘ │
 └──────────┼─────────────────┼────────────────┼──────────────┼────────┘
            └─────────────────┴────────┬───────┴──────────────┘
                                       │
 ┌─────────────────────────────────────▼───────────────────────────────┐
 │  PHASE 3: CREATE DRAFT RELEASE (~15 min for asset upload)           │
 │  Skipped on workflow_dispatch                                       │
 │                                                                     │
 │  Download artifacts → generate checksums → add installers           │
 │  → create DRAFT on hlvm-dev/hql → upload all assets                 │
 └─────────────────────────────────────┬───────────────────────────────┘
                                       │
 ┌─────────────────────────────────────▼───────────────────────────────┐
 │  PHASE 4: STAGED SMOKE TEST (4 platforms, ~10-15 min)               │
 │  Runs ALWAYS (both tag push and workflow_dispatch)                   │
 │                                                                     │
 │  ┌───────────────┐ ┌───────────────┐ ┌──────────────┐ ┌──────────┐ │
 │  │ macOS ARM     │ │ macOS Intel   │ │ Linux x64    │ │ Win x64  │ │
 │  │ (staged)      │ │ (staged)      │ │ (staged)     │ │ (staged) │ │
 │  └───────┬───────┘ └───────┬───────┘ └──────┬───────┘ └────┬─────┘ │
 │          │ ALL MUST PASS to continue         │              │       │
 └──────────┼─────────────────┼────────────────┼──────────────┼────────┘
            └─────────────────┴────────┬───────┴──────────────┘
                                       │
                            ANY FAILURE = PIPELINE STOPS
                            (publish is gated on all-pass)
                                       │
 ┌─────────────────────────────────────▼───────────────────────────────┐
 │  PHASE 5: PUBLISH                                                   │
 │                                                                     │
 │  Validate: all required assets present, hlvm.dev URLs reachable     │
 │  Action:   gh release edit vX.Y.Z --draft=false                     │
 │                                                                     │
 │  BEFORE: api.github.com/.../releases/latest → v0.0.1               │
 │  AFTER:  api.github.com/.../releases/latest → v0.1.0               │
 │                                                                     │
 │  The public install chain now works.                                │
 └─────────────────────────────────────┬───────────────────────────────┘
                                       │
 ┌─────────────────────────────────────▼───────────────────────────────┐
 │  PHASE 6: PUBLIC SMOKE TEST (4 platforms)                           │
 │                                                                     │
 │  Proves the EXACT path a real user takes.                           │
 │  No draft token. No file://. Real public URLs end to end.           │
 │                                                                     │
 │  ┌───────────────┐ ┌───────────────┐ ┌──────────────┐ ┌──────────┐ │
 │  │ macOS ARM     │ │ macOS Intel   │ │ Linux x64    │ │ Win x64  │ │
 │  │ (public)      │ │ (public)      │ │ (public)     │ │ (public) │ │
 │  └───────────────┘ └───────────────┘ └──────────────┘ └──────────┘ │
 │                                                                     │
 │  curl -fsSL https://hlvm.dev/install.sh | sh                       │
 │  hlvm ask "hello"                                                   │
 │                                                                     │
 │  If all pass → SHIP IS COMPLETE                                     │
 └─────────────────────────────────────────────────────────────────────┘
```

---

## Workflow File

```
.github/workflows/release.yml
  Trigger: push tag v*  OR  workflow_dispatch (with tag input)
  Jobs:    resolve → build → create-release → staged-* → publish → public-*

  workflow_dispatch skips build + create-release (re-uses existing draft)
  Useful for re-running proof + publish after fixing a non-build issue
```

---

## How the Install Chain Connects

```
 WHERE THINGS ARE HOSTED
 ───────────────────────

   Firebase Hosting (hlvm.dev)         GitHub Releases (github.com)
   ─────────────────────────           ────────────────────────────
   Hosts 2 tiny text files:            Hosts the actual heavy binaries:

   hlvm.dev/install.sh  (~5 KB)       hlvm-dev/hql/releases/download/v0.1.0/
   hlvm.dev/install.ps1 (~5 KB)         ├── hlvm-mac-arm         587 MB
                                         ├── hlvm-mac-intel       587 MB
   These are just the scripts            ├── hlvm-linux.part-*    ~2 GB
   that tell your computer               ├── hlvm-windows.zip.*   ~1 GB
   WHAT to download and                  ├── checksums.sha256     ~1 KB
   WHERE from.                           ├── install.sh           ~5 KB
                                         └── install.ps1          ~5 KB

   Firebase CANNOT host 587 MB files.
   GitHub Releases CAN (up to 2 GB per asset).


 THE FULL DOWNLOAD CHAIN
 ───────────────────────

   User types:
   $ curl -fsSL https://hlvm.dev/install.sh | sh

   ┌─────────────────────────────────────────────────────────────────┐
   │                                                                 │
   │  Step 1: curl contacts hlvm.dev                                 │
   │          ▼                                                      │
   │  Step 2: Firebase responds with install.sh (5 KB script)        │
   │          ▼                                                      │
   │  Step 3: Script detects platform                                │
   │          uname -s → darwin, uname -m → arm64                    │
   │          → will download: hlvm-mac-arm                          │
   │          ▼                                                      │
   │  Step 4: Script asks GitHub API for latest version              │
   │          GET api.github.com/.../releases/latest                 │
   │          ▼                                                      │
   │  Step 5: GitHub responds: { "tag_name": "v0.1.0" }             │
   │          ▼                                                      │
   │  Step 6: Script downloads binary from GitHub Releases           │
   │          (if split: downloads .part-* and concatenates)          │
   │          ▼                                                      │
   │  Step 7: Verify SHA-256 checksum                                │
   │          ▼                                                      │
   │  Step 8: Install to /usr/local/bin/hlvm                         │
   │          ▼                                                      │
   │  Step 9: hlvm bootstrap                                         │
   │          ├─ extract embedded Ollama → ~/.hlvm/.runtime/engine   │
   │          ├─ start engine on localhost:11439                     │
   │          ├─ pull gemma4:e4b (~9.6 GB)                           │
   │          ├─ probe: wait for model to be request-ready           │
   │          ├─ write manifest.json { "state": "verified" }         │
   │          └─ stop temporary Ollama process                       │
   │          ▼                                                      │
   │  Step 10: ✓ HLVM v0.1.0 is ready!                              │
   │                                                                 │
   └─────────────────────────────────────────────────────────────────┘
```

---

## What Each Binary Contains

```
 hlvm-mac-arm (587 MB)
 ─────────────────────

 ┌──────────────────────────────────────────┐
 │  HLVM Runtime          ~80 MB            │
 │  ├── CLI (ask, repl, serve)              │
 │  ├── AI agent + orchestrator             │
 │  ├── MCP tool server support             │
 │  └── HQL transpiler + evaluator          │
 │                                          │
 │  HQL Standard Library  ~1 MB             │
 │                                          │
 │  Embedded Ollama       ~500 MB           │
 │  (pinned in embedded-ollama-version.txt) │
 └──────────────────────────────────────────┘
        │
        │  hlvm bootstrap extracts engine, pulls model
        ▼
 ~/.hlvm/.runtime/
 ├── engine           Ollama binary
 ├── models/          gemma4:e4b (~9.6 GB)
 └── manifest.json    { "state": "verified" }


 hlvm-windows.zip (~1 GB)
 ────────────────────────
 PE32+ has a 2 GB limit → cannot embed engine in .exe

 ┌──────────────────────────────────────────┐
 │  hlvm-windows.zip                        │
 │  ├── hlvm.exe          ~374 MB           │
 │  └── ai-engine/                          │
 │      ├── ollama.exe    ~500 MB           │
 │      └── manifest.json                   │
 └──────────────────────────────────────────┘

 Installer extracts zip, stages ai-engine/ beside hlvm.exe.
 Bootstrap finds the sidecar engine instead of extracting from binary.
```

---

## Why Draft-First?

```
 WITHOUT draft:  Push tag → Release is LIVE immediately
                 Broken binary? Users already downloaded it.

 WITH draft:     Push tag → Draft (invisible to users)
                 → staged smoke test → all pass? → publish
                 → broken? fix, retag, re-run. users never saw it.
```

---

## Filesystem Summary

```
 Firebase Hosting (hlvm.dev):
 ├── install.sh     5 KB
 └── install.ps1    5 KB

 GitHub Releases (github.com/hlvm-dev/hql/releases):
 ├── hlvm-mac-arm              587 MB
 ├── hlvm-mac-intel            587 MB
 ├── hlvm-linux.part-000/1/2   ~2 GB (split)
 ├── hlvm-windows.zip.part-0/1 ~1 GB (split)
 ├── checksums.sha256          ~1 KB
 ├── install.sh                ~5 KB (backup)
 └── install.ps1               ~5 KB (backup)

 User's machine after install:
 ├── /usr/local/bin/hlvm
 └── ~/.hlvm/.runtime/
     ├── engine
     ├── models/        gemma4:e4b (~9.6 GB)
     └── manifest.json  { "state": "verified" }
```

---

## Operational Runbook

### Full Release (happy path)

```bash
# 1. Tag and push → entire pipeline runs automatically
git tag v0.1.0
git push origin v0.1.0
# Wait ~30 min for build + staged proof + publish + public proof

# 2. If everything passes: release is already published, verify manually
curl -fsSL https://hlvm.dev/install.sh | sh
hlvm ask "hello"
```

### Re-run Proof Without Rebuilding

```bash
# Use workflow_dispatch (skips build, re-uses existing draft)
# Go to: Actions → Release → Run workflow → enter tag → Run
# Or via CLI:
gh workflow run release.yml --repo hlvm-dev/hql -f tag=v0.1.0
```

### Rebuild After a Fix

```bash
# Delete stale draft and tag
gh release delete v0.1.0 --repo hlvm-dev/hql --yes --cleanup-tag
git push origin :refs/tags/v0.1.0

# Re-tag at the fixed commit
git tag v0.1.0
git push origin v0.1.0
# Full pipeline re-runs automatically
```

---

## Installer Environment Variables

Used by staged smoke tests to point at draft assets instead of public URLs.

### install.sh (Unix)

| Variable | Default | Purpose |
|---|---|---|
| `HLVM_INSTALL_DIR` | `/usr/local/bin` | Where to install `hlvm` |
| `HLVM_INSTALL_BINARY_BASE_URL` | GitHub Releases URL | Override binary download URL |
| `HLVM_INSTALL_CHECKSUM_URL` | GitHub Releases URL | Override checksum file URL |

### install.ps1 (Windows)

| Variable | Default | Purpose |
|---|---|---|
| `HLVM_INSTALL_DIR` | `$env:LOCALAPPDATA\HLVM\bin` | Where to install `hlvm.exe` |
| `HLVM_INSTALL_ASSET_URL` | GitHub Releases URL | Override zip download URL |
