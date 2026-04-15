# Self-Bootstrapping Binary — Vision & Ship SSOT

## Goal

One supported public install contract, with platform-specific entry commands:

```bash
curl -fsSL https://hlvm.dev/install.sh | sh
```

```powershell
irm https://hlvm.dev/install.ps1 | iex
```

After install finishes:

- `hlvm ask "hello"` works immediately
- `/health.aiReady` is true only when the local fallback is actually usable
- there is no post-install "surprise" model download
- users do not need to understand Ollama, model stores, or extra setup steps

## Product Contract

### What The User Sees

```text
User runs:
  curl -fsSL https://hlvm.dev/install.sh | sh

Installer then:
  1. Detects platform
  2. Resolves the latest published release on hlvm-dev/hql
  3. Downloads the HLVM binary (~363 MB)
  4. Verifies checksum
  5. Installs hlvm to /usr/local/bin/
  6. Runs hlvm bootstrap, which:
     a. Downloads pinned Ollama from github.com/ollama/ollama/releases
     b. Places Ollama under ~/.hlvm/.runtime/engine/
     c. Starts Ollama on localhost:11439
     d. Pulls default local model (gemma4:e4b)
     e. Downloads Chromium (~200 MB)
     f. Verifies everything works
     g. Writes manifest
  7. Exits only after HLVM is ready

User then runs:
  hlvm ask "hello"

Expected result:
  Works immediately, out of the box.
```

### What The Binary Is

The HLVM binary is a **self-bootstrapping single binary**. It contains:

- The HLVM runtime (CLI, agent, orchestrator, MCP, HQL transpiler)
- The Deno runtime (V8 engine, TypeScript compiler)
- The HQL standard library
- Knowledge of which Ollama version and model to download

It does NOT contain Ollama or the model. These are downloaded at bootstrap time
because:

- The model alone is 9.6 GB — no binary format supports embedding it
- Ollama for Linux with GPU libraries is 4+ GB — embedding would make the binary
  5+ GB
- Windows PE32+ has a hard 2 GB executable size limit
- A 363 MB binary downloads quickly; a 5 GB binary takes much longer

This is the same pattern used by Rustup, Go, and Homebrew: a small binary that
sets itself up on first run.

### Installed Result

```text
/usr/local/bin/hlvm                 (or LOCALAPPDATA\HLVM\bin\hlvm.exe)

~/.hlvm/.runtime/
  ├── engine/                       Ollama binary (downloaded at bootstrap)
  ├── models/                       Model files (pulled at bootstrap)
  ├── chromium/                     Chromium binary (downloaded at bootstrap)
  └── manifest.json                 Verified runtime state
```

## Architecture

### Install Flow

```text
curl -fsSL https://hlvm.dev/install.sh | sh
  │
  ├── 1. detect_platform()
  │      uname -s/-m → darwin_aarch64, darwin_x86_64, linux_x86_64
  │
  ├── 2. get_latest_version()
  │      GET api.github.com/repos/hlvm-dev/hql/releases/latest
  │
  ├── 3. download binary (~363 MB)
  │      From GitHub Releases: hlvm-dev/hql/releases/download/vX.Y.Z/hlvm-<platform>
  │
  ├── 4. verify checksum
  │      SHA-256 from checksums.sha256 in the release
  │
  ├── 5. install to /usr/local/bin/hlvm
  │
  └── 6. hlvm bootstrap
         │
         ├── a. Download pinned Ollama
         │      Version from embedded-ollama-version.txt (baked in at compile)
         │      From github.com/ollama/ollama/releases/download/<version>/
         │        macOS:   ollama-darwin.tgz
         │        Linux:   ollama-linux-amd64.tgz (Ollama auto-downloads GPU libs)
         │        Windows: ollama-windows-amd64.zip
         │      Extract to ~/.hlvm/.runtime/engine/
         │
         ├── b. Start Ollama on 127.0.0.1:11439
         │      OLLAMA_HOST=127.0.0.1:11439
         │      OLLAMA_MODELS=~/.hlvm/.runtime/models/
         │
         ├── c. Pull default model
         │      POST /api/pull { name: "gemma4:e4b", stream: true }
         │      ~9.6 GB download with progress
         │
         ├── d. Verify model readiness
         │      Send test request, confirm model loads and responds
         │
         ├── e. Download Chromium (~200 MB)
         │      Via playwright-core CDN
         │
         ├── f. Write manifest.json
         │      { "state": "verified", engine: {...}, models: [...] }
         │
         └── g. Keep Ollama running (warm model in RAM for first hlvm ask)
```

### Model Resolution Chain

```text
resolveModelString():
  explicit --model flag  →  use it
  persisted config       →  use it
  nothing                →  DEFAULT_MODEL_ID ("ollama/gemma4:e4b")
```

### Key Invariants

1. `hlvm bootstrap` is the single install-time preparation entrypoint.
2. Ollama is downloaded from official releases, not embedded in the binary.
3. The Ollama version is pinned in `embedded-ollama-version.txt` (baked into the
   binary at compile time).
4. The runtime uses HLVM-owned storage under `~/.hlvm/.runtime/`.
5. Ollama binds to `127.0.0.1:11439`, not the system Ollama default (11434).
6. `/health.aiReady` is true only after the fallback model is genuinely ready.
7. The installer is not complete until bootstrap has finished successfully.
8. Chromium is downloaded during bootstrap for `pw_*` browser tools.

### Key Source Files

| File                                        | Role                                                            |
| ------------------------------------------- | --------------------------------------------------------------- |
| `src/common/config/types.ts`                | `DEFAULT_MODEL_ID`, `DEFAULT_OLLAMA_HOST`                       |
| `src/hlvm/cli/commands/bootstrap.ts`        | Bootstrap orchestration, warmup, readiness probe                |
| `src/hlvm/runtime/bootstrap-materialize.ts` | Download Ollama, pull model, hash, write manifest               |
| `src/hlvm/runtime/ai-runtime.ts`            | Ollama download, engine lifecycle, environment setup             |
| `src/hlvm/runtime/bootstrap-manifest.ts`    | `LOCAL_FALLBACK_MODEL` constant, manifest read/write            |
| `src/hlvm/runtime/model-access.ts`          | `isFallbackModelAvailable()`, warmup progress                   |
| `src/hlvm/runtime/chromium-runtime.ts`      | Chromium download, extraction, verification                     |
| `src/hlvm/api/ai.ts`                        | `resolveModelString()` — explicit → config → default chain      |
| `src/common/ai-default-model.ts`            | `ensureInitialModelConfigured()` — model auto-config            |
| `embedded-ollama-version.txt`               | Pinned Ollama version (SSOT, baked into binary at compile time) |

## Runtime Manifest

Location: `~/.hlvm/.runtime/manifest.json`

```json
{
  "state": "verified",
  "engine": {
    "adapter": "ollama",
    "path": "/Users/user/.hlvm/.runtime/engine",
    "hash": "sha256:..."
  },
  "models": [{
    "modelId": "gemma4:e4b",
    "size": 9600000000,
    "hash": "sha256:..."
  }],
  "browsers": [{
    "browser": "chromium",
    "path": "/Users/user/.hlvm/.runtime/chromium",
    "hash": "sha256:...",
    "revision": "playwright-core-1.52.0"
  }],
  "buildId": "0.2.0",
  "createdAt": "2026-04-15T00:00:00Z",
  "lastVerifiedAt": "2026-04-15T00:00:00Z"
}
```

States:

| State           | Meaning                                                         |
| --------------- | --------------------------------------------------------------- |
| `uninitialized` | No manifest exists                                              |
| `verified`      | Engine + fallback model + Chromium present and verified          |
| `degraded`      | Some assets missing/corrupt (Chromium missing = CU-only mode)   |

## Ollama Version Pinning

The Ollama version is pinned in `embedded-ollama-version.txt` at the repo root.
This file is baked into the binary at compile time via `deno compile --include`.
At bootstrap, the binary reads this file to know which Ollama version to
download.

**Current version**: `v0.20.1`

**Why not v0.20.2**: Ollama v0.20.2 has an upstream packaging bug where the
server binary reports as v0.19.0, causing HTTP 412 when pulling models. v0.20.1
works correctly.

## CI/CD Pipeline

See `docs/cicd/release-pipeline.md` for the complete pipeline documentation.

```text
git tag vX.Y.Z && git push origin vX.Y.Z
  → resolve → build (4 platforms) → create draft release
  → staged smoke (4 platforms) → publish → public smoke
```

All platforms build identically: `deno compile` → ~363 MB binary. No embedding,
no splitting, no Windows special cases.

## Platform Differences

From the user's perspective, all platforms are identical: one install command,
wait, `hlvm ask "hello"` works.

From the CI/CD perspective, all platforms build identically. The only difference
is which Ollama archive is downloaded at bootstrap:

| Platform    | Binary       | Size    | Ollama Archive at Bootstrap  |
| ----------- | ------------ | ------- | ---------------------------- |
| macOS ARM   | hlvm-mac-arm | ~363 MB | ollama-darwin.tgz            |
| macOS Intel | hlvm-mac-intel | ~363 MB | ollama-darwin.tgz          |
| Linux x64   | hlvm-linux   | ~363 MB | ollama-linux-amd64.tgz       |
| Windows x64 | hlvm-windows.exe | ~363 MB | ollama-windows-amd64.zip |

## Future: Model Auto-Select

Bootstrap will detect available RAM and pick the best model:

```text
RAM >= 16 GB  →  gemma4:12b  (9.6 GB, best quality)
RAM >= 8 GB   →  gemma3:4b   (2.5 GB, good)
RAM < 8 GB    →  gemma3:1b   (680 MB, fast)
```

This reduces install time from ~30 min to ~2 min for most users. Users can
upgrade with `hlvm pull <model>` after install.
