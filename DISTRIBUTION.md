# HQL Distribution Guide

Complete guide for distributing HQL binaries to users.

## 📦 Quick Installation for Users

### Option 1: One-Line Install (Recommended)

**Mac and Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/yourusername/hql/main/install.sh | sh
```

**Windows (PowerShell):**
```powershell
# Coming soon - Windows installer
```

### Option 2: Homebrew (Mac/Linux)

```bash
brew tap yourusername/hql
brew install hql
```

Or install directly:
```bash
brew install yourusername/hql/hql
```

### Option 3: Manual Download

1. Go to [GitHub Releases](https://github.com/yourusername/hql/releases/latest)
2. Download the binary for your platform:
   - **Mac ARM (M1/M2/M3)**: `hql-mac-arm`
   - **Mac Intel**: `hql-mac-intel`
   - **Linux**: `hql-linux`
   - **Windows**: `hql-windows.exe`

3. Install:
   ```bash
   chmod +x hql-*              # Make executable
   sudo mv hql-* /usr/local/bin/hql  # Move to PATH
   hql --version               # Verify
   ```

---

## 🔨 Building Binaries (For Maintainers)

### Quick Build (Current Platform)

```bash
make build
```

This creates `./hql` binary for your current platform.

### Cross-Platform Builds

Build for all platforms at once:

```bash
make all
```

This creates:
- `hql-mac-intel` - macOS Intel (x86_64)
- `hql-mac-arm` - macOS Apple Silicon (M1/M2/M3)
- `hql-linux` - Linux (x86_64)
- `hql-windows.exe` - Windows (x86_64)

### Individual Platform Builds

```bash
make build-mac-intel    # Mac Intel
make build-mac-arm      # Mac ARM (Apple Silicon)
make build-linux        # Linux x86_64
make build-windows      # Windows x86_64
```

### Local Installation

Install on your machine:

```bash
make install
```

This copies the binary to `/usr/local/bin/hql`.

---

## 🚀 Publishing a Release

### Step 1: Build All Platforms

```bash
make all
```

Verify all binaries work:
```bash
./hql-mac-arm --version
./hql-mac-intel --version
./hql-linux --version
# Test on Windows separately
```

### Step 2: Create Git Tag

```bash
git tag -a v0.1.0 -m "Release version 0.1.0"
git push origin v0.1.0
```

### Step 3: GitHub Actions (Automatic)

GitHub Actions will automatically:
1. ✅ Build binaries for all platforms
2. ✅ Run tests on each platform
3. ✅ Create a GitHub Release
4. ✅ Upload binaries as release assets
5. ✅ Generate SHA256 checksums

See `.github/workflows/release.yml` for details.

### Step 4: Update Homebrew Formula

After the release is published, update `hql.rb`:

1. Get SHA256 checksums from GitHub Actions output
2. Update the formula:

```ruby
# hql.rb
class Hql < Formula
  version "0.1.0"  # Update version

  if OS.mac?
    if Hardware::CPU.arm?
      url "https://github.com/yourusername/hql/releases/download/v0.1.0/hql-mac-arm"
      sha256 "abc123..."  # Update with actual SHA256
    else
      url "https://github.com/yourusername/hql/releases/download/v0.1.0/hql-mac-intel"
      sha256 "def456..."  # Update with actual SHA256
    end
  # ... etc
```

3. Test the formula locally:

```bash
brew install --build-from-source ./hql.rb
hql --version
```

4. Publish to your Homebrew tap:

```bash
# First time: Create a tap repository
# GitHub repo: yourusername/homebrew-hql

git clone https://github.com/yourusername/homebrew-hql
cd homebrew-hql
cp ../hql.rb Formula/hql.rb
git add Formula/hql.rb
git commit -m "Add HQL v0.1.0"
git push
```

---

## 🧪 Testing Distribution

### Test Install Script

```bash
# Test locally
./install.sh

# Test from GitHub (after pushing)
curl -fsSL https://raw.githubusercontent.com/yourusername/hql/main/install.sh | sh
```

### Test Homebrew Formula

```bash
# Install from local formula
brew install --build-from-source ./hql.rb

# Uninstall
brew uninstall hql

# Install from tap (after publishing)
brew tap yourusername/hql
brew install hql
```

### Test Manual Download

```bash
# Download from GitHub release
curl -LO https://github.com/yourusername/hql/releases/latest/download/hql-mac-arm

# Make executable and test
chmod +x hql-mac-arm
./hql-mac-arm --version
./hql-mac-arm repl
```

---

## 📋 Pre-Release Checklist

Before releasing a new version:

- [ ] All tests pass: `deno test --allow-all`
- [ ] Binary builds successfully: `make all`
- [ ] All platform binaries tested
- [ ] Version updated in:
  - [ ] `Makefile` (VERSION variable)
  - [ ] `hql.rb` (Homebrew formula)
  - [ ] `core/cli/cli.ts` (--version output)
- [ ] CHANGELOG updated
- [ ] Documentation updated
- [ ] Git tag created

---

## 🔧 Troubleshooting

### Install Script Issues

**Problem**: "curl: command not found"
- **Solution**: Install curl: `brew install curl` (Mac) or `apt-get install curl` (Linux)

**Problem**: "Permission denied"
- **Solution**: Run with `sh -c "$(curl -fsSL ...)"`

**Problem**: Binary not in PATH
- **Solution**: Restart shell or run: `export PATH="$PATH:$HOME/.hql/bin"`

### Homebrew Issues

**Problem**: "Formula not found"
- **Solution**: Run `brew tap yourusername/hql` first

**Problem**: "SHA256 mismatch"
- **Solution**: Update the formula with correct checksums from GitHub Actions

### Binary Issues

**Problem**: "Permission denied" when running binary
- **Solution**: Run `chmod +x hql`

**Problem**: "Binary not found"
- **Solution**: Make sure binary is in PATH: `echo $PATH`

---

## 📚 Additional Resources

- **GitHub Releases**: https://github.com/yourusername/hql/releases
- **Homebrew Tap**: https://github.com/yourusername/homebrew-hql
- **Documentation**: https://github.com/yourusername/hql/tree/main/doc

---

## 🎯 Distribution Summary

| Method | Command | Best For |
|--------|---------|----------|
| **One-line install** | `curl ... \| sh` | Quick setup, CI/CD |
| **Homebrew** | `brew install hql` | Mac/Linux developers |
| **Manual download** | Download from releases | Windows, air-gapped systems |
| **Build from source** | `make build` | Development, customization |

---

**Last Updated**: 2025-11-15
**Current Version**: 0.1.0
