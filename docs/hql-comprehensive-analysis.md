# HQL Language Implementation — Comprehensive Analysis Report

**Date**: 2026-03-30
**Scope**: All 96 files, ~49,452 LOC in `src/hql/`
**Benchmark**: Clojure as gold-standard Lisp implementation
**Agents**: 7 specialized analysis agents (transpiler, stdlib, macro, type-system, interpreter, performance, dead-code)

---

## Executive Summary

HQL is a well-structured Lisp-to-JavaScript transpiler with a formal effect system, 96% self-hosted stdlib, chunked lazy sequences, and TCO. However, **7 fundamental architectural gaps** separate it from Clojure-quality:

1. **No persistent data structures** — O(n) copy on every conj/assoc/dissoc (vs Clojure's O(log32 n) HAMT)
2. **No protocol dispatch** — ad-hoc instanceof checks, no extensibility
3. **No HQL-level type checking** — relies entirely on downstream TypeScript compiler
4. **Duplicated code paths** — two environment systems, two builtin sets, duplicated template-quote logic
5. **God files** — macro.ts (3,142), hql-ast-to-hql-ir.ts (2,904), ir-to-typescript.ts (3,005), imports.ts (2,037)
6. **Over-specified IR** — 97 node types (Clojure: ~15), TypeScript-mirroring rather than Lisp-semantic
7. **No parser error recovery** — one error per compilation cycle

---

## P0: Critical Issues (Fundamental Architecture)

### 1. No Persistent Data Structures
**Impact**: Every functional programming pattern is O(n) per update instead of O(1) amortized
**Files**: `stdlib.hql`, `core.js`

HQL vectors = plain JS arrays. Maps = plain objects/Map. Sets = JS Set. Every mutation creates a full copy:
- `conj` on array: `[...coll, ...items]` — O(n) copy
- `assoc` on map: `{...m}` + set — O(n) copy
- `dissoc`: copy + delete — O(n) copy

Building a 10,000-element vector via reduce+conj: **O(n^2)** in HQL vs **O(n log32 n)** in Clojure.

Clojure uses HAMT (Hash Array Mapped Trie) with 32-wide branching for O(log32 n) ≈ O(1) structural sharing. This is the single highest-impact improvement possible.

**Recommendation**: Add HAMT-based PersistentVector and PersistentHashMap. Consider `@oguimbal/bplustree` or a custom implementation.

### 2. `__hql_deepFreeze` on Every Const Binding
**Impact**: O(n) recursive freeze with WeakSet cycle detection on every `let` binding, even primitives
**File**: `transpiler/syntax/binding.ts:679`, runtime in `core.js:423-456`

`(let [x 42])` generates `__hql_deepFreeze(42)` — a no-op for primitives but still a function call. `(let [data {:a {:b [1 2 3]}}])` recursively freezes every nested property at runtime. No static analysis to skip fresh literals or primitives.

Clojure avoids this entirely — persistent data structures are immutable by construction.

**Recommendation**: Add escape analysis: skip deepFreeze for primitive types, fresh object literals, and already-frozen values.

### 3. `distinct` is O(n^2)
**Impact**: Building a distinct set of n unique elements is quadratic
**File**: `stdlib.hql:148-156`

Uses `(conj seen f)` where `seen` is a Set. Since `conj` on Set copies the entire Set (`new Set(coll)` + `.add()`), distinct is O(1+2+...+n) = O(n^2).

**Recommendation**: Use mutable JS Set internally within the lazy closure, matching Clojure's transient approach.

---

## P1: High-Severity Issues (DRY Violations, God Files, Missing Features)

### 4. Duplicated Template-Quote Processing (~1,018 LOC)
**Impact**: Maintenance burden, divergence risk
**Files**: `s-exp/macro.ts` lines 505-1522 vs `s-exp/template-quote.ts` (812 LOC)

11 pairs of near-duplicate functions exist. macro.ts has its own syntax-quote processing that mirrors template-quote.ts but uses different parameter conventions. The `createMacroTemplateQuoteContext()` bridge exists but is only used for one path.

**Recommendation**: Delete all `processSyntaxQuoted*` functions from macro.ts and route through template-quote.ts consistently. ~1,000 LOC reduction.

### 5. Two Parallel Environment Systems
**Impact**: O(n) bridge copy per macro expansion, binding staleness risk
**Files**: `environment.ts` (1,225 LOC) vs `interpreter/environment.ts` (107 LOC)

The compiler Environment and InterpreterEnv are two separate scope chain implementations. A bridge function in `macro.ts:238` walks the ENTIRE compiler scope chain and copies all bindings into an InterpreterEnv on every macro expansion.

Clojure has ONE Var system shared between compile-time and runtime.

**Recommendation**: Unify into a single environment with views for compiler vs interpreter needs.

### 6. Duplicated Builtins (~550 LOC redundant)
**Impact**: DRY violation, maintenance divergence
**Files**: `interpreter/builtins.ts` (550 LOC) vs `environment.ts:158-534` (376 LOC)

Both files define the exact same arithmetic, comparison, and collection operations. Two parallel implementations of every `+`, `-`, `*`, `/`, `first`, `rest`, `length`, etc.

**Recommendation**: Single builtin registry shared by both systems.

### 7. macro.ts God File (3,142 LOC → should be ~500)
**Impact**: Unmaintainable, 7 distinct responsibilities in one file
**File**: `s-exp/macro.ts`

Contains: interpreter bridge, local binding tracking, non-local resolution, syntax-quote processing (duplicated), macro definition, macro-time evaluator, expansion loop. Should be split into 5+ focused modules.

### 8. hql-ast-to-hql-ir.ts God File (2,904 LOC)
**Impact**: 1,660 lines of inline handlers in `initializeTransformFactory()`
**File**: `transpiler/hql-ast-to-hql-ir.ts`

425 lines of type expression parsing and 520 lines of TypeScript declaration handlers are embedded inline. 5 mutable module-level globals (`currentSymbolTable`, `currentBindingResolutionContext`, etc.) make the transform non-reentrant.

**Recommendation**: Extract to `syntax/type-expressions.ts` and `syntax/typescript-declarations.ts`. Replace globals with TransformContext object.

### 9. imports.ts God File (2,037 LOC)
**Impact**: 7 responsibilities in one file
**File**: `imports.ts`

Handles import parsing, path resolution, module loading (5+ types), symbol resolution, export collection, error wrapping, and TypeScript transpilation.

**Recommendation**: Split into `import-resolver.ts`, `module-loader.ts`, `export-processor.ts`.

### 10. Import/Export Double-Dispatch
**Impact**: Two code paths doing the same thing, maintenance divergence risk
**File**: `hql-ast-to-hql-ir.ts`

Import/export handling exists both in the `transformFactory` (lines 863, 898) AND in `transformBasedOnOperator` (lines 2289-2330). Method-call handling is similarly duplicated.

**Recommendation**: Remove one path; consolidate into factory-only or structural-check-only.

### 11. Missing Standard Macros (vs Clojure)
**Impact**: Feature gap for idiomatic Lisp programming
**File**: `lib/macro/core.hql`

Missing: `some->`, `some->>`, `cond->`, `cond->>`, `condp`, `case` (O(1) dispatch), `if-some`, `when-some`, `when-first`, `letfn`, `with-open`, `comment`, multi-arity `defmacro`.

### 12. Missing Stdlib Functions (~570 functions short of Clojure)
**Impact**: Only 130/700 Clojure functions covered (19%)
**File**: `lib/stdlib/`

**Critical missing**: `frequencies`, `select-keys`, `remove`, `not-empty`, `contains?`, `memoize`, `complement`, `reduce-kv`, `bounded-count`, `every-pred`, `some-fn`, `fnil`, `tree-seq`, `run!`.

**Not applicable to HQL**: Java interop, STM, agents, multimethods (would need language support).

---

## P2: Medium-Severity Issues (Performance, Correctness, Completeness)

### 13. No Parser Error Recovery
**Impact**: Users get one error per compilation cycle
**File**: `transpiler/pipeline/parser.ts`

First syntax error terminates parsing. Production parsers (TypeScript, Babel) continue past errors. Clojure's reader also stops at first error, but compiles one form at a time (REPL-first), limiting impact.

### 14. No HQL-Level Type Checking
**Impact**: HQL-specific constructs (macros, special forms) get no type feedback
**Files**: Type system is entirely passthrough to TypeScript

Type annotations exist on IR nodes as raw strings — passed through with zero HQL-level validation. The `semantic-validator.ts` (500 LOC) only checks declarations/TDZ, missing: break/continue scoping, unreachable code, loop variable scoping, duplicate keys.

### 15. Over-Specified IR (97 Node Types)
**Impact**: Complexity, TypeScript coupling
**File**: `transpiler/type/hql_ir.ts`

97 IR node types vs Clojure's ~15 and Babel's ~80 (for ALL of JS+JSX+TS+Flow). Includes 16 type-expression nodes and 7 TypeScript-specific declaration nodes that should be in the code generator, not the IR. The IR is essentially a TypeScript AST with different field names.

### 16. Triple-Pass IR Traversal in Code Generation
**Impact**: O(4n) instead of O(n) for compilation
**File**: `transpiler/pipeline/ir-to-typescript.ts`

`generate()` walks the IR 4 times: mutualTCO, collectTopLevelNames, collectHoistableNames, then generateNode. A single-pass architecture would be O(n).

### 17. No Interpreter TCO
**Impact**: Stack overflow at 1000 frames for recursive macros
**File**: `interpreter/interpreter.ts`

`applyHQLFunction` uses simple recursion with depth counter. No `loop`/`recur` support. Complex macros that recurse over long lists will stack overflow.

### 18. No Incremental Compilation
**Impact**: Full pipeline re-run for every REPL evaluation
**Files**: `transpiler/index.ts`, `bundler.ts`

No IR caching, no dependency-aware recompilation. For `(+ 1 2)` in REPL: clone environment, parse, transform, expand, convert to IR, generate TypeScript, run tsc, chain source maps. Clojure compiles individual forms incrementally.

### 19. No Protocol Dispatch Mechanism
**Impact**: Cannot extend seq/collection abstractions to new types
**Files**: `lib/stdlib/`

HQL has 4 ad-hoc protocols (SEQ, COUNTED, INDEXED, CHUNKED) via Symbol-based checks. Missing ~15 Clojure protocols (IAssociative, ILookup, IReduce, etc.). No `defprotocol` / `extend-type` mechanism. Every stdlib function uses `instanceof`/`typeof` — no extensibility.

### 20. Effect System Fragilities
**Impact**: Incorrect purity classifications, fragile heuristics
**File**: `transpiler/effects/`

- `Object.freeze` marked Pure but mutates argument in-place
- `JSON.parse` marked Pure but can throw
- `RegExp.exec` with `g` flag is stateful but marked Pure
- Compiler-generated function detection relies on ABSENCE of position metadata (fragile)
- No effect polymorphism ("pure if callback is pure")

### 21. Unhygienic `repeat` Macro
**Impact**: Variable capture if user names a var `__repeat_i`
**File**: `lib/macro/loop.hql:33`

Uses hardcoded `__repeat_i` instead of auto-gensym `i#`.

### 22. Transducer-Aware `into` Not Wired
**Impact**: Users can't do `(into [] (mapT inc) [1 2 3])` from HQL
**Files**: `stdlib.hql` (2-arity only) vs `core.js` (`intoXform` 3-arity)

The self-hosted `into` only handles 2-arity. The 3-arity transducer form exists in JS as `intoXform` but isn't connected.

---

## P3: Low-Severity / Quality Issues

### 23. Environment Lookup Order Suboptimal
`environment.ts:600-645` — `hyphenToUnderscore` conversion runs BEFORE direct Map.get in the common path. Should only run on direct lookup miss.

### 24. Hardcoded Stdlib Import String
`bundler.ts:406-407` — 70+ named imports as a manually-maintained string. Must be kept in sync with stdlib API.

### 25. Placeholder Functions Swallow Errors
`imports.ts:1333-1336` — Deferred import placeholders return `undefined` silently instead of throwing.

### 26. Module-Level Mutable State in Macros
`macro.ts:65-67, 328, 2414` — Singletons prevent parallel compilation and make testing harder.

### 27. `cond` Macro Causes N Expansion Iterations
`lib/macro/core.hql:217-269` — Recursive macro generates `(if test result (cond remaining...))`, requiring one expansion iteration per clause. Should generate the entire if-chain in a single expansion.

### 28. Redundant HQL AST Layer
`hql_ast.ts` (17 LOC) — Structurally identical to S-expressions. The `convertToHqlAst()` pipeline step is doing renaming, not transformation. Could be eliminated.

### 29. Missing Reader Macros / Tagged Literals
Parser is fixed — no `#inst`, `#uuid` style extensibility. No data readers.

### 30. Circular Import Race Condition
`imports.ts:1531-1535` — Documented but unresolved race between `inProgressFiles.add()` and parallel `Promise.all` import processing.

---

## Performance Summary: HQL vs Clojure

| Operation | HQL | Clojure | Gap |
|-----------|-----|---------|-----|
| Vector conj | O(n) copy | O(log32 n) HAMT | **Critical** |
| Map assoc | O(n) copy | O(log32 n) HAMT | **Critical** |
| Set conj | O(n) copy | O(log32 n) HAMT | **Critical** |
| distinct | O(n^2) | O(n) transient | **High** |
| deepFreeze per binding | O(n) recursive | N/A (immutable by construction) | **High** |
| Macro expansion | O(n) env bridge copy | Shared Var system | **Medium** |
| Compilation | 4-pass over IR | Single-pass | **Medium** |
| REPL eval | Full pipeline | Incremental per-form | **Medium** |
| Lazy sequences | Good (chunked, trampolined) | Excellent | **Low** |
| TCO (self-recursive) | While-loop (optimal) | recur → goto (optimal) | **None** |
| TCO (mutual) | Trampoline (correct) | Not built-in | **HQL ahead** |

---

## Architecture Comparison: HQL vs Clojure

| Aspect | HQL (current) | Clojure | Recommendation |
|--------|--------------|---------|----------------|
| Representations | 6 (source→s-exp→AST→IR→TS→JS) | 3 (source→forms→bytecode) | Eliminate HQL AST layer, simplify IR |
| IR node types | 97 | ~15 | Reduce to ~30 Lisp-semantic nodes |
| Compiler state | 5 mutable module globals | Explicit context param | TransformContext object |
| Environment | 2 parallel systems + O(n) bridge | 1 unified Var system | Unify environments |
| Data structures | Mutable JS + copy-on-write | HAMT persistent | Add persistent collections |
| Protocols | 4 ad-hoc (Symbol-based) | ~20 (defprotocol) | Add protocol dispatch |
| Macros | Good (Clojure-style pragmatic) | Excellent | Add missing macros |
| Effect system | Binary Pure/Impure lattice | None | Unique advantage for HQL |
| Source maps | V3 with position granularity | N/A (JVM bytecode) | Good — keep |
| TCO | Auto-detect + mutual | Explicit recur only | Advantage for HQL |
| Bundling | esbuild-based | JVM classloader | Inherent to JS target |

---

## What HQL Does Better Than Clojure

1. **Automatic TCO** — no need for explicit `recur`, auto-detected in tail position
2. **Mutual recursion TCO** — Tarjan SCC detection + trampoline (Clojure has no built-in mutual TCO)
3. **Formal effect system** — Pure/Impure tracking on `fx` declarations (Clojure has no effect system)
4. **Source maps** — V3 spec with start+end position granularity (JVM languages don't need this)
5. **TypeScript interop** — Type annotations, .d.ts generation, TS compilation integration
6. **Chunked lazy sequences** — Good implementation, NumericRange with O(1) count is better than Clojure's Range
7. **96% self-hosted stdlib** — Eating its own dogfood effectively

---

## Recommended Improvement Roadmap

### Phase 1: Foundation (Highest ROI)
1. Add PersistentVector (HAMT) and PersistentHashMap (HAMT)
2. Fix `distinct` O(n^2) with mutable Set
3. Add deepFreeze escape analysis (skip primitives, fresh literals)
4. Delete ~1,018 LOC duplicate template-quote code from macro.ts

### Phase 2: Cleanup (Code Quality)
5. Split macro.ts → 5 modules
6. Split hql-ast-to-hql-ir.ts (extract inline handlers)
7. Split imports.ts → 3 modules
8. Unify environment systems
9. Consolidate duplicated builtins
10. Fix import/export double-dispatch

### Phase 3: Completeness (Feature Parity)
11. Add missing macros: some->, condp, case, letfn, with-open
12. Add missing stdlib: frequencies, select-keys, remove, memoize, complement
13. Wire transducer-aware 3-arity `into`
14. Add `defprotocol` / `extend-type` mechanism
15. Parser error recovery (report multiple errors)

### Phase 4: Performance (Advanced)
16. Merge 4-pass IR traversal into single pass
17. Add incremental compilation for REPL
18. Replace mutable globals with TransformContext
19. Simplify IR (reduce from 97 to ~30 node types)
20. Eliminate redundant HQL AST representation layer

---

## Appendix A: Dead Code & Unused Exports (40 symbols)

Systematic sweep of all 96 files. Every `export` was checked against all importers in the codebase.

### Dead Exported Interfaces/Types (12)

| File | Symbol | Notes |
|------|--------|-------|
| `transpiler/compiler-context.ts` | `MacroDefinition` | Never imported |
| `transpiler/compiler-context.ts` | `CompilerOptions` | Only used locally |
| `environment.ts` | `ResolvedMacro` | Only used internally |
| `transformer.ts` | `TransformOptions` | Only used locally |
| `imports.ts` | `ImportProcessorOptions` | Only used locally |
| `imports.ts` | `SourceLocationHolder` | Never imported |
| `embedded-package-utils.ts` | `PackagePathMatch` | Never imported |
| `transpiler/pipeline/ts-compiler.ts` | `TypeDiagnostic` | Never imported |
| `s-exp/template-quote.ts` | `TemplateQuoteKind` | Never imported |
| `s-exp/template-quote.ts` | `TemplateQuoteMode` | Never imported |
| `s-exp/template-quote.ts` | `TemplateQuoteContext` | Never imported |
| `transpiler/hql-transpiler.ts` | `TranspileWithIRResult` | Never imported externally |

### Dead Exported Functions (8)

| File | Function | Notes |
|------|----------|-------|
| `interpreter/special-forms.ts` | `hqlValueToSExp()` | Never imported |
| `transpiler/pipeline/ts-compiler.ts` | `formatDiagnostics()` | Never imported |
| `transpiler/pipeline/source-map-support.ts` | `invalidateSourceMapCache()` | Never imported |
| `transpiler/utils/ir-helpers.ts` | `ensureReturnStatement()` | Never imported |
| `transpiler/utils/ir-helpers.ts` | `ensureStatement()` | Never imported |
| `transpiler/utils/ir-helpers.ts` | `createFnExpr()` | Never imported |
| `transpiler/utils/ir-helpers.ts` | `createSwitchCase()` | Never imported |
| `transpiler/utils/ir-helpers.ts` | `createVarDecl()` | Never imported |

### Dead IR Tree Walker Functions (8)

| Function | Notes |
|----------|-------|
| `containsMatch()` | Never imported |
| `containsThrowStatement()` | Never imported |
| `containsNodeTypeInScope()` | Never imported |
| `containsReturnInScope()` | Never imported |
| `containsJumpToLabel()` | Never imported |
| `collectJumpTargets()` | Never imported |
| `collectForOfStatementsInScope()` | Never imported |
| `ScopeWalkOptions` interface | Never imported |

### Dead Exported Constants (7)

| File | Symbol | Notes |
|------|--------|-------|
| `transpiler/keyword/primitives.ts` | `DECLARATION_KEYWORDS` | Only internal composition |
| `transpiler/keyword/primitives.ts` | `BINDING_KEYWORDS` | Only internal composition |
| `transpiler/keyword/primitives.ts` | `JS_LITERAL_KEYWORDS_SET` | Never imported |
| `transpiler/pipeline/ts-compiler.ts` | `PRELUDE_LINE_COUNT` | Never imported externally |
| `transpiler/tokenizer/type-tokenizer.ts` | `countBraceDepth` | Never imported |
| `transpiler/tokenizer/type-tokenizer.ts` | `countBracketDepth` | Never imported |
| `transpiler/tokenizer/type-tokenizer.ts` | `countParenDepth` | Never imported |

### Other Dead Symbols (5)

| File | Symbol | Notes |
|------|--------|-------|
| `interpreter/errors.ts` | `HQLTypeError` class | Never imported |
| `s-exp/types.ts` | `createNilLiteral()` | Never imported |
| `s-exp/types.ts` | `isSExpVectorImport()` | Never imported |
| `s-exp/types.ts` | `isSExpNamespaceImport()` | Never imported |
| `transpiler/symbol_table.ts` | `SymbolTable.clear()` | Method never called |

### Potentially Dead Module

`transpiler/pipeline/source-map-validator.ts` — only imported from test files, never from production code.

### Redundancy Notes

- `macroexpandAll` in `macroexpand.ts:57` is a trivial alias (`= macroexpand`)
- `MacroRegistry` name collision: `compiler-context.ts:25` (interface) vs `s-exp/macro-registry.ts:8` (class)
- No significant commented-out code blocks or stale TODO markers found

---

*Report generated by 7 specialized analysis agents examining 49,452 LOC across 96 files.*
*All 7 analysis domains complete.*
