# HQL FX Effect System Specification

Status: Active
Scope: `fx` purity checking only

## Purpose

HQL keeps TypeScript as the value/type checker. This specification adds one
formal effect checker for `fx` purity.

Goals:

- `fx` must be proven pure from its body.
- `fn`/`defn` remain effectful by default.
- unknown calls and unknown extern behavior fail closed (`Impure`).
- no scattered allowlist logic in checker internals.

## Effect Domain

Effect lattice:

```text
Pure <= Impure
```

Join:

```text
join(Pure, Pure) = Pure
join(_, _)       = Impure
```

Subeffect:

```text
actual <= required
Pure <= Pure
Pure <= Impure
Impure <= Impure
Impure !<= Pure
```

## Judgment Form

We infer/check effects with:

```text
Gamma ; Sigma |- expr : effect
```

Where:

- `Gamma`: HQL declaration environment (known `fx`/`fn`, pure-annotated params).
- `Sigma`: extern effect signatures (single source of truth for JS/FFI boundary).

## Core Rules (Operational)

1. Literals and local reads are `Pure`.
2. Mutation (`assignment`, mutating methods) is `Impure`.
3. Async/generator effects (`await`, `yield`, `for-await`) are `Impure`.
4. Function call effect is:
   - `join(effect(callee), join(effect(args...)))`
5. `fx` body must infer to `Pure`, else compile error.
6. `fn`/`defn` are treated as `Impure` callees.
7. Unknown identifier/member/constructor/external is `Impure`.
8. `Pure` callback parameter requires a pure callable argument at call-site.

## Declaration Semantics

- `(fx ...)` declares function effect as `Pure`.
- `(fn ...)` / `(defn ...)` declare function effect as `Impure`.
- Parameter annotation `f:(Pure ...)` declares that parameter as pure callable.
- Missing callable effect annotations are conservative (`Impure`) in pure contexts.

## Extern Boundary (Sigma)

Effects for JS/runtime APIs are defined in one canonical module:

- `effect-signatures.ts`

This is the only explicit trust boundary. Unknown extern APIs are rejected in
`fx` via fail-closed default (`Impure`).

## Call Direction Guarantees

- `fn`/`defn` -> `fx`: allowed.
- `fx` -> `fn`/`defn`: rejected.
- `fx` -> unknown/dynamic call: rejected.

## Determinism and Side Effects

Accepted `fx` programs are checked to exclude side effects under `Gamma/Sigma`.
`fx` is intended for deterministic computation (same input -> same output).

Note: guarantees are scoped to the modeled boundary. Unknown extern behavior is
not trusted and therefore rejected.

## Error Policy

Errors must:

- identify the offending call/expression.
- include source location.
- explain why the effect violated pure context.

## Non-Goals (Current Phase)

- full replacement of TypeScript type system.
- effect polymorphism (future phase).
- capability tokens (future phase).
- automatic proof generation for extern contracts.

## Migration Contract

The effect checker implementation must not use scattered purity allowlists as
decision logic. Purity decisions must be made by formal rule evaluation and a
single extern signature environment.

## Implementation Plan (Legacy Cleanup Included)

Phase 1: Formalize and isolate domains

- Define effect algebra (`Pure`, `Impure`) and inference result types in one
  module.
- Define lattice operations (`join`, subeffect) in one module.
- Define a single extern boundary module (`Sigma`) for JS/runtime effects.

Phase 2: Replace legacy checker internals

- Replace monolithic checker logic with:
  - declaration/signature environment builder (`Gamma`)
  - rule-based inference engine
  - centralized error emission
- Keep one public entrypoint (`checkEffects`) as orchestration only.

Phase 3: Remove obsolete/hacky legacy paths

- Delete the old map-heavy checker logic from `effect-checker.ts`.
- Keep no duplicate purity logic in semantic validator.
- Remove dead helper code introduced by prior iterations.

Phase 4: Validate

- Run `deno task ssot:check` and require zero errors.
- Run `deno task test:unit` and require zero failures.

Current status:

- Phases 1-4 implemented in this branch.
