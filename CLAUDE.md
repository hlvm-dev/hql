# @CLAUDE: HLVM FIELD NOTES

Updated: 2025-10-27 (same dataset as `PROJECT_STATUS.md`)

> **ABSOLUTE SAFETY RULE**\
> Never run destructive git write operations (e.g., `git reset`, `git revert`,
> `git rebase --onto`)—these commands are strictly forbidden.

This playbook gives Claude Code an immediate view of the HQL project so you can
jump into pair work without rereading the full archive each time.

## MISSION OVERVIEW

- Status: Production-ready, 100% feature-complete (89/89 language features)
- Quality gates: 1457/1457 tests passing with `deno test --allow-all`
- Type safety: Zero type errors (using Deno's built-in type checking)
- Critical features to guard: mixed positional+named args, macro reader,
  bundler, runtime helpers, storage IO
- Documentation: Runtime, CLI, and core APIs covered; expand coverage as new
  surfaces ship
- 7-step stabilization vision: ✅ 100% complete; maintain the production-ready
  badge
- DRY cleanup: 460 duplicate lines removed, 5 helper families consolidated,
  mixed-arg path optimized to O(n)
- Circular module support: `mod.ts` caches module outputs;
  `tests/syntax-circular.test.ts` fully active

## CORE EXECUTION CHECKLIST

1. Read `AGENTS.md` to align with cross-assistant expectations
2. **CRITICAL: HQL is NOT Clojure** - Always use HQL syntax, not Clojure syntax
   - Read `doc/examples/` and `doc/specs/` FIRST before writing any HQL code
   - Review unit tests in `tests/` to understand actual HQL syntax
   - HQL uses `(let x 10)` and `(var x 10)`, NOT `(def x 10)` like Clojure
   - HQL function syntax (two-style system):
     - Positional: `(fn add [x y] body)` with square brackets `[x y]`
     - Config/map: `(fn connect {"host": "localhost", "port": 8080} body)` with strict JSON
     - NOT Clojure: `(defn name [params] body)` is invalid in HQL
   - HQL supports arrow lambdas: `(=> (* $0 2))` for concise anonymous functions
     with Swift-style `$N` parameters
3. Confirm that any proposed change keeps the production-ready badge (tests +
   docs)
4. Identify documentation impact early (JSDoc + `doc/` markdown, REPL
   discoverability)
5. Cite target files with line numbers when recommending edits
6. Note which verification commands must run before handoff
7. Cross-check relevant milestones in `PROJECT_STATUS.md` Phase 5.x notes before
   suggesting structural work

## TESTS YOU MUST PLAN FOR

```bash
# Canonical integration battery (AI + CLI + REPL workflows)
./test/test.sh

# Type-checked suite (must stay green)
deno test --allow-all

# Comprehensive verification helper
./verify-codebase.sh
```

- Use `run_test` and `cli_test` helpers in `test/test.sh` when adding coverage
- For focused debugging, `deno test --allow-all tests/<name>.ts` targets
  individual suites
- Mixed args regression focus: `tests/syntax-mixed-args.test.ts` (20 cases)
- Feature spot checks: Largest suites are `tests/syntax-operators.test.ts` (47
  tests) and `tests/syntax-class.test.ts` (32 tests)

## KEY FILES AND DIRECTORIES

- `core/src/` — compiler pipeline, macro system, runtime error handling
- `runtime/` — host bindings exposed to the REPL
- `doc/` — published API guides (update alongside any public API change)
- `HQL_PROJECT_STATUS_AND_ROADMAP.md` — long-form roadmap with milestone history
- `PRODUCTION_READY_SUMMARY.md`, `DOCUMENTATION_SESSION_SUMMARY.md` — background
  narratives on the readiness push

## KNOWN GOTCHAS

- **NEVER confuse HQL with Clojure syntax** - They are different languages with
  different syntax
  - Before writing ANY HQL code: read `doc/examples/`, `doc/specs/`, and
    `tests/`
  - HQL syntax guide: `(let x 10)` not `(def x 10)`, `(var x 10)` for mutables
  - Function syntax: `(fn add [x y] body)` for positional, `(fn config {"key": default} body)` for maps
  - When unsure about syntax: grep the test files or examples directory first
- Mixed-argument calling has 20 regression tests; breaking them is a release
  blocker
- REPL APIs must expose rich JSDoc so `hlvm.<module>.<fn>` inspection prints
  complete docs
- Do not introduce duplicate logic—revisit DRY helpers in `core/src/common/`
  before adding new utilities
- Keep examples in documentation executable; run them if they are new or
  modified
- Circular import handling depends on `compileHqlModule` cache priming; avoid
  bypassing `moduleOutputs`
- Performance guardrails: avoid reintroducing O(n²) scans in argument transforms
  or import resolution

## WHEN TO ESCALATE

- Any regression in mixed args, macro expansion, or bundler output
- Type errors returning after a change (never suppress them)
- Missing documentation for new APIs or CLI commands
- Test flakiness or non-deterministic behaviour in `./test/test.sh`
- Deviations from the verification protocol (baseline capture → change → full
  test rerun)

## QUICK CONTEXT REFRESH

- For high-level status: `PROJECT_STATUS.md`
- For next steps or open work: `HQL_PROJECT_STATUS_AND_ROADMAP.md`
- For quality standards: `CODEBASE_QUALITY_AUDIT.md` and `JSDOC_STANDARDS.md`
- For documentation campaign details: `DOCUMENTATION_SESSION_SUMMARY.md`,
  `COMPLETE_FEATURE_VERIFICATION.md`
- For verification workflow: `QUICK_VERIFICATION_REFERENCE.md`,
  `VERIFICATION_GUIDE.md`, `VERIFICATION_CHECKLIST.md`

## PHASE 5 SNAPSHOT (Use Before Deep Changes)

- **5.1 DRY Cleanup:** Introduced `validateTransformed` helper, unified
  identifier validation, maintained 372/372 tests during refactor
- **5.2 Code Organization Audit:** Large-file structure deemed cohesive; no
  splits planned
- **5.3 Documentation Expansion:** Added runtime, built-ins, build tool, module
  system guides with runnable examples
- **5.4 Mixed Positional+Named Args:** Two-pass algorithm in
  `core/src/transpiler/syntax/function.ts`, 20 dedicated tests
- **5.5 Circular Import Support:** `mod.ts` now pre-registers outputs; circular
  graphs compile without deadlocks
- **5.6 Performance Tuning:** Argument handling uses precomputed maps; circular
  builds reuse cached outputs, reducing redundant writes

## VERIFICATION REMINDERS

- Capture baseline (`deno test --allow-all`) before heavy refactors; note the
  `962 passed | 0 failed` metric
- After changes, rerun `./test/test.sh`, `deno test --allow-all`, and
  `./verify-codebase.sh`
- Document results (date, totals, notable diffs) in collaboration notes or PR
  drafts
- Never hand off with failing or unverified tests—even if failures look
  unrelated, resolve or escalate first

Stay synchronized with the rest of the AI tooling crew by updating this brief
whenever the status metrics or processes change.
