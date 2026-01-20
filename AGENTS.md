# HLVM AI Agent Guidelines

Authoritative instructions for all AI agents working on this repository.

## Core Principles

1. **Run tests after meaningful changes** - `deno task test:unit`
2. **Tests must be real** - No fake tests that always pass
3. **SSOT enforcement is mandatory** - See below

## SSOT (Single Source of Truth) - MANDATORY

All code MUST use designated entry points. No scattered logic allowed.

### DRY & KISS Principles

**Every piece of logic must exist in exactly ONE place. Zero tolerance for duplication.**

#### What This Means

**1. No Scattered Logic**
- Same functionality in multiple files → **VIOLATION**
- Similar algorithms in different places → **CONSOLIDATE**
- Repeated patterns → **EXTRACT** to shared location
- Multiple implementations of the same concept → **MERGE** into one SSOT

**2. No Redundancy**
- Duplicate helper functions → **MERGE** into one canonical function
- Similar validation logic → Create **ONE** validator
- Multiple formatters (date, string, error) → **ONE** formatter per type
- Redundant type definitions → **ONE** canonical type definition
- Scattered constants → **ONE** constants module

**3. No Copy-Paste Programming**
- Copying code to reuse → **VIOLATION** (extract to shared module)
- "Similar but slightly different" → **REFACTOR** to unified implementation
- "Temporary" duplication → **NOT ALLOWED**
- Code that "almost does what I need" → **EXTEND** existing, don't duplicate

#### Requirements

**Before writing new code:**
1. Search codebase for existing implementations
2. Use existing SSOT if available
3. If none exists, create ONE canonical implementation in the appropriate SSOT domain
4. Document and export for reuse

**When finding duplication:**
1. Consolidate immediately (don't defer)
2. Extract to shared module in appropriate domain
3. Update all call sites to use the consolidated version
4. Remove all duplicate implementations
5. Add to SSOT documentation if creating new domain

**Code review checklist:**
- Verify no duplicated logic
- Check that new code doesn't replicate existing functionality
- Ensure helpers/utilities are reused, not recreated
- Confirm proper use of existing SSOT domains

#### Examples

**VIOLATION - Scattered Logic:**
```typescript
// File: src/utils/errors.ts
function formatError(e) {
  return `Error: ${e.message} at ${e.location}`
}

// File: src/handlers/api.ts
function errorString(err) {
  return `Error: ${err.message} at ${err.location}`
}

// CORRECT - One SSOT
// File: src/common/error-formatter.ts
export function formatError(e: Error) {
  return `Error: ${e.message} at ${e.location}`
}
// All other files import and use this function
```

**VIOLATION - Redundant Implementations:**
```typescript
// File A: utils/dates.ts
export function parseDate(str) { return new Date(str) }

// File B: helpers/time.ts
export function parseDateString(str) { return new Date(str) }

// File C: common/datetime.ts
export function dateFromString(str) { return new Date(str) }

// CORRECT - One implementation
// File: src/common/date-utils.ts
export function parseDate(str: string): Date {
  return new Date(str)
}
```

**VIOLATION - Copy-Paste Programming:**
```typescript
// Multiple files with identical validation
if (!value || value.trim() === "") throw new Error("Required")
if (!email.includes("@")) throw new Error("Invalid email")

// CORRECT - Shared validators
// File: src/common/validators.ts
export function validateRequired(value: string) {
  if (!value || value.trim() === "") throw new Error("Required")
}
export function validateEmail(email: string) {
  if (!email.includes("@")) throw new Error("Invalid email")
}
```

### Enforcement Boundaries

**Target: 100% compliance in ALL domains (MANDATORY)**

| Domain | SSOT Entry Point | Usage |
|--------|------------------|-------|
| **Logging** | `globalThis.log` | `log.info()`, `log.error()`, `log.debug()` |
| **HTTP** | `http.*` | `import { http } from "src/common/http-client.ts"` |
| **File I/O** | `getPlatform().fs` | `getPlatform().fs.readTextFile()`, `.writeTextFile()`, `.mkdir()`, etc. |
| **Platform I/O** | `getPlatform()` | `import { getPlatform } from "src/platform/platform.ts"` |
| **Runtime Init** | `initializeRuntime()` | `import { initializeRuntime } from "src/common/runtime-initializer.ts"` |
| **AI Operations** | `globalThis.ai` | Via `src/hlvm/api/ai.ts` |
| **Configuration** | `globalThis.config` | Via `src/hlvm/api/config.ts` |

### Forbidden Patterns

```typescript
// FORBIDDEN - Direct console usage
console.log(...)        // Use: log.info(...)
console.error(...)      // Use: log.error(...)
console.debug(...)      // Use: log.debug(...)
console.warn(...)       // Use: log.warn(...)

// FORBIDDEN - Direct fetch
fetch(url)              // Use: http.get(url), http.post(url, body)

// FORBIDDEN - File I/O bypasses
Deno.readTextFile(...)       // Use: getPlatform().fs.readTextFile(...)
Deno.writeTextFile(...)      // Use: getPlatform().fs.writeTextFile(...)
Deno.readFile(...)           // Use: getPlatform().fs.readFile(...)
Deno.writeFile(...)          // Use: getPlatform().fs.writeFile(...)
Deno.open(...)               // Use: getPlatform().fs.open(...)
Deno.readDir(...)            // Use: getPlatform().fs.readDir(...)
Deno.mkdir(...)              // Use: getPlatform().fs.mkdir(...)
Deno.remove(...)             // Use: getPlatform().fs.remove(...)
Deno.stat(...)               // Use: getPlatform().fs.stat(...)
Deno.readTextFileSync(...)   // Use: async getPlatform().fs.readTextFile(...)

// FORBIDDEN - Other direct Deno APIs
Deno.env.get(...)       // Use: getPlatform().env.get(...)
Deno.cwd(...)           // Use: getPlatform().cwd(...)

// FORBIDDEN - Direct init calls
initConfigRuntime()     // Use: initializeRuntime({ config: true })
initSessionsDir()       // Use: initializeRuntime({ sessions: true })
```

### SSOT Compliance Requirements

**100% compliance is MANDATORY in ALL domains. Zero tolerance for violations.**

1. **All new code MUST use SSOT entry points**
   - No exceptions without explicit architectural review
   - Code review will reject SSOT violations

2. **No regressions allowed**
   - Do not introduce new violations
   - Do not increase violation count in any domain
   - Regressions will be reverted immediately

3. **Progressive improvement required**
   - When touching existing code, migrate to SSOT patterns
   - Reduce violation count with each change
   - Target: All domains at 100% compliance

4. **Validation is mandatory**
   - `deno task ssot:check` must pass with 0 errors
   - `deno task test:unit` must pass all tests
   - Both checks required before commit

### Validation

**MANDATORY before every commit:**
```bash
deno task ssot:check    # Must pass with 0 errors
deno task test:unit     # Must pass all tests
```

### Migration Guide

When fixing SSOT violations, follow these patterns:

**Logging Migration:**
```typescript
// BEFORE (violation)
console.log("User logged in:", userId);
console.error("Failed to load config");

// AFTER (SSOT compliant)
log.info("User logged in:", userId);
log.error("Failed to load config");
```

**File I/O Migration:**
```typescript
// BEFORE (violation)
const content = await Deno.readTextFile(filePath);
await Deno.writeTextFile(filePath, data);
await Deno.mkdir(dirPath, { recursive: true });

// AFTER (SSOT compliant)
const platform = getPlatform();
const content = await platform.fs.readTextFile(filePath);
await platform.fs.writeTextFile(filePath, data);
await platform.fs.mkdir(dirPath, { recursive: true });
```

**HTTP Migration:**
```typescript
// BEFORE (violation)
const response = await fetch(url);
const data = await response.json();

// AFTER (SSOT compliant)
const data = await http.get(url);
```

**Platform APIs Migration:**
```typescript
// BEFORE (violation)
const envVar = Deno.env.get("API_KEY");
const currentDir = Deno.cwd();

// AFTER (SSOT compliant)
const platform = getPlatform();
const envVar = platform.env.get("API_KEY");
const currentDir = platform.cwd();
```

### Documentation

Full SSOT contract: `docs/SSOT-CONTRACT.md`
