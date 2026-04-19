# HLVM Release Pipeline

## Overview

The HLVM release pipeline builds, tests, and ships a self-bootstrapping binary
to four platforms. One user command installs the binary, which then performs
all runtime heavy lifting during `hlvm bootstrap`. Install completes only after
HLVM has:

- downloaded the pinned Ollama engine
- selected the pinned local fallback model tier for the host
- pulled that local fallback model
- downloaded managed Chromium for browser automation
- installed a HLVM-owned `uv` binary
- installed a HLVM-owned CPython runtime and isolated Python sidecar pack
- verified the resulting runtime manifest

```
THE USER EXPERIENCE
───────────────────

  $ curl -fsSL https://hlvm.dev/install.sh | sh

    > Platform: darwin/aarch64 → hlvm-mac-arm
    > Version:  vX.Y.Z
    > Downloading hlvm-mac-arm... (363 MB)
    ✓ Checksum verified.
    ✓ Installed to /usr/local/bin/hlvm
    > Bootstrapping...
      Downloading Ollama v0.21.0...               ✓
      Downloading Chromium...                      ✓
      Installing uv 0.11.7...                     ✓
      Installing Python 3.13.13...                ✓
      Installing default Python sidecar pack...   ✓
      Starting AI engine...                        ✓
      Selecting local model tier...                qwen3:8b
      Pulling qwen3:8b... ████████████████ 100%
      Verifying readiness...                       ✓
    ✓ HLVM vX.Y.Z is ready!

  $ hlvm ask "hello"
  Hello! How can I help you today?
```

---

## Pipeline Architecture

One tag push triggers the entire pipeline. No manual release steps.

```
══════════════════════════════════════════════════════════════════════
 RELEASE PIPELINE — ONE TAG, ONE WORKFLOW
══════════════════════════════════════════════════════════════════════

 $ git tag vX.Y.Z && git push origin vX.Y.Z
          │
          │  .github/workflows/release.yml
          ▼

 ┌─────────────────────────────────────────────────────────────────┐
 │  PHASE 1: RESOLVE                                               │
 │  Extract release tag from trigger                               │
 └──────────────────────────────┬──────────────────────────────────┘
                                │
 ┌──────────────────────────────▼──────────────────────────────────┐
 │  PHASE 2: BUILD (4 platforms in parallel)                       │
 │                                                                 │
 │  ALL PLATFORMS BUILD IDENTICALLY:                               │
 │    checkout → setup Deno → build stdlib → embed runtime pins    │
 │    → deno compile → upload ~363 MB artifact                     │
 └──────────────────────────────┬──────────────────────────────────┘
                                │ artifacts uploaded (~1.5 GB total)
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
 │  Others = continue-on-error (bootstrap warmup patience)         │
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

All four platforms build identically.

| Platform    | Runner           | Binary Name        | Size    |
| ----------- | ---------------- | ------------------ | ------- |
| macOS ARM   | `macos-latest`   | `hlvm-mac-arm`     | ~363 MB |
| macOS Intel | `macos-15-intel` | `hlvm-mac-intel`   | ~363 MB |
| Linux x64   | `macos-latest`   | `hlvm-linux`       | ~363 MB |
| Windows x64 | `macos-latest`   | `hlvm-windows.exe` | ~363 MB |

Linux and Windows are cross-compiled on macOS via Deno's built-in
cross-compilation.

### Build Steps

```
1. Checkout code
2. Setup Deno v2.x
3. Build stdlib (scripts/build-stdlib.ts)
4. Embed HLVM packages (scripts/embed-packages.ts)
5. Compile:
   deno compile --target <target> --output <name>
6. Upload as GitHub Actions artifact (~363 MB)
```

The compiled binary includes the pin files that drive bootstrap:

- `embedded-ollama-version.txt`
- `embedded-model-tiers.json`
- `embedded-uv-version.txt`
- `embedded-python-version.txt`
- `embedded-python-sidecar-requirements.txt`

No Ollama binary, model blobs, Chromium archive, or Python distribution is
embedded in the compiled artifact.

---

## Release Assets

Seven assets are published per release:

```
hlvm-mac-arm         ~363 MB
hlvm-mac-intel       ~363 MB
hlvm-linux           ~363 MB
hlvm-windows.exe     ~363 MB
checksums.sha256     ~1 KB
install.sh           ~5 KB
install.ps1          ~5 KB
```

---

## Runtime Pins

Bootstrap is driven by the following pinned defaults in the repo:

| Component              | Pin / Default |
| ---------------------- | ------------- |
| Ollama engine          | `v0.21.0`     |
| Local fallback tiers   | `>=64 GiB -> qwen3:30b`, otherwise `qwen3:8b` |
| Managed `uv`           | `0.11.7`      |
| Managed CPython        | `3.13.13`     |

The default Python sidecar pack is pinned in
`embedded-python-sidecar-requirements.txt` and currently installs:

- `pypdf`
- `pdfplumber`
- `python-pptx`
- `python-docx`
- `openpyxl`
- `defusedxml`
- `Pillow`
- `icalendar`
- `vobject`
- `beautifulsoup4`
- `Jinja2`
- `striprtf`
- `fastmcp`
- `pydantic`
- `PyYAML`

This pack is installed into an isolated HLVM-owned virtual environment. System
Python is never required.

The local-model tier map is pinned in `embedded-model-tiers.json`. Current
policy is intentionally conservative:

- `qwen3:8b` is the baseline default, including 32 GiB M1 Max machines
- `qwen3:30b` is reserved for 64 GiB and larger hosts
- `qwen3:14b` remains a supported manual upgrade path, not the auto-installed default

Model identity pins must match the live Ollama registry manifests, not the
human-facing library detail pages, because those detail pages can lag behind the
actual pull artifacts.

Bootstrap and first-use runtime attachment are both root-aware:

- the managed Ollama endpoint on `127.0.0.1:11439` must belong to the same
  `HLVM_DIR` that requested bootstrap
- the background HLVM runtime host must match both the build identity and the
  requesting `HLVM_DIR`
- clean installs must never silently reuse another runtime root's engine, model
  store, or background host

---

## Staged Smoke Test

Draft smoke tests download staged assets locally and exercise the full install
contract.

Both staged and public smoke tests run inside an isolated temp `HLVM_DIR` and a
dedicated runtime-host port so release validation does not inherit the caller's
existing `~/.hlvm` state or background `hlvm serve` processes.

### Unix staged path

```
1. Download draft assets via gh release download
2. Run install.sh with local file:// overrides
3. Export isolated `HLVM_DIR` and `HLVM_REPL_PORT`
4. Installer downloads binary and runs bootstrap
5. Bootstrap installs Ollama + model + Chromium + Python sidecar
6. `hlvm ask "hello"` runs against the isolated runtime host
7. Cleanup
```

### continue-on-error Strategy

The fallback model download still dominates first-run wall-clock time, so staged
CI keeps one hard gate and lets the other platforms continue on error.

```
Platform       │ Must Pass? │ Why
───────────────┼────────────┼────────────────────────────────────────────
macOS Intel    │ YES (gate) │ Most stable bootstrap signal; blocks publish
macOS ARM      │ No         │ Warmup and downloads may exceed runner patience
Linux x86_64   │ No         │ Warmup and downloads may exceed runner patience
Windows x86_64 │ No         │ Warmup and downloads may exceed runner patience
```

---

## Public Install Chain

```
Firebase Hosting (hlvm.dev)           GitHub Releases (hlvm-dev/hql)
───────────────────────────           ──────────────────────────────
install.sh   (~5 KB)                  hlvm-mac-arm      ~363 MB
install.ps1  (~5 KB)                  hlvm-mac-intel    ~363 MB
                                      hlvm-linux        ~363 MB
These scripts tell the user's         hlvm-windows.exe  ~363 MB
computer what to download             checksums.sha256  ~1 KB
and where from.                       install.sh        ~5 KB (backup)
                                      install.ps1       ~5 KB (backup)
```

```
$ curl -fsSL https://hlvm.dev/install.sh | sh

  Step 1: curl contacts hlvm.dev (Firebase)
  Step 2: Firebase returns install.sh
  Step 3: Script detects platform
  Step 4: Script asks GitHub API for the latest release
  Step 5: Script downloads the platform binary from GitHub Releases
  Step 6: Script verifies SHA-256
  Step 7: Script installs hlvm
  Step 8: Script runs hlvm bootstrap
          ├─ download Ollama from official releases
          ├─ extract to ~/.hlvm/.runtime/engine/
          ├─ detect host memory and choose the pinned model tier
          ├─ install uv to ~/.hlvm/.runtime/python/uv/
          ├─ install CPython to ~/.hlvm/.runtime/python/cpython/
          ├─ create ~/.hlvm/.runtime/python/venv/
          ├─ install the default Python sidecar pack
          ├─ start Ollama on 127.0.0.1:11439
          ├─ pull the selected qwen3 fallback into ~/.hlvm/.runtime/models/
          ├─ download Chromium into ~/.hlvm/.runtime/chromium/
          ├─ verify engine + model + Python sidecar
          ├─ write ~/.hlvm/.runtime/manifest.json
          └─ keep Ollama warm for the first hlvm ask
  Step 9: install exits only after HLVM is ready
```

---

## Manifest Contract

Bootstrap writes `~/.hlvm/.runtime/manifest.json` only after verification.
Current manifest shape includes:

- `engine`
- `models`
- optional `browsers`
- required `python`
- `buildId`
- `createdAt`
- `lastVerifiedAt`

The `python` record captures:

- pinned CPython version
- pinned `uv` version and path
- HLVM-owned install root
- isolated virtualenv path
- interpreter hash
- copied requirements path and hash
- top-level provisioned package list

`hlvm bootstrap --verify` fails closed if the Python sidecar record is missing
or no longer matches the on-disk runtime.

---

## Warm Model Reuse

After `hlvm bootstrap`, Ollama keeps running with the model loaded in RAM. The
first `hlvm ask` reuses that warm process.

```
install.sh runs:
  hlvm bootstrap
    └─ starts Ollama on :11439
    └─ pulls model
    └─ keeps Ollama running with the model warm

  hlvm ask "hello"
    └─ connects to warm Ollama on :11439
    └─ model already loaded → faster first response
```

Do not kill Ollama between bootstrap and the first `hlvm ask`.

---

## Workflow Files

| File                                   | Purpose                                 |
| -------------------------------------- | --------------------------------------- |
| `.github/workflows/release.yml`        | Build + staged proof + publish + smoke  |
| `.github/workflows/ci.yml`             | Test/lint on push to main               |
| `.github/workflows/deploy-website.yml` | Website + install scripts to Firebase   |

---

## Operational Runbook

### Full release

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
gh run list --repo hlvm-dev/hql --workflow release.yml --limit 5

curl -fsSL https://hlvm.dev/install.sh | sh
hlvm ask "hello"
```

### Re-run proof without rebuilding

```bash
gh workflow run release.yml --repo hlvm-dev/hql -f tag=vX.Y.Z
```

### Rebuild after a fix

```bash
gh release delete vX.Y.Z --repo hlvm-dev/hql --yes
git push origin --delete vX.Y.Z
git tag -d vX.Y.Z
git tag vX.Y.Z
git push origin main vX.Y.Z
```

---

## What Changed From v0.1.0

`v0.1.0` embedded Ollama into the binary. The current pipeline keeps the HLVM
binary lean and moves runtime provisioning to bootstrap.

| Dimension           | v0.1.0 (embedded) | Current pipeline                    |
| ------------------- | ----------------- | ----------------------------------- |
| Binary size         | 587 MB - 5.2 GB   | ~363 MB                             |
| Release assets      | 8.5 GB, 10 files  | ~1.5 GB, 7 files                    |
| File splitting      | Required          | None                                |
| Windows packaging   | Zip + sidecar     | Same binary pattern as other builds |
| Bootstrap work      | Smaller           | Ollama + model + Chromium + Python  |
| First binary fetch  | Huge              | ~363 MB                             |

The main user-facing tradeoff is explicit: the binary stays lean, while
bootstrap performs all heavy lifting up front so `hlvm ask` works immediately
after install.
