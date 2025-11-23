# HQL Integration Decision - Updated Analysis

**Date:** 2025-11-15
**Status:** Decision in progress
**Conclusion:** JSR Package is recommended for stable HQL + clean HLVM codebase

---

## Key Terms

### Monorepo
- **Definition:** ONE repository containing MULTIPLE projects
- **Example:** `hlvm/src/hql/` (current setup)
- **Characteristics:**
  - Everything in one place
  - Shared Git history
  - Simplest to understand
  - Hard to separate later

### Git Submodule
- **Definition:** Repository CONTAINING another repository as subdirectory
- **Example:** Chrome contains V8 as submodule
- **Characteristics:**
  - TWO separate repos, nested structure
  - Each has own Git history
  - Need `--recurse-submodules` to clone
  - Industry standard for component integration

### JSR Package
- **Definition:** Published package on JSR registry, imported as dependency
- **Example:** `import from "jsr:@hlvm/hql@1.0.0"`
- **Characteristics:**
  - Separate repos, clean dependency
  - Standard package management
  - Semantic versioning
  - No nested directories

---

## Analysis

### Your Requirements

1. ✅ HQL as first-class citizen in HLVM (bundled by default)
2. ✅ Separate HQL repository (own CI/CD, releases)
3. ✅ Rapid development (edit HQL, test in HLVM)
4. ✅ Clean HLVM codebase

### HQL Status

- **Tests:** 1129 passing
- **Maturity:** Production-ready
- **Features:** 89/89 complete
- **Stability:** Stable syntax, mature transpiler
- **Change frequency:** Infrequent (monthly releases expected)

---

## Option Comparison

### Option 1: Monorepo (Current)

**Structure:**
```
hlvm/
└── src/hql/  ← HQL code in HLVM repo
```

**Scores:**
- First-class integration: ⭐⭐⭐⭐⭐ (100%)
- Clean separation: ❌ (0%)
- Rapid development: ⭐⭐⭐⭐⭐ (100%)
- Clean HLVM codebase: ⭐ (20%)

**When to use:**
- HQL is ONLY for HLVM
- Maximum simplicity priority
- Never plan to separate

### Option 2: Git Submodule

**Structure:**
```
hlvm/
├── hql/  ← Git submodule pointing to hql repo
└── src/hlvm-repl.ts
```

**Scores:**
- First-class integration: ⭐⭐⭐⭐ (90%)
- Clean separation: ⭐⭐⭐⭐⭐ (100%)
- Rapid development: ⭐⭐⭐⭐⭐ (100%)
- Clean HLVM codebase: ⭐⭐⭐ (60%)

**When to use:**
- Tight coupling between HQL and HLVM
- Frequent changes to both projects
- Need to test unreleased HQL features
- Want maximum integration + separation

### Option 3: JSR Package ⭐ **RECOMMENDED**

**Structure:**
```
hlvm/
├── deno.json
│   └── imports: "jsr:@hlvm/hql@1.0.0"
└── src/hlvm-repl.ts  ← Only HLVM code

Separate repo:
hql/  ← Published to JSR
```

**Scores:**
- First-class integration: ⭐⭐⭐⭐⭐ (100% for binary users*)
- Clean separation: ⭐⭐⭐⭐⭐ (100%)
- Rapid development: ⭐⭐⭐ (60%**)
- Clean HLVM codebase: ⭐⭐⭐⭐⭐ (100%)

*Binary users (most users) get HQL bundled - no difference from monorepo
**Can use local override for rapid dev when needed

**When to use:**
- Stable language (like HQL!)
- Clean codebase priority
- Standard package management preferred
- Binary distribution (which you have)

---

## Decision

### Recommendation: JSR Package

**Reasons:**

1. **HQL is stable**
   - 1129 tests passing
   - Production-ready
   - Changes infrequently

2. **Cleanest HLVM codebase**
   - No `src/hql/` directory
   - No submodule complexity
   - Just HLVM code
   - Easier for contributors

3. **First-class for binary users**
   - HQL bundled in HLVM binary
   - Works offline
   - No internet needed
   - Same user experience as monorepo

4. **Professional package management**
   - Semantic versioning
   - Lock files
   - Standard Deno workflow
   - Industry best practice

5. **Flexibility**
   - Users can choose HQL version
   - HLVM can upgrade independently
   - Clear dependency tree

### Trade-off: Rapid Development

**Old workflow (monorepo/submodule):**
```bash
Edit: src/hql/file.ts
Test: deno run -A mod.ts  (instant!)
```

**New workflow (JSR):**
```bash
Edit: hql/file.ts (in separate repo)
Publish: deno publish (to JSR)
Update: HLVM's deno.json
Test: deno run -A mod.ts
```

**Mitigation for rapid dev:**
```json
// deno.json (temporary local override)
{
  "imports": {
    "@hlvm/hql": "./local-hql/mod.ts"  ← Points to local HQL
  }
}
```

Switch back to JSR for releases.

**Since HQL is stable:**
- Don't edit HQL daily
- Monthly publishing is fine
- Clean codebase worth the trade-off

---

## Migration Plan (JSR)

### Step 1: Create HQL Repository
1. Create: `github.com/hlvm-dev/hql`
2. Copy: All `src/hql/*` to new repo
3. Move: `.github/workflows/hql-release.yml` to new repo
4. Update: All paths (remove `src/hql/` prefix)
5. Create: HQL-specific README

### Step 2: Publish to JSR
1. Create `jsr.json`:
   ```json
   {
     "name": "@hlvm/hql",
     "version": "1.0.0",
     "exports": "./mod.ts"
   }
   ```
2. Publish: `deno publish`
3. Verify: https://jsr.io/@hlvm/hql

### Step 3: Update HLVM
1. Update `hlvm/deno.json`:
   ```json
   {
     "imports": {
       "@hlvm/hql": "jsr:@hlvm/hql@^1.0.0"
     }
   }
   ```
2. Replace imports:
   ```typescript
   // Before
   import { ... } from "./src/hql/mod.ts"

   // After
   import { ... } from "@hlvm/hql"
   ```
3. Test HLVM
4. Remove `src/hql/` directory
5. Remove `.github/workflows/hql-release.yml`

### Step 4: Update Documentation
1. HLVM README: Mention HQL is separate package
2. HQL README: Standalone installation instructions
3. Migration guide for existing users

---

## Comparison Matrix

| Requirement | Monorepo | Submodule | JSR |
|------------|----------|-----------|-----|
| First-class by default | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐* |
| Separate repos | ❌ | ✅ | ✅ |
| HQL standalone | ❌ | ✅ | ✅ |
| Own CI/CD | ⚠️ | ✅ | ✅ |
| Rapid dev | ✅ | ✅ | ⚠️** |
| Clean codebase | ⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Standard workflow | ⚠️ | ⚠️ | ✅ |
| **TOTAL** | **6/8** | **8/8** | **9/8*** |

*For binary users (most users)
**Can use local override for rapid dev

---

## Real-World Examples

- **Deno + TypeScript:** TypeScript is separate npm package, Deno imports it
- **Node + V8:** V8 bundled, but separate project
- **Python + C extensions:** Extensions are packages, bundled in interpreter

Your case:
- **HLVM + HQL:** Like Deno + TypeScript
- HQL is separate JSR package
- HLVM imports and bundles it
- Users get complete runtime

---

## Timeline

### Week 1: Fix Current CI (Priority)
- Debug CI build issues
- Get v0.1.0 working with current structure

### Week 2: Create HQL Repository
- Set up github.com/hlvm-dev/hql
- Move HQL code
- Test HQL standalone builds

### Week 3: Publish to JSR
- Create jsr.json
- Publish first version
- Verify package works

### Week 4: Update HLVM
- Update imports to use JSR
- Test HLVM with JSR package
- Remove src/hql/ from HLVM
- Document everything

---

## Conclusion

**For your requirements (stable HQL + clean HLVM):**

→ **JSR Package is the best choice** ✅

This gives you:
- ✅ Cleanest HLVM codebase (no src/hql/)
- ✅ Separate HQL project (own repo, CI/CD, releases)
- ✅ First-class integration (bundled in binary)
- ✅ Professional package management
- ✅ Standard Deno workflow
- ⚠️ Slightly more complex rapid dev (but mitigable)

**Next step:** Fix CI build, then execute migration plan.

---

**Last Updated:** 2025-11-15
**Decision:** JSR Package recommended
**Status:** Planning phase - awaiting CI fix before migration
