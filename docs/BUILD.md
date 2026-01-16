# Building HLVM from Source

Complete guide to building HLVM binaries.

## Prerequisites

### Required

- **Deno** 1.40+ ([install](https://deno.land/))
- **Git**

### Optional

- **Make** (for build commands)

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

### Build and Launch REPL

```bash
make fast
```

Builds and immediately opens REPL.

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

### Step 1: Embed Packages

```bash
./scripts/embed-packages.ts
```

### Step 2: Compile Binary

```bash
deno compile --allow-all --no-check --output hlvm src/hlvm/cli/cli.ts
```

### Step 3: Test

```bash
./hlvm --version
./hlvm run -e '(print "Hello!")'
```

## Build Options

### Debug Build

Include source maps:

```bash
deno compile --allow-all --output hlvm src/hlvm/cli/cli.ts
```

Note: Larger binary, better error messages.

### Optimized Build

Fastest compilation (production):

```bash
deno compile --allow-all --no-check --output hlvm src/hlvm/cli/cli.ts
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

- macOS: ~90MB
- Linux: ~95MB
- Windows: ~85MB

Note: Includes Deno runtime and all dependencies.

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
