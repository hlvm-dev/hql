# HLVM Project Guidelines

Follow `AGENTS.md` for authoritative AI agent instructions.

## 🚨 100% SSOT Compliance is MANDATORY

**Zero tolerance for SSOT violations. NO exceptions without architectural review.**

All code MUST use designated SSOT entry points. Direct calls to `console.*`, `Deno.*`, `fetch()`, or file I/O APIs are **FORBIDDEN**.

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
