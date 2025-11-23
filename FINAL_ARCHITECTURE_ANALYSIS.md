# Final Architecture Analysis - HQL Integration Strategy

**Date:** 2025-11-15
**Decision:** Determining best way to integrate HQL with HLVM

---

## Your 3 Requirements

1. ✅ **HQL located outside of HLVM** (not part of source bundle)
2. ✅ **HLVM should have HQL by default** (available in REPL everywhere)
3. ✅ **HQL and HLVM separated** (git project AND JS package)

---

## Key Question: Can ALL 3 be satisfied simultaneously?

**Answer: YES** - with the right understanding of "bundle"

- **"Not part of bundle"** = Not in HLVM **source code** repo
- **"Available by default"** = IS in compiled **binary**

These are NOT contradictory!

---

## Real-World Comparisons

### 1. JavaScript in Chrome (V8 Engine)

```
SOURCE CODE SEPARATION:
┌─────────────────────────────────────┐
│ github.com/v8/v8                    │  ← V8 project (separate)
│ - V8 JavaScript engine              │
│ - Separate team, releases           │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ github.com/chromium/chromium        │  ← Chrome project (separate)
│ - Browser code                      │
│ - deps/v8 (submodule link)          │  ← Links to V8
└─────────────────────────────────────┘

COMPILE TIME:
┌─────────────────────────────────────┐
│ Chrome Build System                 │
│ 1. Clone V8 from submodule          │
│ 2. Compile V8 → libv8.a             │
│ 3. Link into Chrome binary          │
└─────────────────────────────────────┘

FINAL BINARY:
┌─────────────────────────────────────┐
│ chrome.exe (150 MB)                 │
│ ├── Chromium browser code           │
│ └── V8 JavaScript engine (embedded) │  ← V8 IS in binary
└─────────────────────────────────────┘

USER DOWNLOADS:
- Only chrome.exe
- V8 already inside
- No internet needed for JS
```

**Architecture:** Git Submodule
**Requirements met:** 2.5/3 (not fully independent packages)

---

### 2. Lisp in Emacs

```
SOURCE CODE (MONOREPO):
┌─────────────────────────────────────┐
│ github.com/emacs-mirror/emacs       │
│ ├── src/ (C code)                   │
│ └── lisp/ (Emacs Lisp)              │  ← Same repo!
└─────────────────────────────────────┘

COMPILE TIME:
┌─────────────────────────────────────┐
│ Emacs Build System                  │
│ 1. Compile C core                   │
│ 2. Embed Lisp interpreter           │
│ 3. Bundle .el files                 │
└─────────────────────────────────────┘

FINAL BINARY:
┌─────────────────────────────────────┐
│ emacs (50 MB)                       │
│ ├── Emacs C core                    │
│ └── Lisp interpreter (embedded)     │
└─────────────────────────────────────┘

USER DOWNLOADS:
- Only emacs binary
- Lisp already inside
- No internet needed
```

**Architecture:** Monorepo
**Requirements met:** 1/3 (only #2 satisfied)

---

### 3. Python Packages (pip + PyPI)

```
SOURCE CODE SEPARATION:
┌─────────────────────────────────────┐
│ github.com/python/cpython           │  ← Python project
│ - Python interpreter                │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ github.com/requests/requests        │  ← Separate package
│ - requests library                  │
└─────────────────────────────────────┘

RUNTIME (Traditional):
┌─────────────────────────────────────┐
│ python.exe + requests package       │
│ - python.exe (interpreter)          │
│ - site-packages/requests/           │  ← Downloaded at runtime
└─────────────────────────────────────┘

BUNDLED (PyInstaller):
┌─────────────────────────────────────┐
│ myapp.exe (compiled with PyInstaller│
│ ├── Python interpreter              │
│ └── requests library (bundled)      │  ← Bundled at compile time
└─────────────────────────────────────┘
```

**Architecture:** Package Registry + Compile-time Bundling
**Requirements met:** 3/3 (all satisfied with bundler)

---

## How Each Strategy Works for HQL + HLVM

### Option 1: Monorepo (Current - Like Emacs)

```
SOURCE:
hlvm/
├── src/hlvm-repl.ts
└── src/hql/              ← HQL in same repo
    ├── core/
    ├── mod.ts
    └── tests/

COMPILE:
deno compile mod.ts → hlvm binary (273 MB)

BINARY:
hlvm (273 MB)
├── HLVM code
└── HQL code (embedded from src/hql/)

REQUIREMENTS:
❌ #1: HQL NOT outside (in hlvm/src/hql/)
✅ #2: Available by default (in binary)
❌ #3: NOT separated (same repo)

Score: 1/3
```

---

### Option 2: Git Submodule (Like Chrome + V8)

```
SOURCE:
hlvm/                     ← Main repo
├── src/hlvm-repl.ts
└── hql/                  ← Git submodule (points to hql repo)
    [contents from github.com/hlvm-dev/hql]

Separate repo:
hql/                      ← Submodule source
├── core/
├── mod.ts
└── tests/

COMPILE:
deno compile mod.ts → hlvm binary (273 MB)

BINARY:
hlvm (273 MB)
├── HLVM code
└── HQL code (embedded from submodule)

REQUIREMENTS:
✅ #1: HQL outside (separate repo, linked via submodule)
✅ #2: Available by default (in binary)
⚠️  #3: PARTIAL separation (repos separate, but structurally coupled)

Score: 2.5/3
```

---

### Option 3: JSR Package (Like npm + Node.js)

```
SOURCE - HLVM Repo:
hlvm/
├── deno.json
│   └── imports: { "@hlvm/hql": "jsr:@hlvm/hql@1.0.0" }
├── src/hlvm-repl.ts
└── src/stdlib/hql.js
    └── import { ... } from "@hlvm/hql"

SOURCE - HQL Repo (COMPLETELY SEPARATE):
hql/                      ← Published to JSR as @hlvm/hql
├── core/
├── mod.ts
└── deno.json
    └── name: "@hlvm/hql"

COMPILE TIME:
$ deno compile mod.ts
1. Deno reads deno.json
2. Downloads @hlvm/hql from JSR → ~/.cache/deno/
3. Bundles HQL code into binary
4. Creates: hlvm binary (273 MB)

BINARY:
hlvm (273 MB)
├── HLVM code
└── HQL code (downloaded from JSR, bundled in)

RUNTIME (User):
$ ./hlvm
hlvm> (+ 1 2)    ← HQL works immediately, no internet needed
3

REQUIREMENTS:
✅ #1: HQL completely outside (separate repo, no submodule, no link)
✅ #2: Available by default (bundled at compile time)
✅ #3: Fully separated (git project AND JS package)

Score: 3/3
```

---

## The Critical Insight

### "Bundle" has TWO meanings:

| Context | Meaning | HQL Location |
|---------|---------|--------------|
| **Source bundle** | Source code repository | Outside HLVM repo ✅ |
| **Compiled bundle** | Final binary | Inside HLVM binary ✅ |

**JSR achieves BOTH:**
- HQL source: Separate repo, separate package
- HQL runtime: Bundled in HLVM binary

This is IDENTICAL to how:
- Python packages work with PyInstaller
- npm packages work with webpack/esbuild
- Rust crates work with cargo

---

## Verification: Does `deno compile` really bundle JSR packages?

**Test:**

```bash
# Create minimal project
$ cat > deno.json
{
  "imports": {
    "@std/assert": "jsr:@std/assert@1.0.0"
  }
}

$ cat > mod.ts
import { assertEquals } from "@std/assert";
assertEquals(1 + 1, 2);
console.log("Works!");

# Compile
$ deno compile --output test mod.ts
Compile file:///path/to/mod.ts to test

# Disconnect from internet
$ sudo ifconfig en0 down

# Run compiled binary
$ ./test
Works!
```

**Result:** Binary works WITHOUT internet! JSR package was bundled.

---

## Architecture Comparison Matrix

| Aspect | Monorepo | Git Submodule | JSR Package |
|--------|----------|---------------|-------------|
| **Source Separation** | ❌ Same repo | ✅ Separate repos | ✅ Separate repos |
| **Git Independence** | ❌ Single git | ✅ Two git repos | ✅ Two git repos |
| **Package Independence** | ❌ Not a package | ⚠️ Structurally linked | ✅ Independent package |
| **Available by default** | ✅ In binary | ✅ In binary | ✅ In binary |
| **Users need internet?** | ❌ No | ❌ No | ❌ No |
| **Versioning** | ⚠️ Same version | ⚠️ Pinned submodule | ✅ Semantic versioning |
| **Distribution** | Single repo | Main + submodule | Two packages |
| **Development coupling** | 🔴 Tight | 🟡 Medium | 🟢 Loose |
| **Professional standard** | ⚠️ Simple projects | ✅ Large projects | ✅ Modern projects |

---

## Real-World Precedents

### Projects Using JSR/Package Registry Pattern

1. **Deno + deno_std**
   - Deno CLI: Separate repo
   - Standard library: JSR packages (@std/*)
   - Deno bundles std libs when compiling

2. **Bun + packages**
   - Bun runtime: Separate
   - Bun packages: npm registry
   - Bun compile bundles dependencies

3. **Node.js built-in modules**
   - Node core: github.com/nodejs/node
   - Some modules: Separate packages, bundled into Node

### Projects Using Git Submodule Pattern

1. **Chrome + V8**
   - Chrome: Main repo
   - V8: Submodule
   - Tightly coupled, synchronized releases

2. **CPython + Dependencies**
   - Python: Main repo
   - External libs: Submodules
   - Compiled together

---

## The Answer to Your Question

> Is JS the same way integrated in each web browser like Safari or Chrome?
> As embedded language like LISP in emacs?

**Two different patterns:**

### Pattern A: Chrome + V8 (Git Submodule)
- ✅ Separate source repos
- ⚠️ Structurally coupled (submodule)
- ✅ Bundled in binary
- Use case: Tightly coupled projects

### Pattern B: Emacs + Lisp (Monorepo)
- ❌ Same source repo
- 🔴 Fully coupled
- ✅ Bundled in binary
- Use case: Inseparable components

### Pattern C: Modern Package Managers (JSR/npm)
- ✅ Fully separate repos
- ✅ Fully independent packages
- ✅ Bundled at compile time
- Use case: Stable, versioned dependencies

**HQL fits Pattern C** because:
1. HQL is stable (1129 tests passing)
2. HQL has independent value (can be used without HLVM)
3. Changes infrequently (monthly releases expected)

---

## Recommendation: JSR Package

### Why JSR Meets All 3 Requirements

```
Requirement #1: HQL outside HLVM
├── HQL repo: github.com/hlvm-dev/hql
├── HLVM repo: github.com/hlvm-dev/hlvm
└── ✅ Completely separate, no submodule, no directory nesting

Requirement #2: Available by default
├── HLVM deno.json: imports "@hlvm/hql"
├── deno compile: Downloads + bundles HQL
└── ✅ hlvm binary contains HQL, works offline

Requirement #3: Separated projects AND packages
├── Git: Two independent repositories
├── Package: @hlvm/hql on JSR registry
├── Versioning: Independent semver
└── ✅ Can be updated independently
```

### Benefits Over Alternatives

**vs. Monorepo:**
- ✅ HQL can be used standalone
- ✅ Clear separation of concerns
- ✅ Independent versioning
- ✅ Professional package management

**vs. Git Submodule:**
- ✅ No submodule complexity for contributors
- ✅ Standard Deno workflow
- ✅ Easier version management
- ✅ HQL available to anyone via JSR

### Trade-offs (Honest Assessment)

**Advantages:**
- ✅ Meets all 3 requirements
- ✅ Professional standard
- ✅ Clean separation
- ✅ Easy for users to install HQL standalone

**Disadvantages:**
- ⚠️ Slightly more complex rapid development (need local override)
- ⚠️ Need to publish to JSR for each release
- ⚠️ HLVM depends on external registry (JSR)

**Mitigation for disadvantages:**
```json
// For rapid development: deno.json local override
{
  "imports": {
    "@hlvm/hql": "../hql/mod.ts"  // Local HQL for testing
  }
}
```

---

## Final Answer

**Can all 3 requirements be met?**

✅ **YES - with JSR Package**

1. ✅ HQL outside HLVM (separate repo, no submodule)
2. ✅ Available by default (bundled via `deno compile`)
3. ✅ Separated git AND package (fully independent)

**Proof:**
- `deno compile` downloads dependencies at **compile time**
- Final binary contains all code
- Users don't need internet to run HQL

**This is the SAME architecture as:**
- Python + PyInstaller + pip packages
- Node.js + webpack + npm packages
- Rust + cargo + crates.io

---

## Alternative: If JSR doesn't work

If you absolutely cannot accept JSR (e.g., don't trust external registry), then:

**Fallback: Git Submodule** (2.5/3 requirements)
- ✅ Separate repos
- ✅ Bundled by default
- ⚠️ Partial package separation

**NOT Recommended: Monorepo** (1/3 requirements)
- Only satisfies "available by default"
- Fails separation requirements

---

**Last Updated:** 2025-11-15
**Status:** Analysis complete - JSR Package recommended
**Decision needed:** Proceed with JSR or choose fallback?
