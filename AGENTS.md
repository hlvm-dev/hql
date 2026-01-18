# HLVM AI Agent Guidelines

Authoritative instructions for all AI agents working on this repository.

## Core Principles

1. **Run tests after meaningful changes** - `deno task test:unit`
2. **Tests must be real** - No fake tests that always pass
3. **SSOT enforcement is mandatory** - See below

## SSOT (Single Source of Truth) - MANDATORY

All code MUST use designated entry points. No scattered logic allowed.

### Enforcement Boundaries

| Domain | SSOT Entry Point | Usage |
|--------|------------------|-------|
| **Logging** | `globalThis.log` | `log.info()`, `log.error()`, `log.debug()` |
| **HTTP** | `http.*` | `import { http } from "src/common/http-client.ts"` |
| **Platform I/O** | `getPlatform()` | `import { getPlatform } from "src/platform/platform.ts"` |
| **Runtime Init** | `initializeRuntime()` | `import { initializeRuntime } from "src/common/runtime-initializer.ts"` |
| **AI Operations** | `globalThis.ai` | Via `src/hlvm/api/ai.ts` |
| **Configuration** | `globalThis.config` | Via `src/hlvm/api/config.ts` |

### Forbidden Patterns

```typescript
// FORBIDDEN - Direct console usage
console.log(...)        // Use: log.info(...)
console.error(...)      // Use: log.error(...)

// FORBIDDEN - Direct fetch
fetch(url)              // Use: http.get(url), http.post(url, body)

// FORBIDDEN - Direct Deno APIs
Deno.readTextFile(...)  // Use: getPlatform().fs.readTextFile(...)
Deno.env.get(...)       // Use: getPlatform().env.get(...)

// FORBIDDEN - Direct init calls
initConfigRuntime()     // Use: initializeRuntime({ config: true })
initSessionsDir()       // Use: initializeRuntime({ sessions: true })
```

### Validation

Before committing, run:
```bash
deno task ssot:check    # Must pass with 0 errors
deno task test:unit     # Must pass all tests
```

### Documentation

Full SSOT contract: `docs/SSOT-CONTRACT.md`
