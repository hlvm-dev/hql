# HQL Release Process - Quick Reference

Step-by-step guide for releasing a new version of HQL.

## 🚀 Release Steps (5 minutes)

### 1. Pre-Release Checks

```bash
# Ensure all tests pass
deno test --allow-all

# Verify build works
make build
./hql --version
```

### 2. Update Version Numbers

Update version in these files:
- `Makefile` line 7: `VERSION := 0.1.0`
- `hql.rb` line 5: `version "0.1.0"`
- `core/cli/cli.ts` (if applicable)

```bash
# Quick version update (replace 0.1.0 with your version)
VERSION="0.2.0"

# Update Makefile
sed -i.bak "s/VERSION := .*/VERSION := $VERSION/" Makefile

# Update Homebrew formula
sed -i.bak "s/version \".*\"/version \"$VERSION\"/" hql.rb
```

### 3. Build All Platforms

```bash
make all
```

Expected output:
```
📦 All binaries built:
-rwxr-xr-x  hql-mac-arm
-rwxr-xr-x  hql-mac-intel
-rwxr-xr-x  hql-linux
-rwxr-xr-x  hql-windows.exe
✅ Ready to distribute!
```

### 4. Create Git Tag and Push

```bash
# Create annotated tag
git tag -a v0.2.0 -m "Release version 0.2.0"

# Push tag to GitHub
git push origin v0.2.0
```

### 5. GitHub Actions (Automatic)

GitHub Actions automatically:
- ✅ Builds binaries for all platforms
- ✅ Runs tests
- ✅ Creates GitHub Release
- ✅ Uploads binaries
- ✅ Generates SHA256 checksums

**Wait for Actions to complete** (~5-10 minutes)

### 6. Update Homebrew Formula

After GitHub Actions completes:

1. Go to the GitHub Actions run
2. Check "Update Homebrew Formula" step for SHA256 values
3. Copy the checksums
4. Update `hql.rb` with new checksums

```bash
# Test Homebrew formula locally
brew install --build-from-source ./hql.rb
hql --version

# Uninstall test version
brew uninstall hql
```

### 7. Publish Homebrew Formula

```bash
# Clone your tap (first time only)
git clone https://github.com/yourusername/homebrew-hql
cd homebrew-hql

# Copy updated formula
cp ../hql.rb Formula/hql.rb

# Commit and push
git add Formula/hql.rb
git commit -m "Update HQL to v0.2.0"
git push
```

### 8. Verify Distribution

Test all distribution methods:

```bash
# Test one-line install
curl -fsSL https://raw.githubusercontent.com/yourusername/hql/main/install.sh | sh

# Test Homebrew
brew tap yourusername/hql
brew install hql

# Test manual download
curl -LO https://github.com/yourusername/hql/releases/latest/download/hql-mac-arm
chmod +x hql-mac-arm
./hql-mac-arm --version
```

---

## 🔧 Setup (One-Time)

### 1. Configure GitHub Repository

Ensure your repo has:
- [ ] GitHub Actions enabled
- [ ] Release permissions enabled
- [ ] Secrets configured (if needed)

### 2. Create Homebrew Tap (One-Time)

```bash
# Create new GitHub repo: yourusername/homebrew-hql
gh repo create homebrew-hql --public

# Clone and setup
git clone https://github.com/yourusername/homebrew-hql
cd homebrew-hql
mkdir Formula
cp ../hql.rb Formula/hql.rb
git add Formula/hql.rb
git commit -m "Initial HQL formula"
git push
```

### 3. Update URLs in Files

Replace `yourusername/hql` with your actual GitHub username/org in:
- [ ] `install.sh` (REPO variable, line 20)
- [ ] `hql.rb` (homepage and URLs)
- [ ] `.github/workflows/release.yml` (if hardcoded)

---

## 📝 Release Checklist Template

Copy this checklist for each release:

```markdown
## Release v0.X.0

- [ ] All tests passing
- [ ] Version updated in Makefile, hql.rb, cli.ts
- [ ] Built all platforms: `make all`
- [ ] Git tag created: `git tag -a v0.X.0`
- [ ] Tag pushed: `git push origin v0.X.0`
- [ ] GitHub Actions completed successfully
- [ ] GitHub Release created
- [ ] Binaries uploaded to release
- [ ] SHA256 checksums obtained
- [ ] Homebrew formula updated with checksums
- [ ] Homebrew formula tested locally
- [ ] Homebrew tap updated
- [ ] Install script tested
- [ ] Manual download tested
- [ ] Documentation updated
- [ ] CHANGELOG updated
- [ ] Announcement posted (if applicable)
```

---

## 🐛 Troubleshooting

### GitHub Actions Failed

**Check the logs**:
1. Go to Actions tab
2. Click on failed workflow
3. Check which step failed
4. Fix the issue
5. Delete the tag: `git tag -d v0.X.0 && git push origin :refs/tags/v0.X.0`
6. Start over from Step 4

### Binary Doesn't Work

```bash
# Test each platform binary
./hql-mac-arm --version
./hql-mac-intel --version
./hql-linux --version

# Check permissions
chmod +x hql-*

# Check Deno compilation
deno compile --version
```

### Homebrew Formula Invalid

```bash
# Audit formula
brew audit --strict --online hql.rb

# Fix issues and test again
brew install --build-from-source ./hql.rb
```

---

## 🎯 Quick Commands Reference

```bash
# Build
make build          # Current platform
make all            # All platforms
make clean          # Clean build files

# Test
deno test --allow-all
./hql --version
./hql repl

# Release
git tag -a v0.X.0 -m "Release v0.X.0"
git push origin v0.X.0

# Homebrew
brew audit hql.rb
brew install --build-from-source ./hql.rb
brew uninstall hql
```

---

**Next Release**: v0.2.0
**Last Release**: v0.1.0 (2025-11-15)
