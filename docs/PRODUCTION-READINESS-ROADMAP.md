# HQL Production Readiness Roadmap (vs Clojure-Level Expectations)

This document is the execution backlog for closing the biggest deltas between
HQL and production-grade Clojure ecosystems.

Status legend:

- `[x]` done
- `[~]` in progress
- `[ ]` not started

## Immediate Baseline (Bootstrapped in this change)

- `[x]` `deno task test:conformance` task exists and runs MCP conformance tests.
- `[x]` `deno task check:stdlib:generated` gate exists.
- `[x]` `deno task check:stdlib:deterministic` gate exists.
- `[x]` `deno task check:prod:p0` meta-gate exists.

## P0: Must-Have Before “Production-Grade” Claim

### Language Contract + Compatibility

- `[ ]` P0-01: Publish canonical language spec v1.0.
  - Done when:
  - Parser grammar, macro expansion order, eval semantics, error model, and
    runtime semantics are documented.
  - Versioned compatibility policy and deprecation window are documented.
- `[ ]` P0-02: Add spec conformance suite.
  - Done when:
  - Every normative rule from P0-01 has at least one executable conformance
    test.
  - CI reports conformance pass/fail as a separate stage.
- `[ ]` P0-03: Add semver + compatibility governance.
  - Done when:
  - Breaking-change rubric is written and enforced in PR checklist.
  - Release notes classify breaking/additive/fix changes.

### Build Integrity + Determinism

- `[~]` P0-04: Enforce generated stdlib integrity.
  - Done when:
  - `deno task check:stdlib:generated` passes in CI and blocks merges on
    failure.
- `[~]` P0-05: Enforce deterministic stdlib builds.
  - Done when:
  - `deno task check:stdlib:deterministic` passes in CI and blocks merges.
- `[ ]` P0-06: Add full build determinism check (not only stdlib).
  - Done when:
  - Rebuilding full compile artifacts twice yields byte-identical outputs.

### Correctness + Regression Safety

- `[ ]` P0-07: IR golden/snapshot tests for core syntax families.
  - Done when:
  - Binding, function, class, macro-expanded control-flow, and interop snapshots
    are covered.
- `[ ]` P0-08: Source map fidelity tests.
  - Done when:
  - Runtime stack traces map to exact HQL source line/column for representative
    failures.
- `[ ]` P0-09: Bug-regression policy.
  - Done when:
  - Every bug fix ships with a permanent repro test.

### Compiler/Runtime Hardening

- `[ ]` P0-10: Parser + macro fuzzing.
  - Done when:
  - Fuzz suite runs in CI and captures crashers with shrinking repros.
- `[ ]` P0-11: Macro sandbox hardening policy.
  - Done when:
  - Macro execution boundary is documented and unsafe host effects are
    controlled.
- `[ ]` P0-12: Property tests for sequence/transducer invariants.
  - Done when:
  - Composition, associativity-style expectations, and reduced semantics are
    property-tested.

### Performance Baselines

- `[ ]` P0-13: Define compile latency budgets (cold/warm).
  - Done when:
  - Budgets are written and benchmarked in CI/perf jobs.
- `[ ]` P0-14: Define memory budgets for large-project compile.
  - Done when:
  - Benchmark fixtures and failure thresholds exist.

### CI + Release Gatekeeping

- `[ ]` P0-15: Expand CI matrix and make P0 gates blocking.
  - Done when:
  - OS/runtime matrix is explicit and all P0 checks are required.
- `[ ]` P0-16: Release automation with rollback path.
  - Done when:
  - Release checklist is encoded in workflow and rollback procedure is
    documented.

## P1: High-Impact Gaps vs Clojure Ergonomics

### Data Structures + Performance Model

- `[ ]` P1-01: Persistent vector/map/set with structural sharing.
  - Done when:
  - Core collection ops stop relying on O(n) spread-copy semantics for updates.
- `[ ]` P1-02: Transient-like fast mutable build path.
  - Done when:
  - Bulk operations have optimized mutable construction with safe freeze/commit
    boundary.
- `[ ]` P1-03: Lazy-seq and transducer benchmark suite.
  - Done when:
  - Benchmark tracks throughput/alloc trends and regressions are gated.

### Compiler Throughput

- `[ ]` P1-04: Incremental compilation cache (AST/IR/TS artifacts).
  - Done when:
  - Repeated builds only recompile changed modules and dependents.
- `[ ]` P1-05: Watch-mode invalidation graph.
  - Done when:
  - File changes trigger targeted recompilation with correct dependency
    invalidation.

### Developer Tooling

- `[ ]` P1-06: LSP upgrades (xref, rename, refactor-safe operations).
  - Done when:
  - Cross-file rename/refactor flows are available and tested.
- `[ ]` P1-07: REPL upgrades (safe reload, namespace-aware hot reload).
  - Done when:
  - Interactive workflows preserve state predictably and report stale deps
    clearly.
- `[ ]` P1-08: Formatter + linter stability contract.
  - Done when:
  - Style/output is deterministic and versioned.

### Interop + Type Surface

- `[ ]` P1-09: Strengthen generated/public `.d.ts` surface.
  - Done when:
  - Public exports have useful types and checked examples from TS consumers.
- `[ ]` P1-10: Publish API compatibility test harness for TS consumers.
  - Done when:
  - Representative downstream TS projects compile across supported versions.

### Library Parity (Pragmatic)

- `[ ]` P1-11: Fill highest-impact stdlib parity gaps.
  - Done when:
  - A prioritized subset (string/set/core map helpers) is implemented based on
    usage data.

## P2: Ecosystem and Operational Maturity

### Ecosystem Growth

- `[ ]` P2-01: Official core package set with compatibility guarantees.
  - Done when:
  - Core libs have ownership, release policy, and version compatibility matrix.
- `[ ]` P2-02: Production templates (service/CLI/worker/web).
  - Done when:
  - Templates are maintained, tested, and documented.

### Production Operations

- `[ ]` P2-03: Observability conventions (logging/metrics/tracing).
  - Done when:
  - Standard hooks and integration examples exist.
- `[ ]` P2-04: Supply-chain hardening (audit/SBOM/provenance).
  - Done when:
  - Security scanning and artifact provenance are part of release pipeline.
- `[ ]` P2-05: Long-term support + migration guides.
  - Done when:
  - Supported version windows and upgrade playbooks are published.

## Execution Plan (Run All Tracks in Parallel)

### Track A: Language Contract

- P0-01, P0-02, P0-03

### Track B: Build + Correctness Gates

- P0-04, P0-05, P0-06, P0-07, P0-08, P0-09

### Track C: Hardening + Perf

- P0-10, P0-11, P0-12, P0-13, P0-14

### Track D: Runtime/Compiler Capability

- P1-01, P1-02, P1-03, P1-04, P1-05

### Track E: Tooling + Ecosystem

- P1-06..P1-11, P2-01..P2-05

## Acceptance Rule

HQL is “production-grade vs Clojure baseline” only when:

- All P0 items are complete.
- P1 items that affect core runtime/compiler behavior are complete.
- P2 has at least the operational minimum: templates + observability +
  release/security baseline.
