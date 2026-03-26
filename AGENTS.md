# HLVM Project Guidelines

## Concurrent Development - MANDATORY

**Multiple AI agents work on this codebase concurrently.** Always assume another genAI is working on other parts at the same time.

- **NEVER use `git stash`** — it will clobber another agent's uncommitted work. Only stash when explicitly told to.
- **NEVER run unit tests (`deno task test:unit`)** until the user explicitly asks you to. Other agents may have in-progress changes that cause unrelated failures.
- **NEVER assume test failures are yours** — they may be from another agent's WIP.
- **Minimize git operations** that touch the working tree globally (checkout, reset, clean). Scope your changes narrowly.

## 🚨 100% SSOT Compliance is MANDATORY

**Zero tolerance for SSOT violations. NO exceptions without architectural review.**

All code MUST use designated SSOT entry points. Direct calls to `console.*`, `Deno.*`, `fetch()`, or file I/O APIs are **FORBIDDEN**.

## Native Function Calling - MANDATORY

**End-to-end tool calling must be structured. No text-based TOOL_CALL/END_TOOL_CALL envelopes.**

Requirements:
- Use provider native tool calling (`tool_calls` / structured function calls)
- Orchestrator consumes structured tool calls directly
- **No fallback** to text-based `TOOL_CALL`/`END_TOOL_CALL` envelopes
- Text-repair fallback (parsing structured JSON from weak-model output) is acceptable as last resort after native retries — see `model-compat.ts`
- Providers without native tool calling should fail fast

## CLI Simplicity - MANDATORY

**Keep CLI output minimal and flags lean (YAGNI).**

For `hlvm ask`:
- Default output shows only tool results (no extra narration).
- `--verbose` enables agent header, tool labels, stats, and trace events.

Do not add new CLI flags unless explicitly requested.
Do not add new config knobs, persisted UI preferences, global modes, or toggleable behaviors unless explicitly requested.
Do not introduce options "for flexibility" or "for future use" when a better default behavior is sufficient.
If the user asks for a UX improvement, improve the default path first. Only add a new flag/setting/mode when the user explicitly wants control over it.

## Declarative Over Imperative - MANDATORY

**Prefer declarative approaches and APIs over imperative ones wherever possible.**

Imperative code is only acceptable when it is extremely performant and has proper, strong, competitive reasons to justify the complexity. Default to declarative — it is simpler, more readable, and easier to maintain.

## Leverage Existing Solutions - MANDATORY

**Stand on the shoulders of giants. Don't reinvent the wheel.**

- Prefer upstream APIs and dynamic data over hardcoded lookup tables
- Prefer battle-tested libraries over in-house reimplementations
- Only build custom when no adequate solution exists or dependency cost outweighs the benefit

## DRY & KISS - MANDATORY

**No scattered logic. No redundancy. No duplication.**

Every piece of logic must exist in **exactly ONE place**. Zero tolerance for copy-paste programming.

**Requirements:**
- Before writing code → Search for existing implementations
- When finding duplication → Consolidate immediately into one SSOT
- Similar logic in 2+ places → VIOLATION (refactor required)
- Copy-paste code → FORBIDDEN (extract to shared location)

### Required Patterns

**Always use SSOT entry points:**
- Logging: `log.info()`, `log.error()`, `log.debug()` (NEVER `console.*`)
- HTTP: `http.get()`, `http.post()` (NEVER `fetch()`)
- File I/O: `getPlatform().fs.*` (NEVER `Deno.readFile()`, `Deno.writeFile()`)
- Platform APIs: `getPlatform().*` (NEVER direct `Deno.*`)
- AI/Config: `globalThis.ai`, `globalThis.config`

### Pre-Commit Requirements (MANDATORY)

**BOTH checks MUST pass with ZERO errors:**
```bash
deno task ssot:check    # Must show 0 violations
deno task test:unit     # Must pass all tests
```

### Consequences

- New violations → automatic rejection
- Regressions → immediate revert
- Target: 100% compliance in ALL domains
- CI/CD enforces these requirements

### Tests

**Do NOT run tests unless the user explicitly asks.**

- Other AI agents may be working concurrently — their WIP can cause unrelated failures.
- When asked to test, run only the specific domain test, not the full suite.
- `deno task test:unit` (full suite) only when the user explicitly requests it.
- Tests must be real (no fake tests that always pass).

## HQL Stdlib Architecture - MANDATORY

**DO NOT directly edit `src/hql/lib/stdlib/js/self-hosted.js`.**

The HQL stdlib has a three-layer architecture:

```
stdlib.hql (HQL source)  ──transpile──▶  self-hosted.js (JS runtime)
                                              ▲
                                              │ imports
core.js (low-level primitives)  ◀─────────  index.js (router)
```

| File | Role | Editable? |
|------|------|-----------|
| `stdlib.hql` | HQL source definitions (~92 functions) | **YES** — edit here |
| `self-hosted.js` | Pre-transpiled JS (the actual runtime) | **NO** — generated output |
| `core.js` | Low-level primitives (first, rest, cons, seq, range) | Only for primitives |
| `index.js` | Routes functions from self-hosted.js vs core.js | Only to update routing |

**Rules:**
- To add or modify a stdlib function → edit `stdlib.hql`, then re-transpile
- `self-hosted.js` is a compiled artifact — direct edits will diverge from the HQL source
- `index.js` has a `SELF_HOSTED_FUNCTIONS` Set that controls routing — update it when adding new functions
