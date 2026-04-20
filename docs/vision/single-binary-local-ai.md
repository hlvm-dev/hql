# Self-Bootstrapping Binary — Vision & Ship SSOT

## Goal

One supported public install contract:

```bash
curl -fsSL https://hlvm.dev/install.sh | sh
```

```powershell
irm https://hlvm.dev/install.ps1 | iex
```

After install finishes:

- `hlvm ask "hello"` works immediately
- `/health.aiReady` is true only when the local fallback is actually usable
- there is no post-install surprise download
- users do not need to understand Ollama, Python, `uv`, Chromium, or MCP

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
  5. Installs hlvm
  6. Runs hlvm bootstrap, which:
     a. Downloads pinned Ollama
     b. Places it under ~/.hlvm/.runtime/engine/
     c. Starts it on 127.0.0.1:11439
     d. Detects host memory and selects the pinned qwen3 model tier
     e. Pulls that qwen3 fallback into ~/.hlvm/.runtime/models/
     f. Downloads Chromium into ~/.hlvm/.runtime/chromium/
     g. Installs uv into ~/.hlvm/.runtime/python/uv/
     h. Installs CPython into ~/.hlvm/.runtime/python/cpython/
     i. Creates ~/.hlvm/.runtime/python/venv/
     j. Installs the default Python sidecar pack
     k. Verifies everything and writes manifest.json
  7. Exits only after HLVM is ready

User then runs:
  hlvm ask "hello"

Expected result:
  Works immediately, out of the box.
```

### What The Binary Is

The HLVM binary is a self-bootstrapping single binary. It contains:

- the HLVM runtime
- the Deno runtime
- the HQL standard library
- knowledge of which Ollama, `uv`, CPython, and sidecar package pins to install

It does not contain Ollama, model blobs, Chromium, or a Python distribution.
Those are installed during bootstrap because the model and runtime payloads are
too large and too platform-specific to embed cleanly.

### Installed Result

```text
/usr/local/bin/hlvm                 (or LOCALAPPDATA\HLVM\bin\hlvm.exe)

~/.hlvm/.runtime/
  ├── engine/                       Ollama binary
  ├── models/                       Fallback model store
  ├── chromium/                     Managed browser runtime
  ├── python/
  │   ├── uv/                       HLVM-owned uv binary
  │   ├── cpython/                  uv-managed CPython installs
  │   ├── venv/                     Isolated HLVM Python environment
  │   └── requirements.txt          Pinned Python sidecar pack
  └── manifest.json                 Verified runtime state
```

## Architecture

### Install Flow

```text
curl -fsSL https://hlvm.dev/install.sh | sh
  │
  ├── 1. detect_platform()
  ├── 2. get_latest_version()
  ├── 3. download binary (~363 MB)
  ├── 4. verify checksum
  ├── 5. install hlvm
  └── 6. hlvm bootstrap
         │
         ├── a. Download pinned Ollama from official releases
         ├── b. Start Ollama on 127.0.0.1:11439
         ├── c. Detect host memory and choose qwen3:8b or qwen3:30b
         ├── d. Pull the selected qwen3 fallback
         ├── e. Download Chromium via playwright-core
         ├── f. Install uv 0.11.7 under HLVM-owned storage
         ├── g. Install CPython 3.13.13 under HLVM-owned storage
         ├── h. Create a managed virtualenv
         ├── i. Install the default Python sidecar pack
         ├── j. Verify engine + model + Python sidecar
         ├── k. Write manifest.json
         └── l. Keep Ollama warm for the first request
```

### Key Invariants

1. `hlvm bootstrap` is the single install-time preparation entrypoint.
2. Ollama is downloaded from official releases, not embedded in the binary.
3. The Ollama version is pinned in `embedded-ollama-version.txt`.
4. The Python runtime is HLVM-managed and isolated under `~/.hlvm/.runtime/python/`.
5. The `uv` version is pinned in `embedded-uv-version.txt`.
6. The CPython version is pinned in `embedded-python-version.txt`.
7. The Python sidecar pack is pinned in `embedded-python-sidecar-requirements.txt`.
8. The local fallback tier map is pinned in `embedded-model-tiers.json`.
9. The runtime uses HLVM-owned storage under `~/.hlvm/.runtime/`.
10. Ollama binds to `127.0.0.1:11439`, not `11434`.
11. HLVM runs as one user-level daemon at `~/.hlvm/`. CLI, macOS GUI, and
    channel receivers attach to the same runtime host and share the same
    Ollama. Runtime-host attachment matches by build identity only; the
    caller's state root is not part of the attach contract.
12. `/health.aiReady` is true only after the fallback model is genuinely ready.
13. The installer is not complete until bootstrap has finished successfully.

### Key Source Files

| File                                         | Role                                                         |
| -------------------------------------------- | ------------------------------------------------------------ |
| `src/hlvm/cli/commands/bootstrap.ts`         | Bootstrap orchestration, warmup, readiness probe             |
| `src/hlvm/runtime/bootstrap-materialize.ts`  | Prepare engine, model, browser, Python, and manifest         |
| `src/hlvm/runtime/ai-runtime.ts`             | Ollama download and engine lifecycle                         |
| `src/hlvm/runtime/host-identity.ts`          | Runtime-host identity, including build kind and artifact fingerprint |
| `src/hlvm/runtime/host-client.ts`            | Runtime-host attach/start logic for the single shared daemon |
| `src/hlvm/runtime/chromium-runtime.ts`       | Chromium download and verification                           |
| `src/hlvm/runtime/python-runtime.ts`         | uv install, CPython install, venv creation, sidecar pack     |
| `src/hlvm/runtime/bootstrap-manifest.ts`     | Bootstrap manifest types and read/write                      |
| `src/hlvm/runtime/bootstrap-verify.ts`       | Manifest verification, including Python sidecar verification |
| `embedded-ollama-version.txt`                | Pinned Ollama version                                        |
| `embedded-model-tiers.json`                  | Pinned host-memory → qwen3 tier map                          |
| `embedded-uv-version.txt`                    | Pinned `uv` version                                          |
| `embedded-python-version.txt`                | Pinned CPython version                                       |
| `embedded-python-sidecar-requirements.txt`   | Pinned Python sidecar pack                                   |

## Runtime Manifest

Location: `~/.hlvm/.runtime/manifest.json`

```json
{
  "state": "verified",
  "engine": {
    "adapter": "ollama",
    "path": "/Users/user/.hlvm/.runtime/engine/ollama",
    "hash": "..."
  },
  "models": [
    {
      "modelId": "qwen3:8b",
      "size": 5225387677,
      "hash": "sha256:a3de86cd1c13..."
    }
  ],
  "python": {
    "runtime": "cpython",
    "version": "3.13.13",
    "uvVersion": "0.11.7",
    "uvPath": "/Users/user/.hlvm/.runtime/python/uv/uv",
    "installDir": "/Users/user/.hlvm/.runtime/python/cpython",
    "environmentPath": "/Users/user/.hlvm/.runtime/python/venv",
    "interpreterPath": "/Users/user/.hlvm/.runtime/python/venv/bin/python",
    "hash": "...",
    "requirementsPath": "/Users/user/.hlvm/.runtime/python/requirements.txt",
    "requirementsHash": "...",
    "packages": [
      "pypdf==6.10.2",
      "pdfplumber==0.11.9",
      "python-pptx==1.0.2"
    ]
  },
  "browsers": [
    {
      "browser": "chromium",
      "path": "/Users/user/.hlvm/.runtime/chromium/...",
      "hash": "...",
      "revision": "playwright-core-1.59.1"
    }
  ],
  "buildId": "0.1.0",
  "createdAt": "2026-04-19T00:00:00Z",
  "lastVerifiedAt": "2026-04-19T00:00:00Z"
}
```

States:

| State           | Meaning                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `uninitialized` | No manifest exists                                                         |
| `verified`      | Engine + fallback model + managed Python sidecar are present and verified  |
| `degraded`      | Required bootstrap assets are missing or corrupt                           |

## Current Pins

| Component            | Current Pin |
| -------------------- | ----------- |
| Ollama               | `v0.21.0`   |
| Local fallback tiers | `>=64 GiB -> qwen3:30b`, otherwise `qwen3:8b` |
| `uv`                 | `0.11.7`    |
| CPython              | `3.13.13`   |

Default install policy is conservative on purpose:

- 32 GiB M1 Max stays on `qwen3:8b`
- 64 GiB and larger hosts may auto-upgrade to `qwen3:30b`
- `qwen3:14b` is supported as a manual upgrade, not the default auto-pull
- model digest pins come from the live Ollama registry manifests, not the
  human-facing library detail pages

The default Python sidecar pack currently includes:

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

## CI/CD

See [docs/cicd/release-pipeline.md](/Users/seoksoonjang/dev/hql/docs/cicd/release-pipeline.md:1)
for the concrete release workflow and smoke path.

Release smoke validation must also isolate runtime ownership:

- temp `HLVM_TEST_STATE_ROOT`
- dedicated `HLVM_REPL_PORT`
- no inherited background `hlvm serve` processes
- no fallback-port runtime expansion

## Future

The runtime model selection logic can evolve over time, but the install
contract should not:

- install once
- do all heavy lifting up front
- fail closed if required runtimes are missing
- let `hlvm ask` assume the managed runtime already exists
