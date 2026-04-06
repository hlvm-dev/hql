# Single-Binary Local AI — Vision & Ship SSOT

## Goal

There is one supported public install contract, with platform-specific entry
commands:

```bash
curl -fsSL https://hlvm.dev/install.sh | sh
```

```powershell
irm https://hlvm.dev/install.ps1 | iex
```

That standard install command must:

1. download the correct platform binary from `hlvm-dev/hql`
2. install `hlvm`
3. bootstrap the embedded local AI runtime
4. prepare the default local fallback model `gemma4:e4b`
5. show progress while that work happens
6. return only when HLVM is genuinely ready

After install finishes successfully:

- `hlvm ask "hello"` works immediately
- `/health.aiReady` is true only when the local fallback is actually usable
- there is no post-install "surprise" model download
- users do not need to understand Ollama, model stores, or extra setup steps
- there is no separate public `--full` mode because standard install is already
  the full install

Installed result:

```text
/usr/local/bin/hlvm              (or LOCALAPPDATA\HLVM\bin\hlvm.exe on Windows)
~/.hlvm/.runtime/
  ├── engine
  ├── models/
  └── manifest.json
```

## Product Contract

### Supported Public UX

```text
User runs:
  curl -fsSL https://hlvm.dev/install.sh | sh
  or
  irm https://hlvm.dev/install.ps1 | iex

Installer then:
  - detects platform
  - resolves the latest published release on hlvm-dev/hql
  - downloads the matching binary
  - verifies checksums
  - installs hlvm
  - runs `hlvm bootstrap`
  - shows bootstrap progress, including local AI preparation
  - exits only after Gemma is installed and verified

User then runs:
  hlvm ask "hello"

Expected result:
  Works immediately, out of the box, with Gemma available by default.
```

This standard flow is the complete supported install. There is no separate
public "full" mode, bundle mode, or offline mode for this ship.

### Unsupported Public UX

There is no supported public offline install mode for this ship.

Do not advertise, document, gate, or block release on any alternate
pre-bundled install path. The only supported public experience is the standard
installer, which must finish binary install plus Gemma bootstrap before it
returns.

## Architecture

### Current Target

```text
┌──────────┐
│ HLVM CLI │
│  binary  │
│          │
│ embedded │
│  engine  │──▶ ~/.hlvm/.runtime/
│          │    ├── engine
│ gemma4   │    ├── models/
│ verified │    └── manifest.json
└──────────┘
```

### Key Invariants

1. `hlvm bootstrap` is the single install-time preparation entrypoint.
2. The embedded AI engine uses HLVM-owned storage under `~/.hlvm/.runtime/models/`.
3. The fallback model is `gemma4:e4b`.
4. Bootstrap is adopt-or-pull:
   - if the pinned fallback is already present, adopt it
   - otherwise pull it during bootstrap
5. The embedded runtime binds to `127.0.0.1:11439`, not the system Ollama default.
6. `/health.aiReady` is true only after the fallback is genuinely ready.
7. The installer is not complete until bootstrap has finished successfully.

## Install-Time Contract

### Standard Flow (full install via `install.sh` / `install.ps1`)

```text
1. detect_platform()
2. get_latest_version()
3. download + verify checksum
4. install hlvm to the target bin dir
5. run `hlvm bootstrap`
   ├── extractAIEngine()
   ├── start embedded engine with OLLAMA_MODELS=~/.hlvm/.runtime/models/
   ├── adopt existing pinned gemma4:e4b OR pull it via 127.0.0.1:11439/api/pull
   ├── verify model identity on disk
   ├── hash engine + record authoritative model digest/size
   └── write ~/.hlvm/.runtime/manifest.json
6. print ready message
```

The command must remain one-shot from the user's point of view, even if the
bootstrap step takes time.

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
  "buildId": "0.1.0",
  "createdAt": "2026-04-06T00:00:00Z",
  "lastVerifiedAt": "2026-04-06T00:00:00Z"
}
```

States:

| State | Meaning |
|-------|---------|
| `uninitialized` | No manifest exists |
| `verified` | Engine + fallback model present and verified |
| `degraded` | Some required local AI assets are missing or corrupt |

## What Is Already Proven

### Local Runtime Proof

The following has already been proven locally on the development machine:

1. `hlvm serve` on a clean home reports `/health.aiReady = false`
2. `hlvm bootstrap` extracts the embedded engine and prepares HLVM-owned model storage
3. bootstrap writes a verified manifest under `~/.hlvm/.runtime/manifest.json`
4. `hlvm ask "hello"` works immediately after bootstrap
5. `/health.aiReady = true` only after verified bootstrap
6. `hlvm bootstrap --repair` restores a degraded install
7. GUI bundling is deterministic and uses the SSOT binary from this repo
8. the macOS GUI refuses port conflicts instead of killing a foreign runtime

### Website / Installer Hosting Proof

The following is already fixed and verified:

1. `https://hlvm.dev/install.sh` serves the real shell script
2. `https://hlvm.dev/install.ps1` serves the real PowerShell script
3. both live installer scripts now default to `hlvm-dev/hql`

## Current Public Status

As of `2026-04-06`, this feature is:

```text
LOCALLY COMPLETE: yes
PUBLIC STANDARD SHIP COMPLETE: no (cross-platform staged proof still failing)
PUBLIC OFFLINE SHIP COMPLETE: not in scope
```

### Verified Ground Truth (`2026-04-06`)

- `hlvm-dev/hql` is the only allowed release/install repo target
- `hlvm-dev/hql` is public
- `https://hlvm.dev/install.sh` returns a real standard-only script body
- `https://hlvm.dev/install.ps1` returns a real standard-only script body
- the live installers point to `hlvm-dev/hql`, no `--full` or offline mode
- the only currently published release is still `v0.0.1`
- Release run `24032574642` succeeded: v0.1.0 draft rebuilt from commit
  `4b59039` ("Handle first-run standard install readiness")
- staged proof run `24033026047` completed and produced mixed results:
  - macOS Intel standard smoke passed end to end
  - Linux standard smoke reached `HLVM v0.1.0 is ready!`, then the runner
    received a shutdown signal and exited `143`
  - Windows staged smoke failed before install because the local proof HTTP
    server was not ready when `install.ps1` tried to fetch split assets
  - macOS arm64 staged smoke still failed because the first hosted-runner
    Gemma warm-up did not reach request-ready before bootstrap gave up
- `main` now contains the next proof/installer fixes:
  - `scripts/release-smoke.ps1` waits for the local Windows asset server to
    become reachable and preserves logs on failure
  - `hlvm bootstrap` now waits longer for first-run local Gemma readiness and
    emits periodic warm-up progress while it is still waiting

### Bugs Found and Fixed During Ship

Each staged proof round found a real bug. All are now fixed on `main`:

| Round | Bug | Root Cause | Fix Commit |
|-------|-----|------------|------------|
| 1 | CI flaky (esbuild cache fetch timeout) | Transient network failure | Added `scripts/with-retry.sh` + `fail-fast: false` |
| 2 | Bootstrap said "done" but `hlvm ask` failed with HLVM5006 | Bootstrap declared success before Gemma was actually serving | Added readiness probe in `bootstrap.ts` + `model-access.ts` |
| 3 | Windows "not a valid application" | Binary was 2.18 GB, exceeds PE32+ 2 GB loader limit | Changed Windows asset to `hlvm-windows.zip` (exe + sidecar) |
| 4a | Windows bootstrap crash on first run | Missing `config.json` not recognized as ENOENT on Windows | Fixed `isFileNotFound()` in `utils.ts` |
| 4b | Hosted-runner Gemma warmup still timed out on slower first boots | Bootstrap warmup patience too short | Extended probe retry + added periodic warmup progress |

### What Remains

The next required step is to rerun staged proof from the latest `main`.

If the rerun passes:
1. publish the draft: `gh release edit v0.1.0 --repo hlvm-dev/hql --draft=false`
2. run public smoke: push `proof-public-v0.1.0` tag
3. verify real `curl -fsSL https://hlvm.dev/install.sh | sh` works

If the rerun fails:
1. pull logs, identify the platform-specific failure
2. fix on `main`, retag, rebuild, reproof

## Ship Target

### Release Assets Required

The standard public ship requires these GitHub release assets on
`hlvm-dev/hql`:

- `hlvm-mac-arm`
- `hlvm-mac-intel`
- `hlvm-linux` or `hlvm-linux.part-*`
- `hlvm-windows.zip` or `hlvm-windows.zip.part-*`
- `checksums.sha256`
- `install.sh`
- `install.ps1`

No Hugging Face bundles are required for the current ship target, and no public
offline artifact is part of the release gate.

## Ship Flow

### Standard-Only Release Flow

```text
1. push vX.Y.Z tag
   -> .github/workflows/release.yml
   -> build 4-platform binaries
   -> create DRAFT GitHub release on hlvm-dev/hql

2. run staged smoke against the draft release
   -> macOS arm standard smoke
   -> macOS intel standard smoke
   -> Linux x86_64 standard smoke
   -> Windows x86_64 standard smoke

3. publish the draft release
   -> validate draft assets
   -> validate installer URLs
   -> mark release live

4. run public smoke against the published release
   -> real `curl -fsSL https://hlvm.dev/install.sh | sh`
   -> real `irm https://hlvm.dev/install.ps1 | iex`
   -> `hlvm bootstrap --verify`
   -> `hlvm ask "hello"`
```

## Remaining Work

### Immediate Critical Path

1. wait for staged proof run `24033026047` to complete
2. if it passes: publish `v0.1.0`
3. run public smoke: push `proof-public-v0.1.0` tag
4. verify real `curl -fsSL https://hlvm.dev/install.sh | sh`
5. update this document with final published proof

### Non-Goals For This Ship

- do not add or advertise a public offline install mode
- do not add or advertise a public `--full` mode
- do not block publish on Hugging Face uploads
- do not claim the public ship is complete before standard public smoke passes

## CI/CD Pipeline Reference

Full pipeline documentation with ASCII diagrams is at
[docs/cicd/release-pipeline.md](../cicd/release-pipeline.md).

## Next Owner Checklist

The next person or model taking over should:

1. check staged proof run `24033026047` — if it passed, proceed to publish
2. if it failed, pull logs: `gh run view <id> --repo hlvm-dev/hql --log-failed`
3. publish only after staged standard smoke passes everywhere:
   `gh release edit v0.1.0 --repo hlvm-dev/hql --draft=false`
4. push public proof tag: `git tag proof-public-v0.1.0 && git push origin proof-public-v0.1.0`
5. run manual public smoke to double-check:
   - Unix: `scripts/public-release-smoke.sh standard`
   - Windows: `pwsh -File scripts/release-smoke.ps1 -Mode public -Tag v0.1.0`
6. update this document with the exact publish date, release tag, and proof status

## Canonical Product Contract

The only public contract that matters for this ship is:

```text
curl -fsSL https://hlvm.dev/install.sh | sh
  -> installer downloads the correct binary
  -> installer shows bootstrap progress
  -> installer extracts the embedded Ollama runtime
  -> installer prepares Gemma during install
  -> command returns only when HLVM is ready
  -> hlvm ask works immediately
```
