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
| **Bindings** | `globalThis.bindings` | `src/hlvm/api/bindings.ts` | None |
| **History** | `globalThis.history` | `src/hlvm/api/history.ts` | None |
| **Local Fallback Substrate** | `materializeBootstrap()` + `verifyBootstrap()` | `src/hlvm/runtime/bootstrap-*.ts` | None |
| **Runtime Host Lifecycle** | `ensureRuntimeHost()` + `serveCommand()` | `src/hlvm/runtime/host-client.ts`, `src/hlvm/cli/commands/serve.ts` | None |
| **MCP Discovery + Registration** | `loadMcpConfigMultiScope()` + session `ensureMcpLoaded()` | `src/hlvm/agent/mcp/config.ts`, `src/hlvm/agent/session.ts` | None |
| **Skills Discovery + Prompting** | `loadSkillSnapshot()` + `formatSkillsForPrompt()` + `readSkillBody()` | `src/hlvm/agent/skills/store.ts`, `src/hlvm/agent/skills/prompt.ts` | None |
| **Channel Runtime** | `createChannelRuntime()` | `src/hlvm/channels/core/runtime.ts` | None |
| **Channel Vendor Contracts** | `ChannelTransport`, `ChannelProvisioner`, `ChannelSetupSession` | `src/hlvm/channels/core/types.ts` | None |
| **Channel Wiring** | `channelRuntime` (transport factory registry) | `src/hlvm/channels/registry.ts` | None |

## Skills Architecture

Skills are prompt-side procedural knowledge. A skill is not a tool, not memory,
not MCP, and not an executable plugin. Skill files can guide real work, but the
agent still performs that work only through the normal agent loop and existing
tool safety.

The long-term skills system is layered. The core discovery/prompting substrate
comes first and remains the required foundation for all higher-level surfaces:
CLI authoring, slash invocation, bundled skills, skill packs, distribution,
policy, and user-reviewed skill generation. Higher layers may add UX or sources,
but they must not bypass the core store/prompt boundary.

```
skill roots
  ~/.hlvm/skills/*/SKILL.md
  <cwd>/.hlvm/skills/*/SKILL.md
  bundled skills, if packaged
    → loadSkillSnapshot()        ← scan frontmatter only
      → formatSkillsForPrompt()  ← compact <available_skills> XML
        → orchestrator context   ← one Pre-LLM injection hook
          → model reads SKILL.md through normal read tools when useful
            → model uses normal tools for edits/commands
```

### Skills SSOT files

| File | Responsibility |
|------|----------------|
| `src/common/paths.ts` | Canonical skills root paths: user, project, and bundled path helpers. |
| `src/hlvm/agent/skills/types.ts` | Skill data contracts: source, index entry, snapshot, duplicate/shadow metadata. |
| `src/hlvm/agent/skills/store.ts` | Root scanning, frontmatter parsing, validation, precedence, duplicate handling, body reads. |
| `src/hlvm/agent/skills/prompt.ts` | XML serialization and prompt-budget formatting. |
| `src/hlvm/cli/commands/skill.ts` | Local CLI surface: `list`, `new`, `info`, optional `edit`. |
| `src/hlvm/cli/repl/commands.ts` | Dynamic `/skill-name` command resolution only; no skill storage logic. |
| `src/hlvm/agent/orchestrator.ts` | Calls the skills prompt hook; does not scan roots directly. |

### Forbidden in skills modules

- Executing skill scripts during discovery or prompt injection
- Adding a new skill-specific script execution path
- Treating skills as MCP tools or registering them in the tool registry
- Writing skills into memory or reading memory as a skills source
- Calling providers, `fetch()`, or runtime endpoints from skills loading code
- Reading/writing files outside `getPlatform()` and `src/common/paths.ts`
- Adding registry/install/update behavior inside the core store/prompt layer
- Adding env/secrets/config injection without a dedicated SSOT update
- Adding hot-reload watchers, recurring timers, or background reconciliation loops

### Skill layers

All future skills work should fit one of these layers:

| Layer | Responsibility | SSOT requirement |
|-------|----------------|------------------|
| Core substrate | Discover `SKILL.md`, parse frontmatter, resolve precedence, format prompt index, read body | Must live in `src/hlvm/agent/skills/` |
| Local UX | `hlvm skill ...`, REPL slash activation, completion/catalog display | Must call the core substrate |
| Bundled skills | Foundational built-in `SKILL.md` folders | Must be exposed as a source to the core substrate |
| Skill packs | Optional domain packs such as browser, GitHub, release, or messaging workflows | Must be plain skills or explicitly documented package sources |
| Distribution | Install/search/update/remove from Git, paths, archives, or a registry | Requires a new SSOT entry before implementation |
| Policy and safety | Dependency checks, dangerous-code scans, allowlists, per-agent scoping | Requires a new SSOT entry before implementation |
| Assisted authoring | User-reviewed skill suggestions or workflow-to-skill drafts | Requires a new SSOT entry before implementation |

### Adding or expanding skill support

The first implementation should use only these integration points:

1. Add canonical path helpers in `src/common/paths.ts`.
2. Add the `src/hlvm/agent/skills/` subsystem.
3. Add one orchestrator hook that injects the compact skills index.
4. Add `hlvm skill ...` CLI commands.
5. Add REPL slash-command routing to resolve `/skill-name`.

Everything else must remain in its current SSOT: tools execute tools, MCP loads
MCP servers, memory stores memories, and providers call models.

If a later phase adds distribution, policy, installers, generated skills, or
another source of skills, update this contract first with the new SSOT entry and
its allowed boundaries.

## Channel Architecture

All inbound messages from any chat vendor flow through a single enforced pipeline.
No vendor transport can reach the HLVM brain directly.

```
vendor transport.receive(ChannelMessage)
  → runtime.handleInboundMessage()    ← allowlist check (runtime.ts)
    → queue.run(sessionId, ...)       ← per-session serialization (queue.ts)
      → runQuery()                    ← one brain entry point (host-client.ts)
    → transport.send(ChannelReply)    ← reply via same transport
```

### Adding a new vendor (e.g. Slack)

Provide exactly two implementations and two wiring lines:

| File | What to implement |
|------|-------------------|
| `src/hlvm/channels/slack/transport.ts` | `ChannelTransport` — start/stop/send/receive |
| `src/hlvm/channels/slack/provisioning.ts` | `ChannelProvisioner` — createSession/completeSession |
| `src/hlvm/channels/slack/protocol.ts` | `SlackSetupSession extends ChannelSetupSession` |

Wire in:
- `src/hlvm/channels/registry.ts` — add `slack: createSlackTransport`
- `src/hlvm/cli/repl/handlers/channels/provisioning.ts` — add `"slack"` dispatch entry

Everything else (allowlist, queue, pairing, runQuery, config writeback, HTTP routes) is
reused automatically. No other files need to change.

### Forbidden in vendor transport modules

- Calling `runQuery` or `runChatViaHost` directly
- Importing from `src/hlvm/runtime/host-client.ts`
- Writing to config outside `context.updateConfig()`
- Bypassing `context.receive()` to handle messages inline

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
import { http } from "../common/http-client.ts"//
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
import { getPlatform } from "../platform/platform.ts"//
const platform = getPlatform()//
await platform.fs.readTextFile(...)
await platform.fs.writeTextFile(...)
platform.env.get(...)
```

### 4. Raw Error Throws
```typescript
// DISCOURAGED - use typed errors when possible
throw new Error("Something went wrong")//

// PREFERRED
import { ValidationError, RuntimeError } from "../common/error.ts"//
throw new ValidationError("Invalid pattern", { line, column })//
throw new RuntimeError("Operation failed")//

// ALLOWED - JS semantic errors
throw new TypeError("Expected string")//
throw new RangeError("Index out of bounds")//
```

### 5. Direct Init Calls
```typescript
// FORBIDDEN - bypasses unified initialization
// Direct init helpers are not allowed. Use initializeRuntime instead.

// USE INSTEAD
import { initializeRuntime } from "../common/runtime-initializer.ts"//
await initializeRuntime()//
// Or with options:
await initializeRuntime({ ai: false })//
```

## Allowed Bypasses

Some patterns are explicitly allowed in specific contexts:

| Pattern | Allowed In | Reason |
|---------|-----------|--------|
| `console.*` | `src/logger.ts`, `src/hlvm/api/log.ts` | Internal implementation |
| `console.*` | CONSOLE_ALLOWLIST files (see below) | Technical requirements |
| `(console.log ...)` | HQL code examples in strings | S-expression syntax |
| `fetch()` | `src/hlvm/providers/*` | Provider-specific HTTP needs |
| `fetch()` | `src/hql/lib/stdlib/js/*` | Stdlib utility code |
| `fetch()` | `embedded-packages/*` | Third-party code |
| `Deno.*` | `src/platform/deno-platform.ts` | Platform implementation |
| `throw new Error` | Test files (`*.test.ts`) | Test assertions |
| `throw new Error` | RAW_ERROR_ALLOWLIST files (see below) | Technical requirements |
| `throw new TypeError` | Anywhere | JS semantic correctness |
| `throw new RangeError` | Anywhere | JS semantic correctness |

### CONSOLE_ALLOWLIST (Permanent Exceptions)

These files have legitimate technical reasons for direct console access:

| File | Reason |
|------|--------|
| `src/common/known-identifiers.ts` | Bootstrap guard (`typeof console !== "undefined"`) |
| `src/common/runtime-error-handler.ts` | Crash handler hooks `console.error` |
| `src/common/runtime-helper-impl.ts` | Stringified runtime code (cannot use imports) |
| `src/hql/transpiler/pipeline/source-map-support.ts` | Technical stack-mapping implementation |

### RAW_ERROR_ALLOWLIST (Permanent Exceptions)

These files cannot use typed errors from `src/common/error.ts` due to architectural constraints:

| File/Path | Reason |
|-----------|--------|
| `src/common/utils.ts` | Circular dependency: error.ts → logger.ts → utils.ts |
| `src/platform/deno-platform.ts` | Circular dependency: error.ts → logger.ts → utils.ts → platform.ts |
| `src/hql/lib/stdlib/js/` | Pure JavaScript runtime files (cannot use TypeScript types) |
| `src/hql/embedded-packages.ts` | Embedded JS code in string literals |
| `src/hql/transpiler/pipeline/source-map-support.ts` | JSDoc examples |
| `src/hql/transpiler/syntax/function.ts` | JSDoc examples |

**Circular Dependency Explanation:**
```
error.ts imports logger.ts
  → logger.ts imports utils.ts (for getErrorMessage)
    → utils.ts imports platform.ts (for getPlatform)
      → platform.ts imports deno-platform.ts
```
If any file in this chain imports from `error.ts`, it creates a circular dependency causing:
```
ReferenceError: Cannot access 'logger' before initialization
```

### API Layer (globalThis)

These files have legitimate technical reasons for direct console access:

| File | Reason |
|------|--------|
| `src/common/known-identifiers.ts` | Bootstrap guard (`typeof console !== "undefined"`) |
| `src/common/runtime-error-handler.ts` | Crash handler hooks `console.error` |
| `src/common/runtime-helper-impl.ts` | Stringified runtime code (cannot use imports) |
| `src/hql/transpiler/pipeline/source-map-support.ts` | Technical stack-mapping implementation |

## API Layer (globalThis)

All REPL-accessible APIs are registered on `globalThis`:

```typescript
globalThis.ai       // AI operations (chat, complete, etc.)
globalThis.config   // Configuration management
globalThis.session  // Session management
globalThis.bindings // Persistent definitions
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
- `console.*` outside allowed files and CONSOLE_ALLOWLIST
- `fetch(` outside allowed locations (providers, stdlib, http-client)
- `Deno.*` outside platform layer
- `throw new Error(` (warning level)

### CI Integration

**GitHub Actions:**
- `lint` job includes SSOT check step
- **Strict enforcement enabled** - violations block CI
- Managed via CONSOLE_ALLOWLIST in `scripts/ssot-check.ts`

### Adding New SSOT Domains

When adding a new domain:
1. Create the SSOT implementation file
2. Export through the domain's intended module boundary
3. Register on `globalThis` in `registerApis()` only for REPL-accessible APIs
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
│  ║  .ai    .config  .session  .bindings  .history  .log  .errors  ║   │
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
| 2026-04-23 | Added channel runtime, vendor contracts, and multi-vendor extension rules |
| 2026-04-24 | Added skills discovery, prompting, and execution-boundary rules |
