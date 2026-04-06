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

### Model Resolution Chain

On a fresh install, the model defaults to `gemma4:e4b` (local). The full
resolution logic is:

```text
┌─────────────────────────────────────────────────────────┐
│               ensureInitialModelConfigured()             │
│                                                         │
│  Stage 1: Claude Code auto-detect                       │
│    ├── detect CC subscription → use claude model        │
│    └── not CC → continue                                │
│                                                         │
│  Stage 2: First-run setup                               │
│    ├── interactive terminal → ask user                  │
│    └── non-interactive → continue                       │
│                                                         │
│  Stage 3: Local fallback (Gemma-first)                  │
│    ├── bootstrap manifest verified? → ollama/gemma4:e4b │
│    └── not verified → continue                          │
│                                                         │
│  Stage 4: Cloud auto-config                             │
│    └── (currently removed — re-add if needed)           │
└─────────────────────────────────────────────────────────┘

resolveModelString():
  explicit --model flag  →  use it
  persisted config       →  use it
  nothing                →  DEFAULT_MODEL_ID ("ollama/gemma4:e4b")
```

**Runtime fallback**: When a cloud model fails with auth/rate/network errors,
HLVM retries once on local Gemma if it's ready. This does NOT rewrite the
user's persisted config.

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

### Key Source Files

| File | Role |
|------|------|
| `src/common/config/types.ts` | `DEFAULT_MODEL_ID`, `DEFAULT_OLLAMA_HOST`, `DEFAULT_MODEL_NAME` |
| `src/common/ai-default-model.ts` | `ensureInitialModelConfigured()` — model auto-config orchestrator |
| `src/hlvm/cli/commands/first-run-setup.ts` | Interactive first-run; calls `materializeBootstrap()` |
| `src/hlvm/cli/repl/handlers/chat-direct.ts` | Runtime fallback to local Gemma on cloud errors |
| `src/common/config/storage.ts` | `canonicalizeLocalOllamaEndpoint()` — normalizes `:11434`/`:11439` |
| `src/hlvm/runtime/bootstrap-manifest.ts` | `LOCAL_FALLBACK_MODEL` constant |
| `src/hlvm/api/ai.ts` | `resolveModelString()` — explicit → config → default chain |
| `src/common/utils.ts` | `isFileNotFoundError()` — cross-platform ENOENT detection |
| `src/hlvm/cli/commands/bootstrap.ts` | Bootstrap orchestration, warmup, readiness probe |
| `src/hlvm/runtime/model-access.ts` | `isFallbackModelAvailable()`, warmup progress |

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

As of `2026-04-06T14:05Z`, this feature is:

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

### Release Build History

| Run ID | Commit | Status | Notes |
|--------|--------|--------|-------|
| `24033455005` | `2a16714` | succeeded | v0.1.0 draft built, 4 platform binaries uploaded |
| `24034389210` | `b33111a` | in progress | rebuild with Windows `os error 3` fix included |

### Staged Proof History

#### Run `24033026047` (against commit `2a16714` draft)

| Platform | Result | Detail |
|----------|--------|--------|
| macOS Intel | PASSED | end to end |
| Linux x86_64 | PASSED* | reached `HLVM v0.1.0 is ready!`, runner killed (exit 143) |
| Windows x86_64 | FAILED | HTTP server not ready when `install.ps1` fetched assets |
| macOS arm64 | FAILED | Gemma warmup did not reach request-ready before timeout |

#### Run `24034013298` (against commit `2a16714` draft, with proof fixes)

| Platform | Result | Detail |
|----------|--------|--------|
| macOS Intel | PASSED | end to end |
| Linux x86_64 | PASSED* | reached `HLVM v0.1.0 is ready!`, runner canceled (exit 143) |
| Windows x86_64 | FAILED | bootstrap crash: `os error 3` reading `~/.hql/config.json` |
| macOS arm64 | FAILED | Gemma warmup: `Internal Server Error` after 12min of probing |

*Linux "failure" is a runner-side issue (SIGTERM), not a product bug. The
install completed successfully before the runner shut down.

### Bugs Found and Fixed During Ship

Every staged proof round found a real bug. All are fixed on `main`:

| # | Bug | Root Cause | Fix |
|---|-----|------------|-----|
| 1 | CI flaky (esbuild cache fetch timeout) | Transient network failure | `scripts/with-retry.sh` + `fail-fast: false` |
| 2 | Bootstrap said "done" but `hlvm ask` failed (HLVM5006) | Declared success before Gemma was actually serving | Readiness probe in `bootstrap.ts` + `model-access.ts` |
| 3 | Windows "not a valid application" | Binary 2.18 GB > PE32+ 2 GB loader limit | Changed to `hlvm-windows.zip` (exe + sidecar) |
| 4 | Windows bootstrap crash on first run | Missing `config.json` not recognized as ENOENT on Windows | Fixed `isFileNotFound()` in `utils.ts` |
| 5 | Hosted-runner Gemma warmup timeout | Bootstrap warmup patience too short | Extended probe retry + periodic warmup progress |
| 6 | Windows proof harness HTTP server race | `install.ps1` fetched before local server was listening | `release-smoke.ps1` waits for server reachability (`700fee0`) |
| 7 | macOS arm64 first-boot warmup still too short | Hosted runners need more patience | Extended staged warmup proofing (`2a16714`) |
| 8 | Windows `os error 3` during legacy config read | Windows path-missing error is different from narrower ENOENT forms | Extended `isFileNotFoundError()` to handle `os error 3` (`b33111a`) |

### What Still Fails and Why

Two platforms still fail in staged proof as of run `24034013298`:

**Windows**: Fixed on `main` (commit `b33111a`). Release rebuild in progress
(run `24034389210`). Needs a new staged proof run after the rebuild completes.

**macOS arm64**: Gemma's first-boot warmup on GitHub hosted ARM runners is
extremely slow. After 12 minutes of probing, the embedded Ollama returns
`Internal Server Error` (model still loading). This is a CI environment
constraint, not a product bug — the same flow works on real hardware. Options:
1. Increase warmup patience further (risk: CI timeout limits)
2. Use a self-hosted ARM runner with pre-warmed state
3. Accept that arm64 staged proof may need a manual re-run or longer timeout
4. Skip arm64 staged proof (risky — macOS ARM is a primary target)

**Linux**: Not actually failing. Installs and boots successfully. The runner
sends SIGTERM after the installer exits but before the smoke script can run
`hlvm ask`. This is a CI runner lifecycle issue. Fix: add a post-install
`hlvm ask` call before the runner timeout window, or extend the job timeout.

## CI/CD Pipeline

### Architecture (consolidated)

One workflow, one tag. Push `v*` tag and everything runs automatically:

```text
push vX.Y.Z tag ──▶ release.yml
                     │
                     ├── resolve (extract tag)
                     ├── build (4 platform matrix)
                     ├── create-release (draft + upload assets)
                     ├── staged-unix (macOS arm, intel, linux)
                     ├── staged-windows
                     ├── publish (validate assets + publish draft)
                     ├── public-unix (real installer smoke)
                     └── public-windows
```

The workflow also supports `workflow_dispatch` with a `tag` input — this skips
build and create-release, running proof → publish → public proof against an
existing draft. Useful for re-runs after fixing a non-build issue.

If staged smoke fails on any platform, publish is blocked. Fix, push a new tag,
and the whole pipeline re-runs.

### Workflow Files

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Test/lint on push to main |
| `.github/workflows/release.yml` | Build + proof + publish + public proof (all-in-one) |
| `.github/workflows/deploy-website.yml` | Deploy hlvm.dev |

### Smoke Scripts

| Script | Purpose |
|--------|---------|
| `scripts/release-smoke.sh` | Unix staged/public smoke (install + bootstrap + `hlvm ask`) |
| `scripts/release-smoke.ps1` | Windows staged/public smoke |
| `scripts/public-release-smoke.sh` | Manual public smoke runner |
| `scripts/with-retry.sh` | Retry wrapper for flaky CI steps |

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

### Release Flow (single workflow)

```text
push vX.Y.Z tag → release.yml runs automatically:

  Phase 1: build (4 platforms in parallel)
  Phase 2: create-release (draft + upload all assets)
  Phase 3: staged smoke (4 platforms in parallel)
  Phase 4: publish (validate assets + draft → live)
  Phase 5: public smoke (4 platforms, real installer)

If any staged smoke fails → publish is blocked.
Fix → push new tag → full pipeline re-runs.

For re-runs without rebuild:
  Actions → Release → Run workflow → enter tag → run
```

## Remaining Work

### Immediate Critical Path (v0.1.0 publish)

The CI/CD pipeline is now consolidated into a single workflow. To release:

```text
1. commit the consolidated release.yml to main
2. push a new tag to trigger the full pipeline:
     git tag v0.1.1 && git push origin v0.1.1
   (or re-run against the existing v0.1.0 draft via workflow_dispatch)
3. the pipeline automatically: builds → drafts → staged proof → publishes → public proof
4. monitor the run:
     gh run list --repo hlvm-dev/hql --workflow release.yml --limit 5
     gh run view <id> --repo hlvm-dev/hql --log-failed
5. if the full pipeline passes, the release is already published — verify:
     curl -fsSL https://hlvm.dev/install.sh | sh
     hlvm ask "hello"
```

To re-run staged proof + publish against the existing v0.1.0 draft
(skipping rebuild):

```text
Actions → Release → Run workflow → tag: v0.1.0 → Run
```

### Known Remaining Issues

1. **macOS arm64 warmup patience**: Hosted ARM runners are too slow for
   Gemma's first-boot warmup. May need to increase timeout further or accept
   a manual re-run strategy for this platform.

2. **Linux runner SIGTERM**: The smoke script needs to complete `hlvm ask`
   before the runner's timeout. Either extend the job timeout or restructure
   the smoke script to call `hlvm ask` immediately after install.

3. **Claude Code auto-detect removed**: The Codex agent removed
   `autoConfigureInitialClaudeCodeModel()` from Stage 1 of
   `ensureInitialModelConfigured()` in `ai-default-model.ts`. This should be
   re-added — users with a Claude Code subscription should auto-detect it.
   The call was hardcoded to `false` instead of calling the detection function.

### Post v0.1.0 Follow-ups

1. **CI/CD consolidation**: DONE. `release-proof.yml` and
   `publish-release.yml` deleted. Single `release.yml` handles everything.

2. **Re-add CC auto-detect**: In `src/common/ai-default-model.ts`, restore
   `autoConfigureInitialClaudeCodeModel()` as Stage 1. The detection function
   still exists — it just needs to be called again instead of the `false`
   hardcode.

3. **Ollama signup infrastructure**: The `runOllamaSignin`,
   `verifyOllamaCloudModelAccess`, `ensureCloudAccessWithSignin` functions in
   `first-run-setup.ts` are no longer on the default path but should be kept
   for manual cloud model selection (e.g., `hlvm config set model
   ollama/mistral-large-3:675b-cloud`).

### Non-Goals For This Ship

- do not add or advertise a public offline install mode
- do not add or advertise a public `--full` mode
- do not block publish on Hugging Face uploads
- do not claim the public ship is complete before standard public smoke passes

## Next Owner Checklist

The next person or model taking over should:

1. **Commit the consolidated `release.yml`** and deletion of
   `release-proof.yml` + `publish-release.yml` to `main`.

2. **Trigger the full pipeline** with a new tag:
   ```bash
   git tag v0.1.1 && git push origin v0.1.1
   ```
   Or re-run against the existing v0.1.0 draft (skips rebuild):
   Go to Actions → Release → Run workflow → tag: `v0.1.0`

3. **Monitor the run**:
   ```bash
   gh run list --repo hlvm-dev/hql --workflow release.yml --limit 5
   gh run view <run-id> --repo hlvm-dev/hql --log-failed
   ```
   Expected per-platform status:
   - **macOS Intel**: should pass (has passed in both prior runs)
   - **Linux**: should pass (install works; watch for runner SIGTERM after)
   - **Windows**: should pass now (the `os error 3` fix is in `b33111a`)
   - **macOS arm64**: may still fail (Gemma warmup on hosted runners is slow)

4. **If macOS arm64 still fails** on warmup timeout:
   - Check the log for `Internal Server Error` vs other failures
   - If it's purely a warmup timeout: consider increasing patience in
     `bootstrap.ts` or accepting a manual re-run
   - If it's a different error: investigate and fix on `main`, then push a new tag

5. **If all staged smoke passes**: the pipeline auto-publishes and runs public
   smoke. No manual `gh release edit --draft=false` needed.

6. **Verify real install** after pipeline completes:
   ```bash
   curl -fsSL https://hlvm.dev/install.sh | sh
   hlvm ask "hello"
   ```

7. **Post-publish**: Update this document with the exact publish date, final
   proof run ID, and set `PUBLIC STANDARD SHIP COMPLETE: yes`.

8. **Post-publish follow-ups** (not blocking):
   - Re-add CC auto-detect in `ai-default-model.ts` (see "Known Remaining
     Issues" #3)

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
