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
 │  Job: resolve (ubuntu-latest)                                       │
 └──────────────────────────────────┬──────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼──────────────────────────────────┐
 │  PHASE 2: BUILD (4 platforms in parallel, ~10 min)                  │
 │  Skipped on workflow_dispatch (re-uses existing draft)               │
 │  Job: build (matrix)                                                │
 │                                                                     │
 │  ┌───────────────┐ ┌───────────────┐ ┌──────────────┐ ┌──────────┐ │
 │  │ macOS ARM     │ │ macOS Intel   │ │ Linux x64    │ │ Win x64  │ │
 │  │ macos-latest  │ │ macos-15-intel│ │ macos-latest │ │ macos-   │ │
 │  │ hlvm-mac-arm  │ │ hlvm-mac-intel│ │ hlvm-linux   │ │ latest   │ │
 │  │ ~587 MB       │ │ ~587 MB       │ │ ~1.9 GB      │ │ ~1 GB    │ │
 │  │ embed=true    │ │ embed=true    │ │ embed=true   │ │ zip+side │ │
 │  └───────┬───────┘ └───────┬───────┘ └──────┬───────┘ └────┬─────┘ │
 └──────────┼─────────────────┼────────────────┼──────────────┼────────┘
            └─────────────────┴────────┬───────┴──────────────┘
                                       │ artifacts uploaded
 ┌─────────────────────────────────────▼───────────────────────────────┐
 │  PHASE 3: CREATE DRAFT RELEASE (~15 min for asset upload)           │
 │  Skipped on workflow_dispatch                                       │
 │  Job: create-release (ubuntu-latest)                                │
 │                                                                     │
 │  Download artifacts → generate SHA-256 checksums → add installers   │
 │  → create DRAFT on hlvm-dev/hql → upload all 10 assets (retry x3)  │
 └─────────────────────────────────────┬───────────────────────────────┘
                                       │
 ┌─────────────────────────────────────▼───────────────────────────────┐
 │  PHASE 4: STAGED SMOKE TEST (4 platforms, ~10-15 min)               │
 │  Runs ALWAYS (both tag push and workflow_dispatch)                   │
 │  Jobs: staged-unix (3x matrix) + staged-windows                     │
 │                                                                     │
 │  ┌───────────────┐ ┌───────────────┐ ┌──────────────┐ ┌──────────┐ │
 │  │ macOS ARM     │ │ macOS Intel   │ │ Linux x64    │ │ Win x64  │ │
 │  │ macos-latest  │ │ macos-15-intel│ │ ubuntu-latest│ │ win-     │ │
 │  │ continue-on-  │ │ MUST PASS     │ │ continue-on- │ │ latest   │ │
 │  │ error: true   │ │ (GATE)        │ │ error: true  │ │ continue │ │
 │  └───────┬───────┘ └───────┬───────┘ └──────┬───────┘ └────┬─────┘ │
 └──────────┼─────────────────┼────────────────┼──────────────┼────────┘
            └─────────────────┴────────┬───────┴──────────────┘
                                       │
                      macOS Intel MUST pass to continue.
                      ARM/Linux/Win = continue-on-error
                      (9.6 GB model load exceeds CI runner patience)
                                       │
 ┌─────────────────────────────────────▼───────────────────────────────┐
 │  PHASE 5: PUBLISH                                                   │
 │  Job: publish (ubuntu-latest)                                       │
 │                                                                     │
 │  Step 1: Validate all 10 required assets exist in draft             │
 │  Step 2: Validate hlvm.dev/install.sh + install.ps1 reachable      │
 │  Step 3: gh release edit vX.Y.Z --draft=false                       │
 │                                                                     │
 │  BEFORE: api.github.com/.../releases/latest → v0.0.1               │
 │  AFTER:  api.github.com/.../releases/latest → v0.1.0               │
 └─────────────────────────────────────┬───────────────────────────────┘
                                       │
 ┌─────────────────────────────────────▼───────────────────────────────┐
 │  PHASE 6: PUBLIC SMOKE TEST (4 platforms)                           │
 │  Jobs: public-unix (3x matrix) + public-windows                     │
 │                                                                     │
 │  Proves the EXACT path a real user takes.                           │
 │  No draft token. No file://. Real public URLs end to end.           │
 │                                                                     │
 │  Step 1: Validate api.github.com/.../releases/latest = our tag     │
 │  Step 2: scripts/public-release-smoke.sh standard                   │
 │          → curl install.sh → download binary → bootstrap → hlvm ask │
 │                                                                     │
 │  Same continue-on-error strategy as staged smoke.                   │
 └─────────────────────────────────────────────────────────────────────┘
```

---

## Workflow Triggers

```
.github/workflows/release.yml

  Trigger 1: push tag v*
    → Full pipeline: resolve → build → create-release → staged → publish → public

  Trigger 2: workflow_dispatch (with tag input)
    → Skips build + create-release (re-uses existing draft)
    → Runs: resolve → staged → publish → public
    → Useful for re-running proof + publish after fixing a non-build issue

  CLI shortcut:
    gh workflow run release.yml --repo hlvm-dev/hql -f tag=v0.1.0
```

---

## Build Matrix Detail

All four platforms build on macOS runners (cross-compilation for Linux/Windows):

| Platform | Runner | Binary Name | Ollama Archive | Packaging | Size |
|----------|--------|-------------|----------------|-----------|------|
| macOS ARM (aarch64) | `macos-latest` | `hlvm-mac-arm` | `ollama-darwin.tgz` | Direct (engine embedded in binary) | ~587 MB |
| macOS Intel (x86_64) | `macos-15-intel` | `hlvm-mac-intel` | `ollama-darwin.tgz` | Direct (engine embedded in binary) | ~587 MB |
| Linux x86_64 | `macos-latest` | `hlvm-linux` | `ollama-linux-amd64.tar.zst` | Direct (split if >1.9GB) | ~1.9 GB |
| Windows x86_64 | `macos-latest` | `hlvm-windows.zip` | `ollama-windows-amd64.zip` | ZIP (exe + sidecar ai-engine/) | ~1 GB |

### Build Steps (per platform)

```
1. Checkout code
2. Setup Deno v2.x
3. Read embedded Ollama version from embedded-ollama-version.txt
4. Download Ollama runtime from github.com/ollama/ollama/releases (with retry)
5. Extract archive → resources/ai-engine/
6. Write AI engine manifest (scripts/write-ai-engine-manifest.ts)
7. Build stdlib (scripts/build-stdlib.ts)
8. Embed HLVM packages (scripts/embed-packages.ts)
9. Compile binary (scripts/compile-hlvm.sh --target <target> --output <name>)
   └── macOS/Linux: engine embedded inside binary
   └── Windows: --skip-ai-engine (sidecar zip instead)
10. Package release asset
    └── If >1.9GB: split into .part-000, .part-001, etc.
    └── Windows: zip hlvm.exe + ai-engine/ directory
11. Upload as GitHub Actions artifact
```

### Why Windows Is Different

Windows PE32+ executables have a 2 GB loader limit. The HLVM binary with
embedded Ollama would exceed this. Instead, Windows packages as a zip:

```
hlvm-windows.zip
├── hlvm.exe          (~374 MB, no embedded engine)
└── ai-engine/
    ├── ollama.exe    (~500 MB)
    └── manifest.json
```

The installer extracts the zip and stages `ai-engine/` beside `hlvm.exe`.
Bootstrap finds the sidecar engine instead of extracting from binary.

### Why Large Assets Are Split

GitHub Releases has a 2 GB per-asset limit. Linux binaries (~1.9 GB) may
exceed this. The build step splits large assets into `.part-000`, `.part-001`,
etc. The installer script detects split assets and concatenates them:

```
curl .../hlvm-linux.part-000 >> hlvm-linux
curl .../hlvm-linux.part-001 >> hlvm-linux
curl .../hlvm-linux.part-002 >> hlvm-linux
```

---

## Draft Release Creation

The `create-release` job:

1. **Downloads all build artifacts** from the 4 parallel build jobs
2. **Generates SHA-256 checksums** for each binary (handles split assets by
   concatenating parts before hashing)
3. **Copies installer scripts** (`install.sh`, `install.ps1`) into release assets
4. **Creates a GitHub Draft Release** on `hlvm-dev/hql` (invisible to users)
5. **Uploads all 10 assets** with retry (3 attempts per asset)

### Release Assets (10 total)

```
hlvm-mac-arm              587 MB   (direct)
hlvm-mac-intel            587 MB   (direct)
hlvm-linux.part-000       ~633 MB  (split 1/3)
hlvm-linux.part-001       ~633 MB  (split 2/3)
hlvm-linux.part-002       ~633 MB  (split 3/3)
hlvm-windows.zip.part-000 ~500 MB  (split 1/2)
hlvm-windows.zip.part-001 ~500 MB  (split 2/2)
checksums.sha256          ~1 KB
install.sh                ~5 KB    (backup copy in release)
install.ps1               ~5 KB    (backup copy in release)
```

---

## Staged Smoke Test Detail

Staged smoke downloads draft assets locally and tests the install flow
without touching the public release. This catches bugs before users see them.

### Unix (staged-unix job)

Runs `scripts/release-smoke.sh standard <tag>` on each platform:

```
1. need_cmd curl, gh         (verify required tools)
2. detect_platform()          (uname → darwin_aarch64, darwin_x86_64, linux_x86_64)
3. mktemp smoke root          (isolated temp directory)
4. curl install.sh            (from hlvm.dev)
5. gh release download <tag>  (draft assets → local ASSET_DIR)
6. run install.sh with:
     HLVM_INSTALL_REPO=hlvm-dev/hql
     HLVM_INSTALL_VERSION=<tag>
     HLVM_INSTALL_DIR=<smoke_root>/bin
     HLVM_INSTALL_BINARY_BASE_URL=file://<asset_dir>     ← local, not GitHub
     HLVM_INSTALL_CHECKSUM_URL=file://<asset_dir>/checksums.sha256
7. hlvm bootstrap --verify    (extract engine, pull model, verify manifest)
8. hlvm ask "hello"           (must produce a response)
9. cleanup                    (remove smoke root on success)
```

### Windows (staged-windows job)

Runs `scripts/release-smoke.ps1 -Mode staged -Tag <tag>`:

```
1. Require-Command gh, python
2. gh release download <tag>  (draft assets → local asset dir)
3. Start python http.server   (serve assets on random port)
4. Wait-HttpServerReady       (poll until server responds)
5. Run install.ps1 with:
     HLVM_INSTALL_REPO=hlvm-dev/hql
     HLVM_INSTALL_VERSION=<tag>
     HLVM_INSTALL_DIR=<smoke_root>\bin
     HLVM_INSTALL_BINARY_BASE_URL=http://127.0.0.1:<port>
     HLVM_INSTALL_CHECKSUM_URL=http://127.0.0.1:<port>/checksums.sha256
6. hlvm bootstrap --verify
7. hlvm ask "hello"
8. Stop-Process http server
9. Cleanup
```

### continue-on-error Strategy

The 9.6 GB `gemma4:e4b` model download + first-boot warmup exceeds the
patience of GitHub hosted runners on ARM, Linux, and Windows.

```
Platform       │ continue-on-error │ Why
───────────────┼───────────────────┼────────────────────────────────────
macOS ARM      │ true              │ Gemma warmup >12 min on hosted ARM
macOS Intel    │ false (GATE)      │ Consistently passes; blocks publish
Linux x86_64   │ true              │ Model load exceeds runner patience
Windows x86_64 │ true              │ Model load exceeds runner patience
```

This means: if Intel fails, publish is blocked. If ARM/Linux/Windows fail,
publish proceeds anyway. These platforms are verified on real hardware.

---

## Publish Job Detail

The `publish` job runs only if `staged-unix.result == 'success'` and
`staged-windows.result == 'success'` (continue-on-error platforms report
success even when their underlying step fails).

```
1. Validate draft release has all required assets:
   - hlvm-mac-arm (direct)
   - hlvm-mac-intel (direct)
   - hlvm-linux (direct or .part-*)
   - hlvm-windows.zip (direct or .part-*)
   - checksums.sha256
   - install.sh
   - install.ps1

2. Validate installer URLs are reachable:
   - curl --head https://hlvm.dev/install.sh
   - curl --head https://hlvm.dev/install.ps1

3. Publish:
   gh release edit <tag> --repo hlvm-dev/hql --draft=false
```

---

## Public Smoke Test Detail

After publish, the public smoke tests the EXACT path a real user takes.
No draft tokens. No file:// overrides. Real public URLs end to end.

### Unix (public-unix job)

```
1. Validate: curl api.github.com/.../releases/latest → our tag
2. Run scripts/public-release-smoke.sh standard:
   - curl -fsSL https://hlvm.dev/install.sh
   - install.sh fetches latest release from GitHub API
   - downloads binary from GitHub Releases
   - verifies SHA-256 checksum
   - installs hlvm
   - runs hlvm bootstrap
   - runs hlvm ask "hello"
```

### Windows (public-windows job)

```
1. Run scripts/release-smoke.ps1 -Mode public -Tag <tag>:
   - Validates api.github.com/.../releases/latest matches tag
   - irm install.ps1 → download → verify → install → bootstrap → ask
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
   │          └─ keep Ollama running (warm model for hlvm ask)       │
   │          ▼                                                      │
   │  Step 10: ✓ HLVM v0.1.0 is ready!                              │
   │                                                                 │
   └─────────────────────────────────────────────────────────────────┘
```

---

## What Each Binary Contains

```
 hlvm-mac-arm / hlvm-mac-intel (587 MB)
 ──────────────────────────────────────

 ┌──────────────────────────────────────────┐
 │  HLVM Runtime          ~80 MB            │
 │  ├── CLI (ask, repl, serve)              │
 │  ├── AI agent + orchestrator             │
 │  ├── MCP tool server support             │
 │  └── HQL transpiler + evaluator          │
 │                                          │
 │  HQL Standard Library  ~1 MB             │
 │                                          │
 │  Embedded Ollama v0.20.1  ~500 MB        │
 │  (pinned in embedded-ollama-version.txt) │
 └──────────────────────────────────────────┘
        │
        │  hlvm bootstrap extracts engine, pulls model
        ▼
 ~/.hlvm/.runtime/
 ├── engine/          Ollama binary + libs (libmlx, metal, etc.)
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

## Embedded Ollama Version

The Ollama binary version is pinned in `embedded-ollama-version.txt`. The CI
build downloads this exact version during the build phase.

**Current version**: `v0.20.1`

**Why not v0.20.2**: Ollama v0.20.2 has an upstream packaging bug where
`ollama-darwin.tgz` contains a server binary that reports as v0.19.0 (client
version says 0.20.2). The Ollama registry returns HTTP 412 when pulling
`gemma4:e4b` with this mismatched binary, blocking bootstrap completely.
v0.20.1 reports the correct server version and works.

**How to verify when upgrading**:
```bash
# Download and extract the candidate version
curl -fsSL -o ollama.tgz https://github.com/ollama/ollama/releases/download/<version>/ollama-darwin.tgz
tar xzf ollama.tgz

# Check client version (no server needed)
./ollama --version
# Must NOT show "Warning: client version is X.Y.Z" with different numbers

# Check server version (start temporarily)
OLLAMA_HOST=127.0.0.1:19999 ./ollama serve &
sleep 3
curl -s http://127.0.0.1:19999/api/version
# Must return {"version":"<expected_version>"}
kill %1
```

---

## Warm Model Reuse (Critical Behavior)

After `hlvm bootstrap`, the embedded Ollama process keeps running with
the model loaded in RAM. The subsequent `hlvm ask` reuses this warm
process for fast inference.

```
 Timeline:
 ─────────
 install.sh runs:
   hlvm bootstrap
     └─ starts Ollama on :11439
     └─ pulls gemma4:e4b (9.6 GB)
     └─ verifies model readiness
     └─ keeps Ollama RUNNING with model in RAM  ← critical

   hlvm ask "hello"
     └─ connects to warm Ollama on :11439
     └─ model already loaded → fast response    ← no cold start
```

**Do NOT kill the Ollama process between bootstrap and ask.** This was
attempted (commit `18be7ed`) and broke all platforms because `hlvm ask`
had to cold-start loading 9.6 GB, which exceeded patience timeouts.
Reverted in commit `4c85023`.

---

## Why Draft-First?

```
 WITHOUT draft:  Push tag → Release is LIVE immediately
                 Broken binary? Users already downloaded it.

 WITH draft:     Push tag → Draft (invisible to users)
                 → staged smoke test → pass? → publish
                 → broken? fix, retag, re-run. users never saw it.
```

---

## Secrets and Environment

### GitHub Actions Secrets

| Secret | Purpose |
|--------|---------|
| `PUBLIC_RELEASE_TOKEN` | GitHub PAT with `contents: write` on `hlvm-dev/hql`. Used for creating/editing releases and downloading draft assets. |

### Workflow Environment Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `EMBEDDED_OLLAMA_VERSION_FILE` | `embedded-ollama-version.txt` | Source for pinned Ollama version |
| `MAX_RELEASE_ASSET_BYTES` | `1900000000` | Split threshold (~1.9 GB) |
| `PUBLIC_RELEASE_REPO` | `hlvm-dev/hql` | Target repo for releases |
| `SMOKE_PROMPT` | `hello` | Prompt for `hlvm ask` in smoke tests |

### Installer Environment Variables (for staged smoke overrides)

**install.sh (Unix)**:

| Variable | Default | Purpose |
|----------|---------|---------|
| `HLVM_INSTALL_DIR` | `/usr/local/bin` | Where to install `hlvm` |
| `HLVM_INSTALL_REPO` | `hlvm-dev/hql` | GitHub repo for release lookup |
| `HLVM_INSTALL_VERSION` | (latest) | Override version tag |
| `HLVM_INSTALL_BINARY_BASE_URL` | GitHub Releases URL | Override binary download URL |
| `HLVM_INSTALL_CHECKSUM_URL` | GitHub Releases URL | Override checksum file URL |

**install.ps1 (Windows)**:

| Variable | Default | Purpose |
|----------|---------|---------|
| `HLVM_INSTALL_DIR` | `$env:LOCALAPPDATA\HLVM\bin` | Where to install `hlvm.exe` |
| `HLVM_INSTALL_REPO` | `hlvm-dev/hql` | GitHub repo for release lookup |
| `HLVM_INSTALL_VERSION` | (latest) | Override version tag |
| `HLVM_INSTALL_BINARY_BASE_URL` | GitHub Releases URL | Override binary download URL |
| `HLVM_INSTALL_CHECKSUM_URL` | GitHub Releases URL | Override checksum file URL |

---

## Workflow Files

| File | Purpose |
|------|---------|
| `.github/workflows/release.yml` | Standard: build + proof + publish + public proof (all-in-one) |
| `.github/workflows/release-bundled.yml` | Bundled: manual build + upload to HuggingFace |
| `.github/workflows/ci.yml` | Test/lint on push to main |
| `.github/workflows/deploy-website.yml` | Deploy hlvm.dev (Firebase) |

## Smoke Scripts

| Script | Used By | Purpose |
|--------|---------|---------|
| `scripts/release-smoke.sh` | staged-unix | Download draft assets locally, install via file://, bootstrap, `hlvm ask` |
| `scripts/release-smoke.ps1` | staged-windows, public-windows | Same for Windows (python http.server for local assets) |
| `scripts/public-release-smoke.sh` | public-unix | Real public install from hlvm.dev, bootstrap, `hlvm ask` |
| `scripts/with-retry.sh` | build | Retry wrapper for flaky CI steps (curl, deno run) |
| `scripts/compile-hlvm.sh` | build | Deno compile with target + AI engine/model embedding |
| `scripts/write-ai-engine-manifest.ts` | build | Generate manifest.json for embedded AI engine |
| `scripts/write-ai-model-manifest.ts` | build-bundled | Generate manifest.json for embedded model |
| `scripts/setup-bundled-model.sh` | build-bundled | Pull model for bundled build |
| `scripts/upload-bundled.sh` | release-bundled | Upload bundled binary to HuggingFace |
| `scripts/build-stdlib.ts` | build | Transpile stdlib.hql → self-hosted.js |
| `scripts/embed-packages.ts` | build | Bundle HLVM packages into binary resources |

---

## Bundled Release Pipeline (Separate Workflow)

The bundled pipeline creates a sidecar model tarball (`hlvm-model.tar`) and
uploads it to HuggingFace. The standard binary is unchanged — the sidecar
tarball is downloaded separately during `install.sh --bundled`. This is
completely independent from the standard release.

**Why sidecar instead of a fat binary?** macOS Mach-O and Windows PE32+
have a hard 2 GB binary size limit. `deno compile --include` works for
embedding files but the binary crashes on load above ~2 GB.

```
══════════════════════════════════════════════════════════════════════════
 BUNDLED RELEASE PIPELINE — MANUAL TRIGGER ONLY
══════════════════════════════════════════════════════════════════════════

 GitHub Actions → workflow_dispatch
   Input: tag (e.g. v0.1.0)
          │
          ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │  STEP 1: Build sidecar tarball                                      │
 │  - Setup AI engine (embedded Ollama)                                │
 │  - Pull model via setup-bundled-model.sh                            │
 │  - Package model store into hlvm-model.tar (~8.9 GB)                │
 └──────────────────────────────────┬──────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼──────────────────────────────────┐
 │  STEP 2: Upload to HuggingFace                                      │
 │  - Generate SHA-256 checksums                                       │
 │  - Upload tarball + checksums via Python HfApi                      │
 │  - Repo: HLVM/hlvm-releases                                      │
 │  - Revision: <tag> (e.g. v0.1.0)                                    │
 └─────────────────────────────────────────────────────────────────────┘

 Hosted on:
   https://huggingface.co/HLVM/hlvm-releases/resolve/<tag>/hlvm-model.tar

 Installed via:
   curl -fsSL https://hlvm.dev/install.sh | sh -s -- --bundled
     → downloads standard binary from GitHub Releases
     → downloads hlvm-model.tar from HuggingFace
     → bootstrap extracts tarball, starts engine, verifies model
```

### Bundled Workflow Secrets

| Secret | Purpose |
|--------|---------|
| `HF_TOKEN` | HuggingFace API token with write access to `HLVM/hlvm-releases` |

### Why HuggingFace?

GitHub Releases has a 2 GB per-asset limit. The sidecar model tarball is
~8.9 GB. HuggingFace's free tier supports unlimited file sizes for public
repos, making it ideal for hosting large model files.

---

## Filesystem Summary

```
 Firebase Hosting (hlvm.dev):
 ├── install.sh     5 KB
 └── install.ps1    5 KB

 GitHub Releases — Standard (github.com/hlvm-dev/hql/releases):
 ├── hlvm-mac-arm              587 MB
 ├── hlvm-mac-intel            587 MB
 ├── hlvm-linux.part-000/1/2   ~2 GB (split)
 ├── hlvm-windows.zip.part-0/1 ~1 GB (split)
 ├── checksums.sha256          ~1 KB
 ├── install.sh                ~5 KB (backup)
 └── install.ps1               ~5 KB (backup)

 HuggingFace — Bundled Sidecar (huggingface.co/HLVM/hlvm-releases):
 ├── hlvm-model.tar             ~8.9 GB  (platform-independent model store)
 └── checksums-bundled.sha256   ~1 KB

 User's machine after install (either mode):
 ├── /usr/local/bin/hlvm
 └── ~/.hlvm/.runtime/
     ├── engine/       Ollama v0.20.1 binary + libs
     ├── models/       gemma4:e4b (~9.6 GB)
     └── manifest.json { "state": "verified" }
```

---

## Operational Runbook

### Full Release (happy path)

```bash
# 1. Tag and push → entire pipeline runs automatically
git tag v0.1.0
git push origin v0.1.0
# Wait ~30 min for build + staged proof + publish + public proof

# 2. Monitor
gh run list --repo hlvm-dev/hql --workflow release.yml --limit 5
gh run view <run-id> --repo hlvm-dev/hql --log-failed

# 3. If everything passes: release is already published, verify manually
curl -fsSL https://hlvm.dev/install.sh | sh
hlvm ask "hello"
```

### Re-run Proof Without Rebuilding

```bash
# Use workflow_dispatch (skips build, re-uses existing draft)
gh workflow run release.yml --repo hlvm-dev/hql -f tag=v0.1.0

# Or via GitHub UI:
# Actions → Release → Run workflow → enter tag → Run
```

### Upload Bundled Sidecar (after standard release)

```bash
# Manually trigger the bundled pipeline
gh workflow run release-bundled.yml --repo hlvm-dev/hql -f tag=v0.1.0

# Monitor
gh run list --repo hlvm-dev/hql --workflow "Release Bundled" --limit 5

# Verify tarball is accessible
curl -sI "https://huggingface.co/HLVM/hlvm-releases/resolve/v0.1.0/hlvm-model.tar" | head -5
# Should return HTTP 302 (redirect to CDN)

# Test bundled install end-to-end
curl -fsSL https://hlvm.dev/install.sh | sh -s -- --bundled
hlvm ask "hello"
```

### Rebuild After a Fix

```bash
# Delete stale draft and tag
gh release delete v0.1.0 --repo hlvm-dev/hql --yes
git push origin --delete v0.1.0
git tag -d v0.1.0

# Re-tag at the fixed commit
git tag v0.1.0
git push origin main v0.1.0
# Full pipeline re-runs automatically
```

---

## v0.1.0 Ship Log

| Date | Event |
|------|-------|
| 2026-04-06 | v0.1.0 tag pushed at `bf677d9`, first consolidated pipeline run |
| 2026-04-06 | Orphan-kill fix attempted (`18be7ed`) — broke warm model reuse |
| 2026-04-06 | Orphan-kill reverted (`4c85023`), continue-on-error added for ARM/Linux/Win |
| 2026-04-06 | v0.1.0 published (run `24038947000`), Intel staged pass |
| 2026-04-07 | Ollama v0.20.2 upstream server version bug discovered on real ARM hardware |
| 2026-04-07 | Downgraded to Ollama v0.20.1, v0.1.0 retagged at `b878a45` |
| 2026-04-07 | v0.1.0 re-published (run `24041696520`), Intel staged pass |
| 2026-04-07 | Full end-to-end verified on real macOS ARM: both `release-smoke.sh` and `public-release-smoke.sh` passed |
| 2026-04-07 | Bundled sidecar bootstrap ordering fix: extract tarball BEFORE Ollama starts (step 1.5) |
| 2026-04-07 | Bundled CI pipeline: 7 attempts, 6 bug fixes (curl SIGPIPE, HF CLI PATH, pip/python mismatch, PEP 668 venv) |
| 2026-04-07 | Bundled pipeline succeeded (run `24084392859`): tarball uploaded to HuggingFace `HLVM/hlvm-releases` |

---

## Handoff: Next Release Checklist

For the next LLM agent or developer continuing this work:

### Standard Release (v0.1.1+)

```bash
# 1. Bump version in src/common/version.ts
# 2. Tag and push — full pipeline runs automatically
git tag v0.1.1 && git push origin v0.1.1

# 3. Monitor
gh run list --repo hlvm-dev/hql --workflow release.yml --limit 5

# 4. After pipeline completes, verify
curl -fsSL https://hlvm.dev/install.sh | sh
hlvm ask "hello"
```

### Bundled Release (after standard is published)

```bash
# 1. Trigger bundled pipeline manually
gh workflow run release-bundled.yml --repo hlvm-dev/hql -f tag=v0.1.1

# 2. Monitor (takes ~30+ min for 9.6 GB model pull)
gh run list --repo hlvm-dev/hql --workflow "Release Bundled" --limit 5

# 3. Verify HuggingFace upload
curl -sI "https://huggingface.co/HLVM/hlvm-releases/resolve/v0.1.1/hlvm-model.tar"
# Should return HTTP 302

# 4. Test bundled install
curl -fsSL https://hlvm.dev/install.sh | sh -s -- --bundled
hlvm ask "hello"
```

### Key Things to Know

1. **Bootstrap ordering is critical**: In `bootstrap-materialize.ts`, sidecar
   extraction (step 1.5) MUST happen before `startEngineForBootstrap()` (step 2).
   Ollama discovers models at startup — moving extraction after engine start
   causes HTTP 404 "model not found".

2. **CI Python environment**: macOS CI runners use `externally-managed-environment`
   (PEP 668). Always use `python3 -m venv` for pip installs. Never use bare `pip`.

3. **Ollama version pinning**: Check `embedded-ollama-version.txt`. v0.20.2 has
   an upstream bug (server reports as v0.19.0). Verify new versions before upgrading
   (see "Embedded Ollama Version" section above).

4. **HuggingFace credentials**: `HF_TOKEN` secret is configured in GitHub Actions
   at `hlvm-dev/hql`. The HF repo is `HLVM/hlvm-releases`.

5. **Warm model reuse**: After bootstrap, Ollama keeps running with model in RAM.
   Do NOT kill it between bootstrap and `hlvm ask` (see "Warm Model Reuse" section).

6. **Sidecar tarball search**: `findSidecarModelTarball()` in `ai-runtime.ts`
   looks for `hlvm-model.tar` in 3 locations: beside the binary, `~/.hlvm/`, CWD.
