# HQL Separation Plan

**Date:** 2025-11-15
**Status:** Planning / Not Yet Implemented
**Goal:** Separate HQL into its own repository while maintaining integration with HLVM

---

## Current Situation

```
hlvm/ (single repository)
├── src/
│   ├── hql/              ← HQL subproject (1129 tests, production-ready)
│   ├── hlvm-repl.ts      ← HLVM runtime
│   └── stdlib/           ← HLVM standard library
└── .github/workflows/
    ├── ci.yml            ← HLVM CI
    └── hql-release.yml   ← HQL CI (builds HQL binaries)
```

**Problems:**
- Two separate projects in one repo
- Confusing for contributors
- Can't install HQL standalone easily
- Mixed CI/CD for two projects
- Unclear versioning (HQL v0.1.0 vs HLVM v0.1.0)

---

## Desired State

```
Repository 1: hlvm-dev/hql (NEW)
├── core/
├── scripts/
├── tests/
├── .github/workflows/release.yml
└── mod.ts

Repository 2: hlvm-dev/hlvm (CLEANED)
├── src/
│   ├── hlvm-repl.ts
│   └── stdlib/
├── .github/workflows/ci.yml
└── mod.ts
```

**Benefits:**
- Clear separation
- Independent versioning
- HQL can be used standalone
- Cleaner contribution model
- Professional project structure

---

## Integration Options

### Option 1: Git Submodules

HLVM includes HQL as a Git submodule.

**Pros:**
- Tight development integration
- Version pinning
- Can develop both together

**Cons:**
- More complex for contributors
- Need to init/update submodules
- CI needs special handling

### Option 2: JSR Package ⭐ **RECOMMENDED**

Publish HQL to JSR registry, HLVM imports it.

```javascript
// HLVM's deno.json
{
  "imports": {
    "@hlvm/hql": "jsr:@hlvm/hql@^1.0.0"
  }
}

// HLVM code
import { transpile } from "@hlvm/hql";
```

**Pros:**
- Standard package management
- Easy for users
- Clean dependency management
- HQL available for anyone to use
- Semantic versioning

**Cons:**
- Need to publish on each release
- Small delay for HLVM to get updates

### Option 3: Hybrid (Submodule + JSR)

Use submodule for development, JSR for production.

**Pros:**
- Best of both worlds
- Easy development
- Clean releases

**Cons:**
- More complex setup
- Need to maintain both paths

---

## Migration Steps

### Step 1: Create HQL Repository

1. Create new repo: `github.com/hlvm-dev/hql`
2. Copy `hlvm/src/hql/*` to new repo
3. Move `.github/workflows/hql-release.yml` to new repo
4. Update all paths (remove `src/hql/` prefix)
5. Create HQL-specific README.md
6. Test build locally

### Step 2: Publish to JSR

1. Create `jsr.json`:
   ```json
   {
     "name": "@hlvm/hql",
     "version": "1.0.0",
     "exports": "./mod.ts"
   }
   ```

2. Publish:
   ```bash
   deno publish
   ```

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

4. Remove `hlvm/src/hql/` directory

5. Remove `hlvm/.github/workflows/hql-release.yml`

### Step 4: Update Documentation

1. Update HLVM README:
   - Mention HQL is separate project
   - Link to HQL repo

2. Update HQL README:
   - Standalone project description
   - Installation instructions
   - Links to HLVM

3. Create migration guide for existing users

### Step 5: Announce

1. GitHub release notes
2. Update documentation sites
3. Social media announcement

---

## Timeline Suggestion

### Week 1: Fix Current CI
- Debug current build issues
- Get v0.1.0 working with current structure
- Understand pain points

### Week 2: Plan Migration
- Review this plan
- Decide on integration strategy
- Prepare documentation

### Week 3: Execute Migration
- Create HQL repo
- Publish to JSR
- Update HLVM imports
- Test everything

### Week 4: Cleanup
- Remove old code
- Update documentation
- Announce separation

---

## Comparison Matrix

| Feature | Current | Submodule | JSR Package | Hybrid |
|---------|---------|-----------|-------------|--------|
| Separation | ❌ | ✅ | ✅ | ✅ |
| Independent releases | ❌ | ✅ | ✅ | ✅ |
| Easy for users | ⚠️ | ⚠️ | ✅ | ✅ |
| HQL standalone | ❌ | ⚠️ | ✅ | ✅ |
| Dev integration | ✅ | ✅ | ⚠️ | ✅ |
| Version pinning | ❌ | ✅ | ✅ | ✅ |
| CI complexity | ⚠️ | ⚠️ | ✅ | ⚠️ |
| Package management | ❌ | ❌ | ✅ | ✅ |

---

## FAQs

### Will this break existing HLVM users?
No. The import change is internal to HLVM. Users don't see it.

### Can HLVM still use latest HQL features?
Yes! Publish new HQL version, update HLVM's import version.

### What if I'm developing both at same time?
Use Option 3 (Hybrid) - submodule for development, JSR for releases.

### How often do I publish to JSR?
Only when you release HQL. Could be weekly, monthly, or as needed.

### Will the CI issue be fixed?
Yes! Separate repo = simpler paths, easier CI configuration.

---

## Recommendation

**Start with Option 2 (JSR Package)**

Reasons:
1. HQL is production-ready (1129 tests passing)
2. Simplest for users
3. Standard package management
4. Can upgrade to Option 3 later if needed
5. JSR is built for Deno (perfect fit)

---

## Next Steps

1. **Immediate:** Fix current CI build (debug version running)
2. **This week:** Get v0.1.0 working
3. **Next week:** Create HQL repo, publish to JSR
4. **Following week:** Update HLVM, cleanup, announce

---

**Status:** Planning phase - no changes made yet
**Decision needed:** Choose integration strategy
**Ready to execute:** When current CI issues are resolved
