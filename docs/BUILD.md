# Building HLVM from Source

Complete guide to building HLVM binaries.

## Prerequisites

### Required

- **Deno** 1.40+ ([install](https://deno.land/))
- **Git**

### macOS Native Builds

HLVM uses `deno compile` to build the native `hlvm` binary. On macOS, that
goes through Apple's native toolchain, so `make build`, `make repl`, `make test`,
and the platform build targets may require Command Line Tools and an accepted
Xcode/Apple SDK license first.

### Optional

- **Make** (for build commands)

## Quick Start REPL

Build the native binary and launch the REPL:

```bash
make repl
```

This compiles `./hlvm` first, then launches its REPL.

## Quick Build

Build for your current platform:

```bash
make build
```

This creates `./hlvm` binary.

Verify:

```bash
./hlvm --version
```

This binary is now the SSOT build artifact for both:

- standalone CLI/runtime use
- the macOS GUI wrapper at `~/dev/HLVM`, which copies this exact binary into `HLVM/Resources/hlvm`

## Build Commands

### Build for Current Platform

```bash
make build
```

Output: `./hlvm`

### Build and Test

```bash
make test
```

Builds binary and runs smoke tests.

### Start REPL

```bash
make repl
```

Builds the native `hlvm` binary and launches its REPL.

### Start Ink REPL

```bash
make ink
```

Builds the native `hlvm` binary and launches the Ink REPL.

### Install System-Wide

```bash
make install
```

Installs to `/usr/local/bin/hlvm`.

Then use anywhere:

```bash
hlvm --version
```

## Cross-Platform Builds

### Build for macOS

Intel:

```bash
make build-mac-intel
```

Output: `hlvm-mac-intel`

Apple Silicon:

```bash
make build-mac-arm
```

Output: `hlvm-mac-arm`

### Build for Linux

```bash
make build-linux
```

Output: `hlvm-linux`

### Build for Windows

```bash
make build-windows
```

Output: `hlvm-windows.exe`

### Build All Platforms

```bash
make all
```

Creates all binaries:

- `hlvm-mac-intel`
- `hlvm-mac-arm`
- `hlvm-linux`
- `hlvm-windows.exe`

## Manual Build (Without Make)

If you don't have `make`:

### Step 1: Prepare Embedded AI Runtime

```bash
make setup-ai
```

This downloads the pinned embedded Ollama runtime into `resources/ai-engine/`.
The download is idempotent: if the pinned runtime is already present, later runs
reuse it instead of re-downloading.

### Step 2: Embed Packages

```bash
./scripts/embed-packages.ts
```

### Step 3: Compile Binary

```bash
deno compile --allow-all --no-check --config deno.json \
  --include resources/ai-engine \
  --include src/hql/lib/stdlib/js/index.js \
  --output hlvm src/hlvm/cli/cli.ts
```

### Step 4: Test

```bash
./hlvm --version
./hlvm run -e '(print "Hello!")'
```

## Build Options

### Debug Build

Include source maps:

```bash
deno compile --allow-all --config deno.json \
  --include resources/ai-engine \
  --include src/hql/lib/stdlib/js/index.js \
  --output hlvm src/hlvm/cli/cli.ts
```

Note: Larger binary, better error messages.

### Optimized Build

Fastest compilation (production):

```bash
deno compile --allow-all --no-check --config deno.json \
  --include resources/ai-engine \
  --include src/hql/lib/stdlib/js/index.js \
  --output hlvm src/hlvm/cli/cli.ts
```

Note: Default, skips type checking.

## Build Targets

Available targets:

- `x86_64-apple-darwin` - macOS Intel
- `aarch64-apple-darwin` - macOS Apple Silicon
- `x86_64-unknown-linux-gnu` - Linux x64
- `x86_64-pc-windows-msvc` - Windows x64

Specify with `--target`:

```bash
deno compile --allow-all --target x86_64-apple-darwin --output hlvm src/hlvm/cli/cli.ts
```

## Binary Size

Typical sizes:

- macOS: ~587MB with the embedded AI runtime payload
- Linux: platform-dependent, but substantially larger than the old sub-100MB builds
- Windows: platform-dependent; offline bundling is still out of scope for this pass

Note: The binary now includes the Deno runtime, all dependencies, and the
embedded Ollama runtime payload used by the one-shot local-AI install flow.

## GUI Binary Sync

`~/dev/hql` is the only SSOT build source for `hlvm`.

If you are also working with the macOS GUI wrapper in `~/dev/HLVM`:

- Xcode no longer compiles its own alternate `hlvm`
- the GUI build phase calls `scripts/sync-gui-binary.sh`
- that script builds `~/dev/hql/hlvm` if needed, then copies it into `HLVM/Resources/hlvm`

Optional developer convenience hook:

```bash
git config core.hooksPath .githooks
```

That enables the tracked `.githooks/post-commit` wrapper, which syncs the
bundled binary into a sibling `../HLVM` checkout after commits.

The hook is convenience only. The Xcode build phase remains the correctness
path, because it always copies the SSOT binary before the app is built.

## Troubleshooting

### Permission Denied

Make scripts executable:

```bash
chmod +x scripts/embed-packages.ts
```

### Deno Not Found

Install Deno:

```bash
curl -fsSL https://deno.land/install.sh | sh
```

Add to PATH:

```bash
export PATH="$HOME/.deno/bin:$PATH"
```

### Build Fails

Clean and retry:

```bash
make clean
make build
```

### Missing Dependencies

Update Deno:

```bash
deno upgrade
```

## Development Builds

### Watch Mode

Rebuild on changes:

```bash
deno run --allow-all --watch src/hlvm/cli/cli.ts repl
```

### Test Changes

Without building binary:

```bash
deno run --allow-all src/hlvm/cli/cli.ts run test.hql
```

## CI/CD Builds

### GitHub Actions

See `.github/workflows/release.yml` for automated builds.

### Build Matrix

Builds for:

- macOS (Intel + ARM)
- Linux (x64)
- Windows (x64)

## Clean Up

Remove build artifacts:

```bash
make clean
```

Removes:

- `hlvm`
- `hlvm-*` (all platform binaries)
- Temporary files

## Next Steps

- [Testing Guide](./TESTING.md) - Run tests
- [Contributing](../CONTRIBUTING.md) - Contribute code
