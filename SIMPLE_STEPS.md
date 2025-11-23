# 🚀 HQL Distribution - SIMPLE STEPS

## 📝 TLDR

**Goal:** Make `hql run hello.hql` work anywhere

**Status:**
- ✅ Binary builds successfully (80MB)
- ⚠️ Needs package embedding to work fully
- ⏱️ 15 minutes to fix

---

## 🎯 WHAT TO DO (Copy & Paste These)

### STEP 1: Build the Binary (Works Now!)

```bash
cd /Users/seoksoonjang/Desktop/hlvm/src/hql

# Build it
make build

# Test it
./hql --version
```

**Expected:** `HQL CLI version 0.1.0` ✅

---

### STEP 2: What Works vs What Doesn't

✅ **WORKS:**
```bash
./hql --version              # Shows version
./hql --help                 # Shows help
```

❌ **DOESN'T WORK YET:**
```bash
./hql run hello.hql          # Error: can't find packages
./hql run '(+ 1 2)'          # Error: treats as filename
```

**Why?** Binary needs packages embedded (like HLVM does)

---

### STEP 3: How HLVM Does It (The Answer)

```
HLVM builds like this:
1. ./src/embed-stdlib.ts     ← Embeds all files
2. deno compile hlvm-repl.ts ← Compiles with embedded stuff
3. ✅ Works perfectly!

HQL needs same thing:
1. Create embed-packages.ts  ← Need to create this
2. deno compile cli.ts       ← Already doing this
3. ✅ Will work!
```

---

## 🔧 THE FIX (15 minutes)

See detailed guides:
- **Visual explanation:** `HOW_IT_WORKS_VISUAL.md`
- **Full instructions:** `DISTRIBUTION_GUIDE.md`
- **HLVM reference:** `/Users/seoksoonjang/Desktop/hlvm/src/embed-stdlib.ts`

**Summary:**
1. Create `scripts/embed-packages.ts` (copies from HLVM pattern)
2. Update `Makefile` to run embedding first
3. Modify `mod.ts` to use embedded packages
4. Test: `make build && ./hql run test.hql`

---

## 📦 DISTRIBUTION OPTIONS (After Fix)

### Option 1: Local Install (Easiest)
```bash
make build
make install          # Copies to /usr/local/bin
hql run anywhere.hql  # Works from any directory!
```

### Option 2: GitHub Releases
```bash
make all              # Builds for Mac/Linux/Windows
# Upload to GitHub releases
# Users download and install
```

### Option 3: Homebrew
```bash
# 1. Create homebrew-hql repo
# 2. Add formula (see DISTRIBUTION_GUIDE.md)
# 3. Users: brew install yourname/hql/hql
```

### Option 4: NPM
```bash
# Build NPM package with dnt
npm publish
# Users: npm install -g hql
```

---

## 🎨 VISUAL SUMMARY

```
┌─────────────────────────────────────────┐
│         CURRENT STATE                    │
│                                           │
│  Source Code                             │
│      ↓                                   │
│  make build                              │
│      ↓                                   │
│  ✅ Binary created (80MB)                │
│      ↓                                   │
│  ./hql --version  ✅ Works               │
│  ./hql run test   ❌ Needs fix           │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│         AFTER FIX                        │
│                                           │
│  Source Code + Packages                  │
│      ↓                                   │
│  scripts/embed-packages.ts               │
│      ↓                                   │
│  make build                              │
│      ↓                                   │
│  ✅ Binary with embedded packages        │
│      ↓                                   │
│  ./hql run test   ✅ Works!              │
│  brew install hql ✅ Ready!              │
└─────────────────────────────────────────┘
```

---

## 📊 FILE CHECKLIST

| File | Status | Purpose |
|------|--------|---------|
| `Makefile` | ✅ Created | Build automation |
| `HOW_IT_WORKS_VISUAL.md` | ✅ Created | Visual explanation |
| `DISTRIBUTION_GUIDE.md` | ✅ Created | Detailed instructions |
| `SIMPLE_STEPS.md` | ✅ You are here | Quick reference |
| `scripts/embed-packages.ts` | ⏳ TODO | Embeds packages |
| `core/src/embedded-packages.ts` | ⏳ Auto-generated | Embedded content |

---

## 🎯 NEXT ACTIONS

**For Development:**
```bash
# Current: Use deno directly (works perfectly)
deno run -A core/cli/cli.ts run hello.hql

# After fix: Use binary
./hql run hello.hql
```

**For Distribution:**
1. Implement embedding (see DISTRIBUTION_GUIDE.md)
2. Test: `make build && ./hql run test.hql`
3. Build all platforms: `make all`
4. Create GitHub release
5. Submit to Homebrew

---

## 🤔 COMMON QUESTIONS

**Q: Why is binary so big (80MB)?**
A: Contains Deno runtime (JavaScript engine). This is normal. Node.js binaries are similar.

**Q: Can I make it smaller?**
A: Not really. V8 engine + runtime = ~50MB minimum. Your code is only ~2MB.

**Q: Does it work on all platforms?**
A: Yes! Build for Mac/Linux/Windows with `make all`

**Q: How is this different from HLVM?**
A: HLVM is full runtime with REPL. HQL is just the language compiler/runner.

**Q: Can I distribute this?**
A: Yes! MIT licensed. Binary is self-contained.

---

## ✅ SUCCESS CRITERIA

You'll know it works when:

```bash
# 1. Build
make build
# → ✅ Creates hql binary

# 2. Install
make install
# → ✅ Copies to /usr/local/bin

# 3. Test from anywhere
cd ~
echo '(print "Success!")' > test.hql
hql run test.hql
# → ✅ Prints: Success!

# 4. Clean up
rm test.hql
```

---

## 📚 REFERENCES

- **Visual guide:** `HOW_IT_WORKS_VISUAL.md` ← Read this first!
- **Detailed guide:** `DISTRIBUTION_GUIDE.md`
- **Makefile:** `Makefile` ← Build commands
- **HLVM reference:** `/Users/seoksoonjang/Desktop/hlvm/Makefile`
- **Embed script example:** `/Users/seoksoonjang/Desktop/hlvm/src/embed-stdlib.ts`

---

**Status:** 80% done! Just needs embedding script (15 min work).

**Bottom line:** YES, 100% achievable! The hard part (binary compilation) works. Just need to copy HLVM's embedding pattern.
