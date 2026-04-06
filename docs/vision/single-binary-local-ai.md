# Single-Binary Local AI — Vision & Ship SSOT

## Goal

There is one supported public install path:

```bash
curl -fsSL https://hlvm.dev/install.sh | sh
```

That single command must:

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

### Standard Flow (`install.sh`)

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
PUBLIC STANDARD SHIP COMPLETE: no
PUBLIC OFFLINE SHIP COMPLETE: not in scope
```

### Verified Ground Truth (`2026-04-06`)

- `hlvm-dev/hql` is the only allowed release/install repo target
- `hlvm-dev/hql` is public
- `https://hlvm.dev/install.sh` returns a real script body
- `https://hlvm.dev/install.ps1` returns a real script body
- the live installers point to `hlvm-dev/hql`
- the only currently published release is still `v0.0.1`
- draft release `v0.1.0` now exists on `hlvm-dev/hql` with the required standard-ship assets
- the draft `install.sh` asset was refreshed from the current standard-only installer on `main`
- the prior staged proof against the old `v0.1.0` draft exposed a real standard-path readiness bug:
  - macOS/Linux bootstrap succeeded, but the first `hlvm ask "hello"` could still fail with `HLVM5006`
  - Windows bootstrap could fail on slow runner startup because the embedded engine timeout was too short
- `main` now contains a readiness hardening patch:
  - `hlvm bootstrap` waits for the default local fallback to answer a probe request before reporting success
  - `/health.aiReady` now stays false until local Gemma is actually usable
  - embedded engine startup timeout is longer for slow hosts, including Windows runners
  - Windows staged smoke now isolates `HLVM_DIR` / home paths and preserves bootstrap error output
- local staged standard smoke now passes on the development Mac against the rebuilt `v0.1.0` draft:
  - live installer URL: `https://hlvm.dev/install.sh`
  - staged command: `scripts/release-smoke.sh standard v0.1.0`
  - result: installer completed bootstrap, `hlvm bootstrap --verify` passed, and `hlvm ask "hello"` returned successfully
- staged cross-platform proof then exposed a Windows-only packaging limit:
  - the staged Windows installer reassembled `hlvm-windows.exe`, checksum verification passed, but Windows rejected the file as an invalid application
  - the failing draft Windows executable was `2,180,868,232` bytes, which exceeds the practical PE32+ image limit
  - `main` now switches Windows standard install to a packaged asset (`hlvm-windows.zip`) that contains a much smaller runnable `hlvm.exe` plus the embedded AI engine sidecar
  - local compile check with `--skip-ai-engine` reduced the Windows executable to `374 MB`, confirming the packaging direction
- standard public install is therefore still not complete yet, because `releases/latest` does not yet deliver the intended `v0.1.0`

### Why Public Standard Is Not Done Yet

The remaining work is distribution validation plus a Windows release rebuild:

1. rebuild the `v0.1.0` draft with the Windows packaged asset format
2. rerun cross-platform staged smoke on macOS/Linux/Windows
3. publish the draft
4. public smoke must prove the real public install path

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

1. wait for the corrected `v0.1.0` release rebuild to finish
2. verify the new draft assets are present on `hlvm-dev/hql`
3. run standard staged smoke only
4. publish `v0.1.0`
5. run standard public smoke only
6. update this document again with the final published proof

### Non-Goals For This Ship

- do not add or advertise a public offline install mode
- do not block publish on Hugging Face uploads
- do not claim the public ship is complete before standard public smoke passes

## Next Owner Checklist

The next person or model taking over should:

1. verify the latest live installer still points to `hlvm-dev/hql`
2. verify the rebuilt `v0.1.0` draft exists and contains the required assets
3. check the current staged proof run status on GitHub Actions and confirm macOS/Linux/Windows all pass
4. publish only after staged standard smoke passes everywhere
5. run standard public smoke:
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
