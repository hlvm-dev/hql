# Release Guide

This document explains how to create a new HLVM release.

## Automated Release Process

HLVM uses GitHub Actions to automatically build and release binaries for all platforms.

### How It Works

1. **Push a version tag** → GitHub Actions automatically:
   - Builds binaries for macOS (ARM + Intel), Linux, Windows
   - Creates a GitHub release
   - Uploads all binaries
   - Generates release notes

2. **Users install** → Install script downloads the latest binaries

### Creating a Release

**Step 1: Update Version**

Update version in:
- `mod.ts` (export const version)
- `deno.json` (version field)
- `Makefile` (VERSION variable)

**Step 2: Commit Changes**

```bash
git add .
git commit -m "chore: bump version to 0.2.0"
git push
```

**Step 3: Create and Push Tag**

```bash
# Create annotated tag
git tag -a v0.2.0 -m "Release v0.2.0"

# Push tag to GitHub
git push origin v0.2.0
```

**Step 4: Wait for Build**

- Go to: https://github.com/hlvm-dev/hlvm/actions
- Watch the "Release" workflow run (~5-10 minutes)
- It builds all 4 platform binaries in parallel

**Step 5: Verify Release**

- Go to: https://github.com/hlvm-dev/hlvm/releases
- Verify the release was created
- Check all 4 binaries are attached:
  - `hlvm-mac-arm`
  - `hlvm-mac-intel`
  - `hlvm-linux`
  - `hlvm-windows.exe`

**Step 6: Test Installation**

```bash
# Test the install script
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hlvm/main/install.sh | sh

# Verify version
hlvm --version
```

## Manual Release (Fallback)

If GitHub Actions is unavailable, you can create a manual release:

```bash
# Build all binaries locally
make all

# Create release on GitHub manually
# Upload binaries: hlvm-mac-arm, hlvm-mac-intel, hlvm-linux, hlvm-windows.exe
```

## Release Checklist

Before creating a release:

- [ ] All tests passing (`deno test --allow-all`)
- [ ] Version numbers updated
- [ ] CHANGELOG updated (if exists)
- [ ] Documentation up to date
- [ ] README accurate
- [ ] install.sh tested locally

After creating a release:

- [ ] Install script works on macOS
- [ ] Install script works on Linux (if available)
- [ ] Windows binary downloads and runs
- [ ] REPL works
- [ ] Basic functionality tested

## Versioning

HLVM follows [Semantic Versioning](https://semver.org/):

- **Major** (v1.0.0): Breaking changes
- **Minor** (v0.2.0): New features, backwards compatible
- **Patch** (v0.1.1): Bug fixes, backwards compatible

## Troubleshooting

### Build fails on GitHub Actions

Check the Actions tab for error logs. Common issues:
- Deno version incompatibility
- Missing dependencies
- Compilation errors

### Release not created

Ensure:
- Tag pushed to GitHub (not just local)
- Tag format is correct (v*.*.*)
- Repository has Actions enabled
- Workflow file is valid YAML

### Binaries not attached

Check:
- Build job completed successfully
- Artifacts uploaded correctly
- Release job has proper permissions

## First-Time Setup

The first release requires manual setup:

1. Push the workflow file (`.github/workflows/release.yml`)
2. Ensure GitHub Actions is enabled in repository settings
3. Create the first tag: `git tag -a v0.1.0 -m "Initial release"`
4. Push the tag: `git push origin v0.1.0`
5. Wait for the workflow to complete

After the first release, all future releases are fully automated.

## Example Release Flow

```bash
# Update version
vim deno.json  # Change version to 0.2.0

# Commit
git add .
git commit -m "chore: bump version to 0.2.0"
git push

# Tag and release
git tag -a v0.2.0 -m "Release v0.2.0: Added template literals"
git push origin v0.2.0

# Wait ~5 minutes
# Check: https://github.com/hlvm-dev/hlvm/releases

# Test
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hlvm/main/install.sh | sh
hlvm --version  # Should show v0.2.0
```

## See Also

- [Build Guide](./BUILD.md) - Building from source
- [Contributing](../CONTRIBUTING.md) - Contribution guidelines
- [GitHub Actions Docs](https://docs.github.com/en/actions) - GitHub Actions documentation
