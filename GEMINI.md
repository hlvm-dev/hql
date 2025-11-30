# GEMINI: HLVM OPERATIONS BRIEF

Updated: 2025-10-27 (aligned with the snapshot in `PROJECT_STATUS.md`)

> **ABSOLUTE SAFETY RULE**\
> Never run destructive git write operations (e.g., `git reset`, `git revert`,
> `git rebase --onto`)—these commands are strictly forbidden.

This briefing gives every AI coding assistant the same ground truth about the
HQL/HLVM codebase. Use it as a quick orientation before touching any code.

## PROJECT SNAPSHOT

- Production readiness: 100% and verified end to end
- Language features implemented: 89/89 from the public spec
- Test suite: 1457 passing tests across 68 files (`deno test --allow-all`)
- Type checking: 0 errors with full type checking enabled
- Mixed positional + named arguments: complete with 20 regression tests
- Documentation: Core runtime and high-priority APIs covered (≈52% of total
  surface)

## STATUS CHECKPOINTS

- 7-step stabilization vision: ✅ 7/7 complete ("Production-Ready Achieved"
  badge)
- Verified facts: 1457 total tests, 89 working features audited, expanded lazy
  stdlib regression suite
- DRY cleanup removed 460 duplicate lines and consolidated 5 major helpers
- Circular import support landed; all prior skipped tests now active
- Performance tuning: mixed-arg transforms now O(n) using precomputed parameter
  maps

## PRIMARY PRIORITIES

1. **CRITICAL: Use HQL syntax, NOT Clojure syntax**
   - HQL and Clojure are DIFFERENT languages with DIFFERENT syntax
   - ALWAYS read `doc/examples/`, `doc/specs/`, and `tests/` before writing HQL
     code
   - HQL function syntax (two-style system):
     - Positional: `(fn name [x y] body)` with square brackets `[]`
     - Config/map: `(fn name {"host": "localhost", "port": 8080} body)` with JSON `{}`
   - NOT Clojure: `(def x 10)` `(defn name [params] body)` - these are INVALID
   - Bindings: `(let x 10)` `(var x 10)`
2. Keep the master test suite green (`./test/test.sh` and
   `deno test --allow-all`)
3. Preserve DRY, dead-code-free code quality established in the DRY cleanup pass
4. Maintain mandatory API documentation (JSDoc + external docs) for every public
   change
5. Ensure REPL self-documentation stays accurate after any API update
6. Guard production-ready features: mixed args, storage, IO, macro system,
   bundler, runtime helpers

## TESTING CHECKLIST

Follow this sequence whenever you finish a milestone or ship user-visible
changes:

1. `./test/test.sh` — canonical integration coverage (82/82 scenarios)
2. `deno test --allow-all` — TypeScript mode with full type checking (952/952
   passing)
3. `./verify-codebase.sh` — smoke check for lint, format, docs, and type
   declarations
4. Add targeted tests when you introduce new APIs (REPL `run_test` or CLI
   `cli_test`)
5. Re-run the whole suite until everything passes with zero flakiness

### Feature + Test Coverage Highlights

- 55 core features individually verified (functions, imports, macros, loops,
  operators, interop, etc.)
- Largest suites: `tests/syntax-operators.test.ts` (47 tests),
  `tests/syntax-class.test.ts` (32 tests)
- Mixed arguments: `tests/syntax-mixed-args.test.ts` adds 20 regression cases
  (basic, defaults, errors, real-world)
- Circular imports: `tests/syntax-circular.test.ts` now fully enabled
- Use `deno test --allow-all tests/<file>.ts` for focused debugging when needed

## SOURCE MAP

- `core/` — compiler, runtime, bundler, macro system, and shared utilities
- `runtime/` — HQL runtime bindings and host-side helpers
- `tests/` and `test/` — canonical regression coverage plus helper harnesses
- `doc/` — public-facing API documentation (update alongside code changes)
- `tools/`, `scripts/`, `verify-codebase.sh` — automation for verification and
  maintenance

## RESPONDING AS AN AI ASSISTANT

- **FIRST: Verify HQL syntax** - Read `doc/examples/`, `doc/specs/`, `tests/`
  before writing any HQL code
  - Never use Clojure syntax (`def`, `defn`) - HQL uses `let`, `var`, `fn`
  - When unsure: grep test files for syntax examples
- Always summarize the current production state before proposing code changes
- Call out required documentation updates up front (internal JSDoc + `doc/`
  markdown)
- Quote specific test commands you ran or must run; never assume green status
- Reference the relevant files by path and line number when suggesting edits
- When unsure, consult `HQL_PROJECT_STATUS_AND_ROADMAP.md`,
  `PRODUCTION_READY_SUMMARY.md`, and `DOCUMENTATION_SESSION_SUMMARY.md` for
  extra context

## RECENT MILESTONES (Phase 5 Series)

- **5.1 DRY Cleanup:** Centralized validation helpers (`validateTransformed`),
  unified identifier checks, kept 372/372 tests passing during refactor
- **5.2 Code Organization Audit:** Large files reviewed (imports.ts, etc.);
  decision: retain cohesion, no further splits
- **5.3 Documentation Expansion:** New references for runtime, built-ins, build
  tool, module system; examples validated against tests
- **5.4 Mixed Positional+Named Args:** Two-pass algorithm in
  `src/transpiler/syntax/function.ts`; 20 new tests covering defaults,
  nested calls, and error cases
- **5.5 Circular Imports:** Pre-register module outputs in `mod.ts`; all
  circular tests unskipped; build tool inherits fix
- **5.6 Performance Tuning:** Mixed-arg transform now uses maps; circular builds
  reuse cached outputs, reducing redundant writes

## EXTERNAL DEPENDENCIES

HQL supports external dependencies in both development and compiled binary modes:

**Supported in compiled binary:**
- **NPM packages:** `(import [default as chalk] from "npm:chalk@4.1.2")`
- **HTTP requests:** `js/fetch` is auto-available
- **Core stdlib:** `map`, `filter`, `first`, `rest`, etc. are auto-imported

**Development only (`deno run`):**
- `jsr:` and `https:` module imports (may not work in compiled binaries)

**Removed:**
- The `@hql/*` package namespace has been removed as redundant
- All core functions are auto-imported
- Use `npm:` packages or `js/*` interop for additional functionality

## DOCUMENTATION & REFERENCES

- Primary status reports: `PROJECT_STATUS.md`,
  `HQL_PROJECT_STATUS_AND_ROADMAP.md`, `PRODUCTION_READY_SUMMARY.md`
- Quality guardrails: `CODEBASE_QUALITY_AUDIT.md`, `JSDOC_STANDARDS.md`,
  `SPEC_VS_IMPLEMENTATION_AUDIT.md`
- Verification aides: `QUICK_VERIFICATION_REFERENCE.md`,
  `VERIFICATION_GUIDE.md`, `VERIFICATION_CHECKLIST.md`
- Documentation campaign artifacts: `DOCUMENTATION_SESSION_SUMMARY.md`,
  `COMPLETE_FEATURE_VERIFICATION.md`

## QUICK REFERENCE COMMANDS

```bash
# Full integration test sweep
./test/test.sh

# Type-checked unit/integration suite
deno test --allow-all

# End-to-end verification harness
./verify-codebase.sh

# Lint and format helpers (invoked inside verify script if needed)
deno fmt
deno lint
```

## ESCALATION GUIDANCE

- If a change risks breaking mixed-argument calling (core/runtime), loop in
  maintainers immediately
- If documentation coverage drops, pause implementation work and restore docs
  before proceeding
- If tests fail with type checking, fix the type mismatch rather than
  suppressing TypeScript
- If circular import behaviour regresses, re-run `tests/syntax-circular.test.ts`
  immediately

## VERIFICATION PROTOCOL SNAPSHOT

1. Record baseline: `git status`, then `deno test --allow-all` and capture
   output (`952 passed | 0 failed`)
2. Apply changes and extend coverage with `run_test` / `cli_test` where relevant
3. Re-run `./test/test.sh`, `deno test --allow-all`, and `./verify-codebase.sh`
4. Document metrics (date, test totals, notable diffs) in a verification note or
   PR description
5. Address any regression before handoff—no exceptions for flaky or ignored
   failures

Keep this document synchronized with `PROJECT_STATUS.md` whenever major
milestones land, so every agent shares the same operational picture.
