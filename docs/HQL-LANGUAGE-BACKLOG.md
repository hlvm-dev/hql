# HQL Language Backlog (Compiler + Runtime + Clojure Parity)

Scope: HQL language and transpiler pipeline only.

Status legend:

- `[x]` done
- `[~]` in progress
- `[ ]` not started

## Recently Fixed

- `[x]` Parser now rejects malformed template interpolation bodies.
  - `${a b}` now fails (must contain exactly one expression).
  - `${}` now fails (empty interpolation).
  - Unclosed interpolation braces now fail.
  - Coverage added in `tests/unit/parser-validation.test.ts`.
- `[x]` AST->IR now fails fast for unknown node kinds.
  - Unknown node kinds now throw `ValidationError` instead of being silently dropped.
  - Coverage added in `tests/unit/hql-ast-to-ir-validation.test.ts`.
- `[x]` `some` now follows Clojure semantics.
  - Returns first truthy predicate result (not collection item).
  - Coverage updated in stdlib unit tests and autoload tests.
- `[x]` `deepEq` is now cycle-safe.
  - Uses pair-tracking (`WeakMap`) to avoid recursion over cyclic structures.
  - Coverage added for cyclic object comparisons.

## P0 (Correctness / Soundness)

- `[x]` Isolate macro expansion state per transpilation unit (non-REPL path).
  - Risk: cross-compilation contamination from persisted named functions/macros.
  - Target files: `src/hql/s-exp/macro.ts`,
    `src/hql/transpiler/hql-transpiler.ts`.

- `[x]` Make semantic validation two-pass for top-level forward-reference/TDZ
  correctness.
  - Risk: `(let y x)` before `(let x 1)` can slip through validation.
  - Target file: `src/hql/transpiler/pipeline/semantic-validator.ts`.

- `[x]` Enforce fail-fast for unknown AST->IR nodes.
  - Risk: warn + `null` drop can silently lose code.
  - Target file: `src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts`.

- `[x]` Strengthen effect purity call-site checking for aliases/indirection.
  - Risk: impure calls can bypass checks through aliasing.
  - Target files: `src/hql/transpiler/pipeline/effects/effect-infer.ts`.

- `[x]` Fix stdlib `some` semantics to return predicate result (Clojure
  semantics), not matched item.
  - Risk: behavioral incompatibility in common idioms.
  - Target file: `src/hql/lib/stdlib/stdlib.hql`.

- `[x]` Make `deepEq` cycle-safe.
  - Risk: stack overflow on cyclic structures.
  - Target file: `src/hql/lib/stdlib/stdlib.hql`.

- `[x]` Close stdlib/runtime typing drift (`get/update/mapT/...`) to eliminate
  false-positive type errors.
  - Risk: noisy diagnostics on valid programs.
  - Target files: `src/hql/transpiler/pipeline/ts-compiler.ts`, stdlib
    declarations.

## P1 (Robustness / Performance / Developer Trust)

- `[ ]` Preserve source metadata across syntax rewrites.
  - Risk: degraded source-map and error positions.
  - Target file: `src/hql/transpiler/pipeline/syntax-transformer.ts`.

- `[x]` Complete function type parameter parsing for `(-> [params] Ret)`.
  - Risk: lost type fidelity in IR/effects.
  - Target file: `src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts`.

- `[x]` Restrict `_` lowering to pattern contexts only.
  - Risk: identifier semantics corruption.
  - Target file: `src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts`.

- `[ ]` Remove shared global symbol-table defaults from compiler path.
  - Risk: concurrent transpile cross-request contamination.
  - Target files: `src/hql/transpiler/pipeline/syntax-transformer.ts`,
    `src/hql/transpiler/hql-transpiler.ts`.

- `[ ]` Improve module-aware TypeScript check host behavior.
  - Risk: single-file type-check limitations and noisy diagnostics.
  - Target file: `src/hql/transpiler/pipeline/ts-compiler.ts`.

- `[ ]` Optimize `distinct` to avoid repeated Set-copy behavior.
  - Risk: avoidable performance hit on large sequences.
  - Target file: `src/hql/lib/stdlib/stdlib.hql` (and/or core chunked fast path
    usage).

- `[ ]` Define and test array edge semantics for `assoc`/`dissoc` (negative,
  out-of-range, sparse behavior).
  - Risk: surprising runtime behavior divergence.
  - Target file: `src/hql/lib/stdlib/stdlib.hql` + tests.

## P2 (Parity / Maturity)

- `[ ]` Expand source-map runtime portability hardening.
  - Risk: path and preload assumptions reduce reliability.
  - Target file: `src/hql/transpiler/pipeline/source-map-support.ts`.

- `[ ]` Tighten TS->HQL mapping fallback strategy for diagnostics.
  - Risk: mis-pinned errors on edge columns.
  - Target file: `src/hql/transpiler/pipeline/source-map-chain.ts`.

- `[ ]` Enforce template nesting depth limits.
  - Risk: parser complexity and runaway nested template input.
  - Target files: `src/hql/transpiler/pipeline/parser.ts`, constants.

- `[ ]` Decide macro max-depth overflow policy (`fail-fast` preferred).
  - Risk: partially expanded output can hide correctness bugs.
  - Target file: `src/hql/s-exp/macro.ts`.

- `[ ]` Clojure parity gap decisions (documented explicit choices):
  - list semantics (`list`, `conj nil`)
  - symbol/keyword model consistency
  - transducer arity compatibility for sequence fns
  - missing high-impact core helpers (`remove`, `complement`, `fnil`,
    `select-keys`, `merge-with`, `reduce-kv`)

## Test Notes (Current Baseline)

- `tests/unit/stdlib-map-ops.test.ts` and
  `tests/unit/syntax-spread-operator.test.ts`: passing.
- `tests/unit/parser-validation.test.ts`: passing with new template regression
  coverage.
- `tests/unit/syntax-template-literals.test.ts`: passing.
- `tests/unit/macro-edge-cases.test.ts`: currently has two Deno resource-leak
  failures to investigate separately.
