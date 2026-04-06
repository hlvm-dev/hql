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

Public offline bundle install is not part of the current ship target.

Do not advertise or require:

```bash
curl -fsSL https://hlvm.dev/install.sh | sh -s -- --full
```

Offline packaging work may remain in the repository for future use, but it is
not part of the current release gate and must not block the standard public
ship.

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
- `v0.1.0` is being rebuilt from the corrected repo-target + manifest-discovery code
- standard public install is therefore not complete yet, because `releases/latest` does not yet deliver the intended `v0.1.0`

### Why Public Standard Is Not Done Yet

The remaining work is distribution validation, not core runtime design:

1. the corrected `v0.1.0` draft must finish rebuilding
2. staged smoke must prove the draft release on macOS/Linux/Windows
3. the draft must be published
4. public smoke must prove the real public install path

## Ship Target

### Release Assets Required

The standard public ship requires these GitHub release assets on
`hlvm-dev/hql`:

- `hlvm-mac-arm`
- `hlvm-mac-intel`
- `hlvm-linux` or `hlvm-linux.part-*`
- `hlvm-windows.exe` or `hlvm-windows.exe.part-*`
- `checksums.sha256`
- `install.sh`
- `install.ps1`

No Hugging Face bundles are required for the current ship target.

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

- do not block publish on offline bundles
- do not block publish on Hugging Face uploads
- do not claim the public ship is complete before standard public smoke passes

## Next Owner Checklist

The next person or model taking over should:

1. verify the latest live installer still points to `hlvm-dev/hql`
2. verify the rebuilt `v0.1.0` draft exists and contains the required assets
3. run standard staged smoke:
   - Unix: `scripts/release-smoke.sh standard v0.1.0`
   - Windows: `pwsh -File scripts/release-smoke.ps1 -Mode staged -Tag v0.1.0`
4. publish only after staged standard smoke passes
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
  -> installer prepares Gemma during install
  -> command returns only when HLVM is ready
  -> hlvm ask works immediately
```
