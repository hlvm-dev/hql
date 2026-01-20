# HLVM AI Agent Guidelines

Authoritative instructions for all AI agents working on this repository.

## Core Principles

1. **Run tests after meaningful changes** - `deno task test:unit`
2. **Tests must be real** - No fake tests that always pass
3. **SSOT enforcement is mandatory** - See below

## SSOT (Single Source of Truth) - MANDATORY

All code MUST use designated entry points. No scattered logic allowed.

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
