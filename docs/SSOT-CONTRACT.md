# SSOT (Single Source of Truth) Contract

This document defines the architectural boundaries and enforcement rules for
maintaining Single Source of Truth across the HLVM codebase.

## Overview

SSOT ensures that each domain has exactly one authoritative source for its
functionality. This prevents fragmentation, simplifies maintenance, and enables
consistent behavior.

## Boundaries

| Domain                            | SSOT Entry Point                                                                                                                                                                | Location                                                            | Allowed Bypasses                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| **Logging**                       | `globalThis.log`                                                                                                                                                                | `src/hlvm/api/log.ts`                                               | `log.raw.*` for CLI output                              |
| **Runtime Init**                  | `initializeRuntime()`                                                                                                                                                           | `src/common/runtime-initializer.ts`                                 | None                                                    |
| **HTTP Client**                   | `http.*`                                                                                                                                                                        | `src/common/http-client.ts`                                         | `providers/*` (provider-internal)                       |
| **Errors**                        | Typed errors                                                                                                                                                                    | `src/common/error.ts`                                               | `TypeError`, `RangeError`, `SyntaxError` (JS semantics) |
| **Platform I/O**                  | `getPlatform()`                                                                                                                                                                 | `src/platform/platform.ts`                                          | None                                                    |
| **AI Operations**                 | `globalThis.ai`                                                                                                                                                                 | `src/hlvm/api/ai.ts`                                                | None                                                    |
| **Configuration**                 | `globalThis.config`                                                                                                                                                             | `src/hlvm/api/config.ts`                                            | None                                                    |
| **Sessions**                      | `globalThis.session`                                                                                                                                                            | `src/hlvm/api/session.ts`                                           | None                                                    |
| **Bindings**                      | `globalThis.bindings`                                                                                                                                                           | `src/hlvm/api/bindings.ts`                                          | None                                                    |
| **History**                       | `globalThis.history`                                                                                                                                                            | `src/hlvm/api/history.ts`                                           | None                                                    |
| **Local Fallback Substrate**      | `materializeBootstrap()` + `verifyBootstrap()`                                                                                                                                  | `src/hlvm/runtime/bootstrap-*.ts`                                   | None                                                    |
| **Runtime Host Lifecycle**        | `ensureRuntimeHost()` + `serveCommand()`                                                                                                                                        | `src/hlvm/runtime/host-client.ts`, `src/hlvm/cli/commands/serve.ts` | None                                                    |
| **MCP Discovery + Registration**  | `loadMcpConfigMultiScope()` + session `ensureMcpLoaded()`                                                                                                                       | `src/hlvm/agent/mcp/config.ts`, `src/hlvm/agent/session.ts`         | None                                                    |
| **Global Assistant Instructions** | `loadHlvmInstructionsSystemMessage()`                                                                                                                                           | `src/hlvm/agent/global-instructions.ts`                             | None                                                    |
| **Skills Discovery + Prompting**  | `loadSkillSnapshot()` + `formatSkillsForPrompt()` + `readSkillBody()`                                                                                                           | `src/hlvm/agent/skills/store.ts`, `src/hlvm/agent/skills/prompt.ts` | None                                                    |
| **Skills Distribution/Lifecycle** | `createUserSkill()` + `draftUserSkill()` + `writeAuthoredSkillContent()` + `importSkillPath()` + `installSkillFromGit()` + `removeSkill()` + `updateSkills()` + `checkSkills()` | `src/hlvm/agent/skills/install.ts`                                  | None                                                    |
| **Skills Assisted Authoring**     | `buildAiSkillDraftPrompt()` + `buildAiSkillImprovePrompt()` + `normalizeAuthoredSkillContent()`                                                                                 | `src/hlvm/agent/skills/authoring.ts`                                | None                                                    |
| **Skills Repository**             | `searchSkillRepository()` + `installSkillFromRepositorySlug()` + `publishSkillToRepository()`                                                                                   | `src/hlvm/agent/skills/repository.ts`                               | None                                                    |
| **Channel Runtime**               | `createChannelRuntime()`                                                                                                                                                        | `src/hlvm/channels/core/runtime.ts`                                 | None                                                    |
| **Channel Vendor Contracts**      | `ChannelTransport`, `ChannelProvisioner`, `ChannelSetupSession`                                                                                                                 | `src/hlvm/channels/core/types.ts`                                   | None                                                    |
| **Channel Wiring**                | `channelRuntime` (transport factory registry)                                                                                                                                   | `src/hlvm/channels/registry.ts`                                     | None                                                    |

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
  ~/.hlvm/.runtime/bundled-skills/*/SKILL.md
      → loadSkillSnapshot()        ← scan capped, non-symlink frontmatter only
      → formatSkillsForPrompt()  ← compact <available_skills> XML
        → orchestrator context   ← one refreshed Pre-LLM injection hook
          → model reads SKILL.md through normal read tools when useful
            → model uses normal tools for edits/commands

user-triggered distribution
  path/Git/GitHub source
      → install.ts                 ← stage, validate, reject symlinks/oversize
      → ~/.hlvm/skills/<name>      ← global user root only
      → .hlvm/origin.json          ← source/ref/hash provenance for update/check

official repository lifecycle
  github.com/hlvm-dev/skills       ← static GitHub repo, no custom server
      → index.json                 ← curated metadata, source, version, license
      → repository.ts              ← search/install-by-slug + publish package boundary
      → install.ts                 ← final validated copy into user root

explicit assisted authoring
  hlvm skill draft <name> <goal> [--ai]
  hlvm skill improve <name> <instruction> [--save]
      → authoring.ts               ← AI prompt construction + output normalization
      → install.ts                 ← final authored write into user root

PR-ready publishing
  hlvm skill publish <name> --repo <path>
      → repository.ts              ← copy skill tree + update static index
      → github.com/hlvm-dev/skills ← normal PR/CI review path
```

### Skills SSOT files

| File                                  | Responsibility                                                                                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/common/paths.ts`                 | Canonical skills root paths: global user and bundled path helpers.                                                                                                                                          |
| `src/hlvm/agent/skills/bundled.ts`    | Embedded foundational bundled skill content and materialization to the bundled runtime root.                                                                                                                |
| `src/hlvm/agent/skills/types.ts`      | Skill data contracts: source, index entry, snapshot, duplicate metadata.                                                                                                                                    |
| `src/hlvm/agent/skills/store.ts`      | Root scanning, official agentskills.io frontmatter parsing, validation, precedence, duplicate handling, short-lived snapshot cache, symlink/size hardening, body reads.                                     |
| `src/hlvm/agent/skills/install.ts`    | User-triggered skill lifecycle: scaffold, deterministic draft write, local folder/pack import, Git/GitHub clone, staging, validation, origin metadata, update, remove, check, global user-root writes only. |
| `src/hlvm/agent/skills/authoring.ts`  | Explicit AI-assisted authoring: build draft/improve prompts, normalize model output into valid `SKILL.md`, reject invalid/oversized/empty generated skills.                                                 |
| `src/hlvm/agent/skills/repository.ts` | Official static index lifecycle: search metadata, inspect remote entries, resolve repository slugs to install sources, and package user skills into PR-ready `skills/<name>/SKILL.md` + `index.json`.       |
| `src/hlvm/agent/skills/activation.ts` | Shared explicit `/skill-name args` activation for REPL and `hlvm ask`; no special executor.                                                                                                                 |
| `src/hlvm/agent/skills/prompt.ts`     | XML serialization and prompt-budget formatting.                                                                                                                                                             |
| `src/hlvm/agent/skills/reserved.ts`   | Skill names reserved by built-in slash commands.                                                                                                                                                            |
| `src/hlvm/cli/commands/skill.ts`      | CLI surface: parse arguments and print results for `list`, `new`, `draft`, `improve`, `publish`, `search`, `info`, `import`, `install`, `update`, `remove`, and `check`; no skill storage logic.            |
| `src/hlvm/cli/repl/commands.ts`       | Dynamic `/skill-name` command resolution only; no skill storage logic.                                                                                                                                      |
| `src/hlvm/agent/orchestrator.ts`      | Calls the skills prompt hook; does not scan roots directly.                                                                                                                                                 |

### Forbidden in skills modules

- Executing skill scripts during discovery or prompt injection
- Adding a new skill-specific script execution path
- Treating skills as MCP tools or registering them in the tool registry
- Writing skills into memory or reading memory as a skills source
- Calling providers, `fetch()`, or runtime endpoints from skills loading code
- Reading/writing files outside `getPlatform()` and `src/common/paths.ts`
- Adding registry/install/update behavior inside the core store/prompt layer
- Adding installed-skill writes, update, remove, or check behavior outside
  `src/hlvm/agent/skills/install.ts`
- Adding repository search/slug resolution outside
  `src/hlvm/agent/skills/repository.ts`
- Making broad GitHub code search the primary skill search/install source
- Adding a custom hosted registry server, database, account system, or paid
  backend path without a dedicated product and SSOT decision
- Adding env/secrets/config injection without a dedicated SSOT update
- Adding hot-reload watchers, recurring timers, or background reconciliation
  loops
- Loading CWD-local, project-local, or walk-up skill roots in the foundation cut

### Official skill repository decision

HLVM's first central skill repository is a normal GitHub repository, not a
custom hosted app store. Canonical location: `github.com/hlvm-dev/skills`.

The repository is the source of truth for public discovery metadata:

```
github.com/hlvm-dev/skills
  index.json              ← skill slug, description, install source, version, license
  skills/<name>/SKILL.md  ← optional HLVM-owned bundled/community skill source
```

The write path is GitHub-native: create/update/delete/deprecate happen through
pull requests and CI validation. The HLVM CLI reads the static index for search
and install-by-slug. It must not require an HLVM server, database, account
system, or background sync service.

Current package-manager UX is:

```
hlvm skill new <name>
hlvm skill draft <name> <goal...> [--ai] [--print] [--force]
hlvm skill improve <name> <instruction...> [--print] [--save]
hlvm skill import <path> [--force]
hlvm skill install <source-or-slug> [--version <version>] [--force]
hlvm skill update <name|--all>
hlvm skill remove <name>
hlvm skill check
```

Current repository-backed UX:

```
hlvm skill search <query>
hlvm skill install <slug>
hlvm skill info <slug> --remote
hlvm skill publish <name> --repo <path>
```

External taps and broad GitHub search can be considered later, but they are not
the first user path. The first path is the official HLVM GitHub index so users
do not need to create or manage their own repositories.

### Skill layers

All future skills work should fit one of these layers:

| Layer                | Responsibility                                                                             | SSOT requirement                                              |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Core substrate       | Discover `SKILL.md`, parse frontmatter, resolve precedence, format prompt index, read body | Must live in `src/hlvm/agent/skills/`                         |
| Local UX             | `hlvm skill ...`, REPL slash activation, completion/catalog display                        | Must call the core substrate                                  |
| Bundled skills       | Foundational built-in `SKILL.md` folders                                                   | Must be exposed as a source to the core substrate             |
| Skill packs          | Optional domain packs such as browser, GitHub, release, or messaging workflows             | Must be plain skills or explicitly documented package sources |
| Distribution         | Scaffold/import/install/update/remove/check from local paths and Git/GitHub sources        | Must live in `src/hlvm/agent/skills/install.ts`               |
| Repository lifecycle | Search/install-by-slug and PR-ready publish packaging through the official GitHub index    | Must live in `src/hlvm/agent/skills/repository.ts`            |
| Policy and safety    | Dependency checks, dangerous-code scans, allowlists, per-agent scoping                     | Requires a new SSOT entry before implementation               |
| Assisted authoring   | Explicit user-invoked template/AI drafts and AI skill improvement                          | Must live in `src/hlvm/agent/skills/authoring.ts`             |

### Adding or expanding skill support

The first implementation should use only these integration points:

1. Add canonical path helpers in `src/common/paths.ts`.
2. Add the `src/hlvm/agent/skills/` subsystem.
3. Add one orchestrator hook that injects the compact skills index.
4. Add `hlvm skill ...` CLI commands.
5. Add REPL slash-command routing to resolve `/skill-name`.

Everything else must remain in its current SSOT: tools execute tools, MCP loads
MCP servers, memory stores memories, and providers call models.

If a later phase adds dependency installers, policy enforcement, passive
workflow-to-skill suggestions, external taps, broad GitHub discovery, or another
source of skills, update this contract first with the new SSOT entry and its
allowed boundaries. Silent background skill generation remains forbidden unless
this contract is amended first.

## Channel Architecture

All inbound messages from any chat vendor flow through a single enforced
pipeline. No vendor transport can reach the HLVM brain directly.

```
vendor transport.receive(ChannelMessage)
  → runtime.handleInboundMessage()    ← allowlist check (runtime.ts)
    → queue.run(sessionId, ...)       ← per-session serialization (queue.ts)
      → runQuery()                    ← production registry delegates to GUI turn bridge
        → /api/channels/turns/stream  ← Swift GUI receives the turn
        → ReplChatController.startChat / performStartChat
        → /api/channels/turns/complete
    → transport.send(ChannelReply)    ← reply via same transport
```

The production `channelRuntime` in `src/hlvm/channels/registry.ts` must use
`src/hlvm/channels/core/gui-turn-bridge.ts` as its `runQuery` dependency.
Telegram turns must execute through the same Swift GUI chat pipeline as
Tab/Spotlight sends. Do not add a vendor-specific backend `runChatViaHost`,
direct agent call, or synthetic "remote message" bubble path. The default
`createChannelRuntime()` host-client fallback exists only for isolated
construction/tests, not for the shared GUI-owned runtime.

External channel ownership is also centralized. The default shared runtime on
`127.0.0.1:11435` is the only process that may start Telegram. Explicit
`hlvm serve --port <non-default>` runtimes are isolated local HTTP/testing
surfaces and must not poll vendor APIs, attach vendor event streams, or consume
mobile updates.

Do not use runtime ports as chat, bot, endpoint, or agent identities. If HLVM
needs multiple Telegram bots or multiple chat agents, add endpoint records under
the shared channel runtime instead of spawning multiple runtime owners.

### Production channel scope rule

Telegram is the only production messaging channel.

A new vendor is not implemented or exposed in the GUI until it meets all of:

1. **Official bot or app API.** No private local databases, no AppleScript-only
   automation, no reverse-engineered web/mobile clients.
2. **No HLVM-operated message relay.** HLVM may support provisioning, but user
   messages must not require an HLVM-owned inbox, phone number, Apple ID, cloud
   Mac, or long-running central bridge.
3. **No shared aggregate cost ceiling.** The platform must not put all users
   behind one HLVM-owned quota or per-message bill.
4. **Scan/open mobile onboarding can complete to a dedicated chat surface.** The
   user should land in a clear chat with HLVM, not a confusing self-thread,
   shared inbox, workspace admin flow, or developer console setup.
5. **Same local SSOT path.** Inbound turns must flow through
   `ChannelTransport → channel runtime → GUI turn bridge → Swift chat`, then
   replies return through the same transport.

Telegram currently passes. LINE, iMessage, Gmail relay/OAuth, Slack, WhatsApp,
Messenger, KakaoTalk, and WeChat do not pass the product gate for the
mobile-first, zero-server, scan-and-chat default path.

Current GUI surface:

```text
[Telegram icon] Scan with Telegram
  [Telegram QR]
```

The Telegram icon is part of the live Telegram affordance, not a platform
picker. Do not add placeholder tabs, icons, coming-soon buttons, docs, tests, or
config for vendors that have not passed the gate.

### Adding a new vendor after it passes the gate

Provide exactly three vendor files and two wiring lines. Do not add placeholder
GUI tabs, icons, docs, tests, or config for a vendor that has not passed the
gate.

| File                                         | What to implement                                    |
| -------------------------------------------- | ---------------------------------------------------- |
| `src/hlvm/channels/<vendor>/transport.ts`    | `ChannelTransport` — start/stop/send/receive         |
| `src/hlvm/channels/<vendor>/provisioning.ts` | `ChannelProvisioner` — createSession/completeSession |
| `src/hlvm/channels/<vendor>/protocol.ts`     | `<Vendor>SetupSession extends ChannelSetupSession`   |

Wire in:

- `src/hlvm/channels/registry.ts` — add `<vendor>: create<Vendor>Transport`
- `src/hlvm/cli/repl/handlers/channels/provisioning.ts` — add `"<vendor>"`
  dispatch entry

Everything else (allowlist, queue, pairing, runQuery, config writeback, HTTP
routes, the QR window) is reused automatically. No other files need to change.

### Retired platform lessons

- **iMessage** is not production-grade for HLVM. It has no public bot API. The
  attempted self-message design depended on private `chat.db` reads, WAL file
  watching, AppleScript/Apple Events sending, alias/thread heuristics, and OS
  notification behavior HLVM cannot control. Real-device testing produced
  blue/blue attribution, duplicate alias rooms, intermittent delivery, and
  notification noise. Remove it rather than shipping a brittle local hack.
- **Gmail** is viable only as email, not Telegram-equivalent chat. Per-user
  Gmail requires OAuth consent and sensitive Gmail scopes; a central HLVM Gmail
  relay requires HLVM to operate an inbox/relay and creates aggregate quota,
  abuse, and cost ownership. IMAP/SMTP app-password prototypes are simpler but
  still move the product away from zero-server scan-and-chat.
- **Slack** is an official API target for teams, but onboarding is workspace
  OAuth/app installation, not personal mobile scan-and-chat. It can be revisited
  only as a team/workspace feature with explicit admin-consent UX.
- **LINE/WhatsApp/Kakao/Messenger/WeChat** require official accounts,
  business/provider setup, webhook infrastructure, paid or policy-constrained
  messaging, or unsupported bridges. They do not match the default HLVM channel
  requirement.

### Forbidden in vendor transport modules

- Calling `runQuery` or `runChatViaHost` directly
- Importing from `src/hlvm/runtime/host-client.ts`
- Writing to config outside `context.updateConfig()`
- Bypassing `context.receive()` to handle messages inline
- Hosting a 24/7 message relay or paid-per-message bridge — see "Channel scope
  rule" above

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
throw new Error("Something went wrong"); //

// PREFERRED
import { RuntimeError, ValidationError } from "../common/error.ts"; //
throw new ValidationError("Invalid pattern", { line, column }); //
throw new RuntimeError("Operation failed"); //

// ALLOWED - JS semantic errors
throw new TypeError("Expected string"); //
throw new RangeError("Index out of bounds"); //
```

### 5. Direct Init Calls

```typescript
// FORBIDDEN - bypasses unified initialization
// Direct init helpers are not allowed. Use initializeRuntime instead.

// USE INSTEAD
import { initializeRuntime } from "../common/runtime-initializer.ts"; //
await initializeRuntime(); //
// Or with options:
await initializeRuntime({ ai: false }); //
```

## Allowed Bypasses

Some patterns are explicitly allowed in specific contexts:

| Pattern                | Allowed In                             | Reason                       |
| ---------------------- | -------------------------------------- | ---------------------------- |
| `console.*`            | `src/logger.ts`, `src/hlvm/api/log.ts` | Internal implementation      |
| `console.*`            | CONSOLE_ALLOWLIST files (see below)    | Technical requirements       |
| `(console.log ...)`    | HQL code examples in strings           | S-expression syntax          |
| `fetch()`              | `src/hlvm/providers/*`                 | Provider-specific HTTP needs |
| `fetch()`              | `src/hql/lib/stdlib/js/*`              | Stdlib utility code          |
| `fetch()`              | `embedded-packages/*`                  | Third-party code             |
| `Deno.*`               | `src/platform/deno-platform.ts`        | Platform implementation      |
| `throw new Error`      | Test files (`*.test.ts`)               | Test assertions              |
| `throw new Error`      | RAW_ERROR_ALLOWLIST files (see below)  | Technical requirements       |
| `throw new TypeError`  | Anywhere                               | JS semantic correctness      |
| `throw new RangeError` | Anywhere                               | JS semantic correctness      |

### CONSOLE_ALLOWLIST (Permanent Exceptions)

These files have legitimate technical reasons for direct console access:

| File                                                | Reason                                             |
| --------------------------------------------------- | -------------------------------------------------- |
| `src/common/known-identifiers.ts`                   | Bootstrap guard (`typeof console !== "undefined"`) |
| `src/common/runtime-error-handler.ts`               | Crash handler hooks `console.error`                |
| `src/common/runtime-helper-impl.ts`                 | Stringified runtime code (cannot use imports)      |
| `src/hql/transpiler/pipeline/source-map-support.ts` | Technical stack-mapping implementation             |

### RAW_ERROR_ALLOWLIST (Permanent Exceptions)

These files cannot use typed errors from `src/common/error.ts` due to
architectural constraints:

| File/Path                                           | Reason                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `src/common/utils.ts`                               | Circular dependency: error.ts → logger.ts → utils.ts               |
| `src/platform/deno-platform.ts`                     | Circular dependency: error.ts → logger.ts → utils.ts → platform.ts |
| `src/hql/lib/stdlib/js/`                            | Pure JavaScript runtime files (cannot use TypeScript types)        |
| `src/hql/embedded-packages.ts`                      | Embedded JS code in string literals                                |
| `src/hql/transpiler/pipeline/source-map-support.ts` | JSDoc examples                                                     |
| `src/hql/transpiler/syntax/function.ts`             | JSDoc examples                                                     |

**Circular Dependency Explanation:**

```
error.ts imports logger.ts
  → logger.ts imports utils.ts (for getErrorMessage)
    → utils.ts imports platform.ts (for getPlatform)
      → platform.ts imports deno-platform.ts
```

If any file in this chain imports from `error.ts`, it creates a circular
dependency causing:

```
ReferenceError: Cannot access 'logger' before initialization
```

### API Layer (globalThis)

These files have legitimate technical reasons for direct console access:

| File                                                | Reason                                             |
| --------------------------------------------------- | -------------------------------------------------- |
| `src/common/known-identifiers.ts`                   | Bootstrap guard (`typeof console !== "undefined"`) |
| `src/common/runtime-error-handler.ts`               | Crash handler hooks `console.error`                |
| `src/common/runtime-helper-impl.ts`                 | Stringified runtime code (cannot use imports)      |
| `src/hql/transpiler/pipeline/source-map-support.ts` | Technical stack-mapping implementation             |

## API Layer (globalThis)

All REPL-accessible APIs are registered on `globalThis`:

```typescript
globalThis.ai; // AI operations (chat, complete, etc.)
globalThis.config; // Configuration management
globalThis.session; // Session management
globalThis.bindings; // Persistent definitions
globalThis.history; // Command history
globalThis.log; // Logging API
globalThis.errors; // Error factory
globalThis.runtime; // Runtime utilities
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

| Date       | Change                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2025-01-19 | Initial contract created                                                                                                                               |
| 2026-04-23 | Added channel runtime, vendor contracts, and multi-vendor extension rules                                                                              |
| 2026-04-24 | Added skills discovery, prompting, and execution-boundary rules                                                                                        |
| 2026-04-26 | Added external channel runtime ownership and endpoint identity rule                                                                                    |
| 2026-04-26 | Updated skills contract for Phase 3: bundled skills root, official agentskills.io frontmatter parsing, shared ask/REPL activation, no special executor |
| 2026-04-26 | Added skills Phase 4 distribution SSOT: local/Git/GitHub import/install through `src/hlvm/agent/skills/install.ts`, global user-root copy only         |
| 2026-04-26 | Added channel scope rule (free forever, per-user ceiling, no relay); LINE removed; iMessage self-message explored as next target                       |
| 2026-04-26 | Channel runtime production `runQuery` now delegates to GUI turn bridge; mobile turns must enter the same Swift chat path as Tab/Spotlight              |
| 2026-04-26 | iMessage self-message spike documented: no-prefix model, FSEvents, Hide Alerts, chat.db row filters                                                    |
| 2026-04-26 | iMessage v1 spike clarified: recipient-only QR, no pair-code body, first normal self-thread message as first bot turn                                  |
| 2026-04-26 | iMessage integration spike reached GUI picker and compiled Swift helper, then failed production reliability on real-device E2E                         |
| 2026-04-26 | Skills repository direction decided: official HLVM GitHub static index first, no custom registry server or broad GitHub-search primary path            |
| 2026-04-26 | Skills Phase 4.1 lifecycle landed: scaffold/import/install/update/remove/check centralized in `src/hlvm/agent/skills/install.ts`                       |
| 2026-04-26 | Skills Phase 4.2 repository resolver landed: static index search/install-by-slug centralized in `src/hlvm/agent/skills/repository.ts`                  |
| 2026-04-27 | Skills Phase 5 explicit drafting foundation landed: user-invoked workflow drafts centralized in `src/hlvm/agent/skills/install.ts`                     |
| 2026-04-27 | Skills A-to-Z authoring flow landed: AI draft/improve normalization in `authoring.ts`, PR-ready publish packaging in `repository.ts`                   |
| 2026-04-27 | Skills verification updated: focused tests, deterministic user E2E, live Haiku AI E2E, real `hlvm-dev/skills` remote E2E, and compiled-binary smoke    |
| 2026-04-27 | Messaging reset: removed iMessage/LINE/Gmail/Slack live scope; Telegram is the only production channel until another vendor passes the gate            |
| 2026-04-27 | Telegram-only GUI rule clarified: title row keeps the Telegram icon; all non-production platform placeholders stay forbidden                           |
