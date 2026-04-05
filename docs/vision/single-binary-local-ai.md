# Single-Binary Local AI — Vision & Spec

## Goal

Two first-class install modes. Both one command. Both ready on completion.

```
STANDARD:    curl -fsSL https://hlvm.dev/install.sh | sh
OFFLINE:     curl -fsSL https://hlvm.dev/install.sh | sh -s -- --full
```

After either install finishes successfully:

- `hlvm ask "hello"` works immediately
- `/health.aiReady` is true only when the local fallback is genuinely usable
- there is no first-run model download surprise

Installed result:

```text
/usr/local/bin/hlvm              (or LOCALAPPDATA\\HLVM\\bin\\hlvm.exe on Windows)
~/.hlvm/.runtime/
  ├── engine
  ├── models/
  └── manifest.json
```

## Architecture

### Current → Target

```
BEFORE                              AFTER
──────                              ─────
┌──────────┐                        ┌──────────┐
│ HLVM CLI │                        │ HLVM CLI │
│  binary  │                        │  binary  │
│          │                        │          │
│ embedded │   system Ollama        │ embedded │    ~/.hlvm/.runtime/
│  engine  │──▶ default store       │  engine  │──▶ models/ (HLVM-owned)
│          │   (~/.ollama/)         │          │    manifest.json
│ no model │                        │ gemma4   │
│ guarantee│                        │ verified │
└──────────┘                        └──────────┘
```

### Key Invariants

1. **OLLAMA_MODELS override** — `startAIEngine()` sets `OLLAMA_MODELS` to `~/.hlvm/.runtime/models/`. The embedded engine uses HLVM-owned storage.
2. **Pinned fallback identity** — `gemma4:e4b` is pinned by Ollama manifest digest prefix `c6eb396dbd59` and a published 9.6GB size sanity bound.
3. **Adopt-or-pull bootstrap** — `hlvm bootstrap` first checks whether the pinned model is already present locally, then pulls only when needed.
4. **HLVM-owned local endpoint** — the embedded Ollama runtime binds to `127.0.0.1:11439`, not the system default `11434`, so bootstrap and runtime traffic never depend on a separate system Ollama process.
5. **Local fallback as last resort** — added after Claude Code → Ollama Cloud chain in `ensureInitialModelConfigured()`.
6. **Installer calls `hlvm bootstrap`** — the binary itself handles all AI preparation.
7. **No build-id model subdirectories** — the model store stays at `~/.hlvm/.runtime/models/`; the manifest tracks what is verified there.

## Install-Time Bootstrap Contract

### Standard Flow (`install.sh`)

```
1. detect_platform()
2. get_latest_version()
3. download + verify checksum
4. install to /usr/local/bin/hlvm
5. hlvm bootstrap
   ├── extractAIEngine()
   ├── start engine with OLLAMA_MODELS=~/.hlvm/.runtime/models/
   ├── adopt existing pinned gemma4:e4b OR pull it via 127.0.0.1:11439/api/pull
   ├── hash engine + read Ollama manifest digest/size
   └── write manifest.json
6. "Ready!"
```

### Offline Flow (`install.sh --full`)

```
1. detect_platform()
2. download offline bundle from HuggingFace
3. extract binary + models/
4. install binary to /usr/local/bin/hlvm
5. copy models/ to ~/.hlvm/.runtime/models/
6. hlvm bootstrap
   ├── extractAIEngine()
   ├── start engine with OLLAMA_MODELS=~/.hlvm/.runtime/models/
   ├── detect pinned gemma4:e4b already present locally
   ├── skip /api/pull entirely
   └── write manifest.json with machine-correct engine path
7. "Ready!"
```

## Bootstrap Manifest

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
    "hash": "sha256:c6eb396dbd59..."
  }],
  "buildId": "0.0.1",
  "createdAt": "2026-04-05T12:00:00Z",
  "lastVerifiedAt": "2026-04-05T12:00:00Z"
}
```

### States

| State | Meaning |
|-------|---------|
| `uninitialized` | No manifest exists |
| `verified` | Engine + model present and hashes match |
| `degraded` | Some assets missing or corrupt |

## CLI Commands

```bash
hlvm bootstrap              # Full materialization
hlvm bootstrap --verify     # Check integrity
hlvm bootstrap --repair     # Re-materialize missing assets
hlvm bootstrap --status     # Print manifest as JSON
```

## Files

### New
- `src/hlvm/runtime/bootstrap-manifest.ts` — Types, constants, manifest I/O
- `src/hlvm/runtime/bootstrap-verify.ts` — Verification logic
- `src/hlvm/runtime/bootstrap-materialize.ts` — Model pull + hashing
- `src/hlvm/runtime/bootstrap-recovery.ts` — Repair logic
- `src/hlvm/cli/commands/bootstrap.ts` — CLI command
- `install.sh` — macOS/Linux installer
- `install.ps1` — Windows installer
- `scripts/package-offline-bundle.ts` — Offline bundle packaging
- `.github/workflows/offline-bundle.yml` — CI for offline bundles

### Modified
- `src/common/paths.ts` — `getModelsDir()`, `ensureModelsDir()`
- `src/common/error-codes.ts` — Bootstrap error codes 5020-5024
- `src/hlvm/runtime/ai-runtime.ts` — `OLLAMA_MODELS` env in `startAIEngine()`
- `src/hlvm/cli/cli.ts` — `bootstrap` command registration
- `src/hlvm/cli/commands/serve.ts` — Bootstrap verification in readiness
- `src/common/ai-default-model.ts` — Local fallback model resolution
- `.github/workflows/release.yml` — Embed engine, add install scripts
- `Makefile` — Download engine from official URLs

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Ollama as adapter, not contract | Future engines (llama.cpp, etc.) can be swapped via `adapter` field |
| `gemma4:e4b` as default | Strong enough local fallback quality while still fitting the one-shot install story |
| Fallback is pinned by digest prefix | Prevents silent drift when the upstream tag changes |
| Published size is a sanity bound | Ollama exposes the public size as 9.6GB; digest is the strict identity check |
| Adopt-or-pull bootstrap | Makes the offline bundle truly offline after download while preserving one shared bootstrap path |
| Bootstrap is idempotent | Re-running `hlvm bootstrap` is always safe |
| Recovery does full re-materialize | Partial recovery adds complexity for marginal benefit |
| Embedded Ollama version is file-backed SSOT | `embedded-ollama-version.txt` feeds both Makefile and GitHub Actions |

## Progress

- [x] Phase 1: Docs, SSOT, Contracts
- [x] Phase 2: Core Bootstrap Substrate
- [x] Phase 3: Standard Install Path
- [x] Phase 4: Full Offline Path
- [x] Phase 5: Landing, Releases, Recovery

Verification snapshot:

- [x] `deno task ssot:check`
- [x] targeted `deno check` on bootstrap/install surfaces
- [x] `sh -n install.sh`
- [x] clean-home standard bootstrap with the current built binary
- [x] `hlvm ask "hello"` works immediately after standard bootstrap
- [x] `/health.aiReady` is false before bootstrap and true after verified bootstrap
- [x] locally built full offline bundle extracted on a clean home
- [x] `hlvm ask "hello"` works immediately after offline bootstrap
- [x] `hlvm bootstrap --repair` restores a degraded install to verified

Release-hosting note:

- [ ] Published GitHub Release / Hugging Face URLs exercised after release publication

Ship-finish plumbing:

- [x] `install.sh` supports internal release-staging overrides for binary/checksum/bundle sources
- [x] `install.ps1` supports internal release-staging overrides for binary/checksum sources
- [x] website deploy copies repo-root `install.sh` and `install.ps1` into `website/out/`
- [x] `hlvm.dev/install.sh` and `hlvm.dev/install.ps1` are now treated as deploy artifacts, not GitHub-only URLs
- [x] GitHub release flow creates a **draft** release first
- [x] offline bundle publishing is a separate manual workflow that packages from the staged draft tag
- [x] explicit publish workflow validates installer URLs + bundle URLs before publishing the draft release
- [x] operator smoke helper exists at `scripts/release-smoke.sh`
- [ ] Public release smoke completed against published artifacts

## Current Handoff Status

As of `2026-04-05`, this feature is **complete in code** and **locally end-to-end proven** on the development machine.

Mission status:

- **Completed locally**
  - standard bootstrap path
  - local fallback ownership under `~/.hlvm/.runtime`
  - truthful readiness semantics
  - offline bundle path
  - repair path
- **Not yet exercised publicly**
  - published GitHub Release asset download/install
  - published Hugging Face offline bundle download/install

This is the current authoritative summary for any future LLM or engineer taking over the work.

### What Was Proven Locally

The following runtime proofs were completed with the current built binary:

1. **Clean-home readiness before bootstrap**
   - `hlvm serve` on a fresh home reports `/health.aiReady = false`
2. **Standard bootstrap**
   - `hlvm bootstrap` extracts the embedded engine into `~/.hlvm/.runtime/engine`
   - the embedded Ollama runtime uses the HLVM-owned endpoint `127.0.0.1:11439`
   - the fallback model is stored in `~/.hlvm/.runtime/models`
   - `~/.hlvm/.runtime/manifest.json` is written in `state: "verified"`
3. **Immediate post-bootstrap usage**
   - `hlvm ask "hello"` works immediately after bootstrap on a clean home
4. **Readiness truthfulness**
   - `/health.aiReady = false` before bootstrap
   - `/health.aiReady = true` after verified bootstrap
5. **Offline bundle**
   - a real offline bundle was built locally
   - that bundle was extracted into a new clean home
   - `hlvm bootstrap`, `hlvm bootstrap --verify`, and `hlvm ask "hello"` all succeeded there
6. **Repair**
   - after deleting the extracted engine from the verified offline home
   - `hlvm bootstrap --repair` restored the install
   - `hlvm bootstrap --verify` returned success again
   - `hlvm ask "hello"` worked again

### Important Scope Boundary

This feature should now be considered:

```text
LOCALLY COMPLETE: yes
PUBLICLY PUBLISHED + PUBLIC URL SMOKED: not yet
```

The remaining work is release/distribution validation, not core feature implementation.

### Ship Validation Flow

The current ship sequence is now:

```text
1. push vX.Y.Z tag
   -> .github/workflows/release.yml
   -> build binaries
   -> create DRAFT GitHub release

2. run .github/workflows/offline-bundle.yml with the same tag
   -> download staged draft binary
   -> package offline bundles
   -> upload bundles to Hugging Face

3. deploy website
   -> website/out/install.sh
   -> website/out/install.ps1
   -> hlvm.dev/install.sh
   -> hlvm.dev/install.ps1

4. smoke staged assets
   -> scripts/release-smoke.sh standard vX.Y.Z
   -> scripts/release-smoke.sh offline vX.Y.Z

5. run .github/workflows/publish-release.yml with the same tag
   -> validate installer URLs
   -> validate Hugging Face bundle URLs
   -> publish the draft release
```

Operational boundary:

- The feature remains **locally proven** already.
- The remaining work is now strictly **distribution/publication** work.
- Do not mark the public-proof checkbox complete until the staged smoke and publish sequence above has been exercised on real release artifacts.

### Known Operational Notes

- The HLVM-owned fallback runtime is isolated on `127.0.0.1:11439`.
- System Ollama remains separate on the default `11434` endpoint.
- On this macOS environment, direct `ollama --help` / `ollama --version` probing was not a safe validity check for the embedded runtime because the MLX path can crash before printing stable help/version output.
- The runtime-safe proof is:
  - extract engine
  - start engine
  - verify endpoint readiness
  - verify bootstrap manifest

### Next Owner Checklist

The next person or model taking over should treat the feature as implemented and focus on ship validation:

- publish GitHub Release binaries
- publish the Hugging Face offline bundle
- run one public standard install smoke:
  - `curl -fsSL https://hlvm.dev/install.sh | sh`
- run one public offline install smoke:
  - `curl -fsSL https://hlvm.dev/install.sh | sh -s -- --full`
- confirm README / landing / release notes match the published artifact reality

### Canonical Product Contract

The expected user-facing experience remains:

```text
STANDARD
curl -fsSL https://hlvm.dev/install.sh | sh
  -> installer downloads binary
  -> installer prepares local AI during install
  -> hlvm ask works immediately after install

FULL OFFLINE
curl -fsSL https://hlvm.dev/install.sh | sh -s -- --full
  -> installer downloads offline bundle
  -> installer adopts preloaded local fallback
  -> hlvm ask works immediately offline
```
