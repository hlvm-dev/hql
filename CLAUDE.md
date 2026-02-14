# HLVM Project Guidelines

Follow `AGENTS.md` for authoritative AI agent instructions.

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

See `AGENTS.md` for detailed DRY/KISS guidelines and examples.

### Required Patterns

**Always use SSOT entry points:**
- Logging: `log.info()`, `log.error()`, `log.debug()` (NEVER `console.*`)
- HTTP: `http.get()`, `http.post()` (NEVER `fetch()`)
- File I/O: `getPlatform().fs.*` (NEVER `Deno.readFile()`, `Deno.writeFile()`)
- Platform APIs: `getPlatform().*` (NEVER direct `Deno.*`)
- AI/Config: `globalThis.ai`, `globalThis.config`

See `AGENTS.md` for complete SSOT table and forbidden patterns.

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

- Run `deno task test:unit` after meaningful changes
- Tests must be real (no fake tests that always pass)
