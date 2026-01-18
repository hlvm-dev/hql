# SSOT (Single Source of Truth) Contract

This document defines the architectural boundaries and enforcement rules for maintaining
Single Source of Truth across the HLVM codebase.

## Overview

SSOT ensures that each domain has exactly one authoritative source for its functionality.
This prevents fragmentation, simplifies maintenance, and enables consistent behavior.

## Boundaries

| Domain | SSOT Entry Point | Location | Allowed Bypasses |
|--------|------------------|----------|------------------|
| **Logging** | `globalThis.log` | `src/hlvm/api/log.ts` | `log.raw.*` for CLI output |
| **Runtime Init** | `initializeRuntime()` | `src/common/runtime-initializer.ts` | None |
| **HTTP Client** | `http.*` | `src/common/http-client.ts` | `providers/*` (provider-internal) |
| **Errors** | Typed errors | `src/common/error.ts` | `TypeError`, `RangeError`, `SyntaxError` (JS semantics) |
| **Platform I/O** | `getPlatform()` | `src/platform/platform.ts` | None |
| **AI Operations** | `globalThis.ai` | `src/hlvm/api/ai.ts` | None |
| **Configuration** | `globalThis.config` | `src/hlvm/api/config.ts` | None |
| **Sessions** | `globalThis.session` | `src/hlvm/api/session.ts` | None |
| **Memory** | `globalThis.memory` | `src/hlvm/api/memory.ts` | None |
| **History** | `globalThis.history` | `src/hlvm/api/history.ts` | None |

## Forbidden Patterns

These patterns are prohibited outside their designated SSOT locations:

### 1. Console Usage
```typescript
// FORBIDDEN outside logger.ts and log.ts
console.log(...)
console.error(...)
console.warn(...)
console.debug(...)

// USE INSTEAD
log.info(...)       // Diagnostic logging
log.raw.log(...)    // Intentional CLI output
```

### 2. Direct Fetch
```typescript
// FORBIDDEN outside http-client.ts and providers/
await fetch(url, ...)

// USE INSTEAD
import { http } from "../common/http-client.ts";
await http.get(url, options)
await http.post(url, body, options)
```

### 3. Deno APIs
```typescript
// FORBIDDEN outside src/platform/
Deno.readTextFile(...)
Deno.writeTextFile(...)
Deno.env.get(...)

// USE INSTEAD
import { getPlatform } from "../platform/platform.ts";
const platform = getPlatform();
await platform.fs.readTextFile(...)
await platform.fs.writeTextFile(...)
platform.env.get(...)
```

### 4. Raw Error Throws
```typescript
// DISCOURAGED - use typed errors when possible
throw new Error("Something went wrong");

// PREFERRED
import { ValidationError, RuntimeError } from "../common/error.ts";
throw new ValidationError("Invalid pattern", { line, column });
throw new RuntimeError("Operation failed");

// ALLOWED - JS semantic errors
throw new TypeError("Expected string");
throw new RangeError("Index out of bounds");
```

### 5. Direct Init Calls
```typescript
// FORBIDDEN - bypasses unified initialization
import { initConfigRuntime } from "../common/config/runtime.ts";
await initConfigRuntime();

// USE INSTEAD
import { initializeRuntime } from "../common/runtime-initializer.ts";
await initializeRuntime();
// Or with options:
await initializeRuntime({ ai: false });
```

## Allowed Bypasses

Some patterns are explicitly allowed in specific contexts:

| Pattern | Allowed In | Reason |
|---------|-----------|--------|
| `console.*` | `src/logger.ts`, `src/hlvm/api/log.ts` | Internal implementation |
| `fetch()` | `src/hlvm/providers/*` | Provider-specific HTTP needs |
| `fetch()` | `embedded-packages/*` | Third-party code |
| `Deno.*` | `src/platform/deno-platform.ts` | Platform implementation |
| `throw new Error` | Test files (`*.test.ts`) | Test assertions |
| `throw new TypeError` | Anywhere | JS semantic correctness |
| `throw new RangeError` | Anywhere | JS semantic correctness |

## API Layer (globalThis)

All REPL-accessible APIs are registered on `globalThis`:

```typescript
globalThis.ai       // AI operations (chat, complete, etc.)
globalThis.config   // Configuration management
globalThis.session  // Session management
globalThis.memory   // Persistent memory
globalThis.history  // Command history
globalThis.log      // Logging API
globalThis.errors   // Error factory
globalThis.runtime  // Runtime utilities
```

## Enforcement

### Automated Checks

Run SSOT validation:
```bash
deno task ssot:check
```

This checks for:
- `console.*` outside allowed files
- `await fetch(` outside allowed locations
- `Deno.*` outside platform layer
- `throw new Error(` (warning level)

### CI Integration

**GitHub Actions:**
- `lint` job includes SSOT check step
- Currently in warning mode (`continue-on-error: true`)
- Will become blocking once violations are fixed

**Local Pre-commit Hook:**
```bash
# Install the pre-commit hook
./scripts/install-hooks.sh
```

The hook runs `ssot:check` before each commit and warns about violations.

### Adding New SSOT Domains

When adding a new domain:
1. Create the SSOT implementation file
2. Export via `src/hlvm/api/index.ts`
3. Register on `globalThis` in `registerApis()`
4. Update this contract document
5. Add guardrail rules to `scripts/ssot-check.ts`

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SSOT ENFORCEMENT LAYER                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │ Pre-commit Hook │  │ CI/CD Pipeline  │  │ This Contract   │         │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘         │
│           └────────────────────┼────────────────────┘                   │
│                                ▼                                        │
│  ╔═════════════════════════════════════════════════════════════════╗   │
│  ║                    SSOT API LAYER (globalThis)                  ║   │
│  ║  .ai      .config   .session  .memory  .history  .log  .errors  ║   │
│  ╚═════════════════════════════════════════════════════════════════╝   │
│                                │                                        │
│           ┌────────────────────┼────────────────────┐                   │
│           ▼                    ▼                    ▼                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │   Providers     │  │   HTTP Client   │  │    Platform     │         │
│  │ (Allowed Bypass)│  │     (SSOT)      │  │     (SSOT)      │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Revision History

| Date | Change |
|------|--------|
| 2025-01-19 | Initial contract created |
