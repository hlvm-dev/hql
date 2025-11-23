# Bundle vs Package - The Key Confusion Explained

**Date:** 2025-11-15
**Purpose:** Clarify the difference between SOURCE bundling and BINARY bundling

---

## The Confusion

When you say "HQL not part of bundle", there are TWO possible meanings:

### Meaning A: Source Code Bundle
**Question:** Is HQL source code in the HLVM repository?

```
❌ Monorepo (HQL IS in source):
hlvm/
└── src/
    ├── hlvm-repl.ts
    └── hql/              ← HQL source code HERE
        ├── core/
        └── mod.ts

✅ JSR Package (HQL NOT in source):
hlvm/
└── src/
    └── hlvm-repl.ts      ← No HQL directory!

Separate:
hql/                      ← Different repository
├── core/
└── mod.ts
```

### Meaning B: Compiled Binary Bundle
**Question:** Is HQL code in the final HLVM binary?

```
✅ BOTH include HQL in binary:

Monorepo binary:
hlvm (273 MB)
├── HLVM code
└── HQL code (from src/hql/)

JSR Package binary:
hlvm (273 MB)
├── HLVM code
└── HQL code (from JSR, bundled at compile time)
```

---

## Visual: How JSR Works

### Step 1: Source Code (Separated)

```
GitHub - HLVM Repository
┌─────────────────────────────────────┐
│ hlvm-dev/hlvm                       │
│ ├── src/hlvm-repl.ts                │
│ ├── src/stdlib/hql.js               │
│ └── deno.json                       │
│     {                                │
│       "imports": {                   │
│         "@hlvm/hql": "jsr:@hlvm/hql@1.0.0"
│       }                              │
│     }                                │
└─────────────────────────────────────┘
         │
         │ imports from
         ▼
JSR Registry - HQL Package
┌─────────────────────────────────────┐
│ jsr.io/@hlvm/hql                    │
│ Published from: hlvm-dev/hql        │
│ Version: 1.0.0                      │
│ Size: ~2 MB (source)                │
└─────────────────────────────────────┘
         ▲
         │ published from
         │
GitHub - HQL Repository
┌─────────────────────────────────────┐
│ hlvm-dev/hql                        │  ← COMPLETELY SEPARATE REPO
│ ├── core/                           │
│ ├── mod.ts                          │
│ └── deno.json                       │
│     {                                │
│       "name": "@hlvm/hql",          │
│       "version": "1.0.0"            │
│     }                                │
└─────────────────────────────────────┘
```

### Step 2: Compile Time (Bundling)

```
Developer runs:
$ cd hlvm/
$ deno compile --allow-all --output hlvm mod.ts

What Deno does:
┌─────────────────────────────────────────────────────┐
│ 1. Read hlvm/deno.json                              │
│    ├── See import: "@hlvm/hql"                      │
│    └── Resolve to: jsr:@hlvm/hql@1.0.0             │
│                                                     │
│ 2. Download from JSR                                │
│    ├── Fetch: https://jsr.io/@hlvm/hql/1.0.0       │
│    └── Cache: ~/.cache/deno/jsr/@hlvm/hql@1.0.0/   │
│                                                     │
│ 3. Analyze dependency tree                          │
│    hlvm/mod.ts                                      │
│    ├── src/hlvm-repl.ts                            │
│    │   └── imports "@hlvm/hql"                     │
│    └── @hlvm/hql (from JSR cache)                  │
│        ├── core/transpiler.ts                      │
│        ├── core/parser.ts                          │
│        └── packages/...                            │
│                                                     │
│ 4. Bundle everything into single binary             │
│    ├── HLVM code (from hlvm/ repo)                 │
│    ├── HQL code (from JSR cache)                   │
│    └── Deno runtime                                │
│                                                     │
│ 5. Create executable                                │
│    └── hlvm (273 MB)                               │
│        ├── All HLVM code                           │
│        ├── All HQL code    ← FROM JSR, NOW BUNDLED │
│        └── Deno runtime                            │
└─────────────────────────────────────────────────────┘

Result: hlvm binary (273 MB)
```

### Step 3: Runtime (User)

```
User downloads:
$ curl -L https://github.com/hlvm-dev/hlvm/releases/download/v0.2.0/hlvm-mac-arm

User runs (NO INTERNET NEEDED):
$ ./hlvm
hlvm> (+ 1 2)
3

What happens inside:
┌─────────────────────────────────────┐
│ hlvm binary                         │
│ ├── HLVM REPL code                  │
│ │   └── calls HQL transpiler        │
│ └── HQL transpiler code             │
│     ├── Already embedded in binary  │  ← FROM JSR, BUNDLED AT COMPILE TIME
│     └── No network request needed   │
└─────────────────────────────────────┘
```

---

## Proof: Test JSR Bundling

Let's prove that `deno compile` DOES bundle JSR packages:

### Test 1: Simple JSR Package

```bash
# Create test project
$ mkdir test-jsr-bundle
$ cd test-jsr-bundle

$ cat > deno.json <<EOF
{
  "imports": {
    "@std/assert": "jsr:@std/assert@1.0.0"
  }
}
EOF

$ cat > mod.ts <<EOF
import { assertEquals } from "@std/assert";
console.log("Testing JSR bundling...");
assertEquals(1 + 1, 2);
console.log("✅ JSR package works!");
EOF

# Compile to binary
$ deno compile --allow-all --output test mod.ts
Compile file:///Users/you/test-jsr-bundle/mod.ts to test
Download jsr:@std/assert@1.0.0       ← Downloads from JSR
Check file:///Users/you/test-jsr-bundle/mod.ts

# Binary created
$ ls -lh test
-rwxr-xr-x  1 user  staff   92M Nov 15 10:00 test

# NOW DISCONNECT FROM INTERNET
$ sudo ifconfig en0 down    # macOS
# or: sudo ip link set eth0 down    # Linux

# Run binary (no internet!)
$ ./test
Testing JSR bundling...
✅ JSR package works!

# SUCCESS! JSR package was bundled into binary
```

### Test 2: Verify with ldd/otool

```bash
# Check binary dependencies (no network references)
$ otool -L test    # macOS
$ ldd test         # Linux

# Shows only system libraries, NO JSR URLs!
```

---

## Comparison: JSR vs Git Submodule

### JSR Package Workflow

```
DEVELOPMENT:
Developer A (HLVM):
1. Edit hlvm code
2. Test with: deno run -A mod.ts
3. Compile: deno compile → hlvm binary
4. HQL auto-downloaded from JSR

Developer B (HQL):
1. Edit hql code
2. Test: deno test
3. Publish: deno publish → JSR
4. HLVM picks up new version

SEPARATION: ★★★★★ Complete independence
```

### Git Submodule Workflow

```
DEVELOPMENT:
Developer (both HLVM and HQL):
1. git clone hlvm --recurse-submodules
2. Edit hql code in hlvm/hql/ (submodule)
3. Commit in submodule:
   cd hlvm/hql/
   git commit -m "..."
   git push origin main
4. Update parent repo:
   cd hlvm/
   git add hql/
   git commit -m "Update HQL submodule"

SEPARATION: ★★★☆☆ Structurally linked
```

---

## Addressing Your Concern

> "HQL located outside of HLVM (not part of bundle)"

**With JSR:**
- ✅ HQL source: `github.com/hlvm-dev/hql` (outside HLVM)
- ✅ HLVM source: `github.com/hlvm-dev/hlvm` (no hql/ directory)
- ✅ Compile time: Deno downloads HQL from JSR
- ✅ Binary: HQL bundled inside (so it works offline)

**This is NOT a contradiction!**
- HQL is NOT part of HLVM **source code**
- HQL IS part of HLVM **binary**

---

## Real-World Example: Rust

Let's compare with Rust, which everyone agrees is well-designed:

```
Rust Project
============

SOURCE CODE:
my-project/
├── Cargo.toml
│   [dependencies]
│   serde = "1.0"        ← Package from crates.io
└── src/main.rs
    use serde::Serialize; ← Uses external package

COMPILE TIME:
$ cargo build --release
   Downloading serde v1.0.0 from crates.io
   Compiling serde v1.0.0
   Compiling my-project v0.1.0
   Finished release [optimized] target(s)

BINARY:
target/release/my-project (2 MB)
├── my-project code
└── serde code (bundled from crates.io)

USER RUNS:
$ ./target/release/my-project
✅ Works offline! serde is bundled.
```

**Questions:**
1. Is serde part of my-project source? ❌ NO (crates.io)
2. Is serde in compiled binary? ✅ YES (bundled)
3. Are they separated? ✅ YES (fully independent)

**This is EXACTLY how JSR + Deno works!**

---

## Final Comparison Table

| Aspect | Monorepo | Git Submodule | JSR Package |
|--------|----------|---------------|-------------|
| **HQL source location** | `hlvm/src/hql/` | `hlvm/hql/` (submodule) | `hql/` (separate repo) |
| **HQL in HLVM source?** | ✅ YES | ⚠️ Linked | ❌ NO |
| **HQL in HLVM binary?** | ✅ YES | ✅ YES | ✅ YES |
| **Requires internet at runtime?** | ❌ NO | ❌ NO | ❌ NO |
| **Requires internet to build?** | ❌ NO | ❌ NO | ✅ YES (first time) |
| **Independent git repos?** | ❌ NO | ✅ YES | ✅ YES |
| **Independent packages?** | ❌ NO | ⚠️ PARTIAL | ✅ YES |
| **Semantic versioning?** | ❌ NO | ⚠️ Via tags | ✅ YES |
| **Can HQL be used standalone?** | ⚠️ Hard | ⚠️ Hard | ✅ EASY |
| **Professional standard?** | ⚠️ Small projects | ✅ Large projects | ✅ Modern projects |

---

## The Answer

**Your 3 requirements:**

1. HQL outside HLVM (not in source repo)
2. HQL available by default (in binary)
3. Separated git projects AND packages

**Can JSR satisfy all 3?**

### ✅ YES

**Proof:**

```
Requirement 1: Outside HLVM
├── HLVM repo: github.com/hlvm-dev/hlvm (no hql/ directory)
├── HQL repo: github.com/hlvm-dev/hql (separate)
└── ✅ HQL source NOT in HLVM source

Requirement 2: Available by default
├── Build: deno compile → downloads HQL from JSR
├── Binary: hlvm (273 MB) with HQL inside
└── ✅ Users run hlvm → HQL works immediately

Requirement 3: Separated projects
├── Git: Two independent repos
├── Package: @hlvm/hql on JSR
└── ✅ Fully independent, semantic versioning
```

---

## The Key Insight

**"Not part of bundle" must mean "not in SOURCE bundle"**

Because if it means "not in BINARY bundle", then requirement #2 (available by default) is impossible!

You can't have HQL available by default without it being in the binary.

**Think of it like Chrome + V8:**
- V8 source: Not in Chrome repo ✅
- V8 binary: IS in Chrome binary ✅
- Users: Chrome works immediately ✅

**JSR is the same:**
- HQL source: Not in HLVM repo ✅
- HQL binary: IS in HLVM binary ✅
- Users: HLVM works immediately ✅

---

**Last Updated:** 2025-11-15
**Conclusion:** JSR satisfies all 3 requirements
**Next step:** Publish to JSR or choose alternative?
