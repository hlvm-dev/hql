# HQL Feature Roadmap

## Status: Living Document
## Last Updated: 2024-12-02

---

## Vision

HQL aims to be:
- **Lisp expressiveness** with **JavaScript ecosystem** access
- **High abstraction** that compiles to efficient code
- **Future-proof** with path to WASM compilation

---

## Architecture Philosophy

### Why HQL Targets JavaScript

1. **Leverage, Not Reinvent**
   - V8, SpiderMonkey have billions invested in optimization
   - HQL gets this for free

2. **Maximum Reach**
   - Browser, Node, Deno, Bun, Edge, Mobile
   - One language, everywhere

3. **Ecosystem Access**
   - npm has 2M+ packages
   - Direct interop, no bindings

4. **High Abstraction is the Future**
   - Hardware gets faster
   - Developer time is the bottleneck
   - Abstraction wins over raw speed for most use cases

### Why Not Direct WASM/LLVM?

- WASM: No standard JS bytecode exists (each engine is different)
- LLVM: Years of work to build runtime (GC, closures, etc.)
- Better: Target JS now, TypeScript for WASM path later

---

## Feature Roadmap

### Completed

| Feature | Description | Status |
|---------|-------------|--------|
| Core Language | Functions, bindings, conditionals, loops | Done |
| Macro System | Compile-time metaprogramming | Done |
| JS Interop | js-call, js-get, js-set, dot notation | Done |
| Threading Macros | `->`, `->>`, `as->` (Clojure-compatible) | Done |
| Lazy Sequences | Lazy evaluation via stdlib | Done |
| Module System | import/export, circular deps | Done |

### High Priority (Next)

| Feature | Description | Effort | Value |
|---------|-------------|--------|-------|
| Pattern Matching | Destructuring, guards, match expressions | 2-3 weeks | High |
| Parallel Primitives | `pmap`, `pfilter` via Web Workers | 2-3 weeks | High |
| TypeScript Backend | IR → TS for better tooling & WASM path | 2-4 weeks | High |

### Medium Priority

| Feature | Description | Effort | Value |
|---------|-------------|--------|-------|
| Actor Model / CSP | Message passing, channels | 4-6 weeks | Medium |
| Type Annotations | Optional `^type` hints | 1-2 weeks | Medium |
| Better Error Messages | Source-mapped, contextual errors | 2-3 weeks | Medium |

### Future (When Tools Mature)

| Feature | Description | Dependency |
|---------|-------------|------------|
| WASM Output | TS → WASM via porffor or similar | TS backend, tool maturity |
| WasmGC Backend | Direct WasmGC output for GC languages | Browser support |

---

## Detailed Feature Specs

### 1. Pattern Matching

**Syntax:**
```clojure
(match value
  [x y] (+ x y)                    ; Array destructuring
  {:name n} (str "Hello " n)       ; Object destructuring
  (? (> $ 10)) "big"               ; Guard clause
  _ "default")                     ; Wildcard
```

**Compiles to:** Nested if/else with destructuring assignments

### 2. Parallel Primitives

**Syntax:**
```clojure
;; Parallel map - distributes across Web Workers
(pmap expensive-fn large-collection)

;; Parallel filter
(pfilter predicate large-collection)

;; Parallel reduce
(preduce + 0 numbers)
```

**Implementation:** Web Workers with automatic chunking

### 3. Actor Model / CSP Channels

**Syntax:**
```clojure
;; Create a channel
(let ch (chan))

;; Send (non-blocking)
(>! ch value)

;; Receive (blocking in async context)
(let result (<! ch))

;; Select from multiple channels
(select
  [msg (<! ch1)] (handle-ch1 msg)
  [msg (<! ch2)] (handle-ch2 msg)
  :default (handle-timeout))
```

**Implementation:** Based on core.async semantics, compiled to JS generators/async

### 4. TypeScript Backend

See: [hql_typescript_backend.md](./hql_typescript_backend.md)

---

## Non-Goals

Things HQL explicitly does NOT aim to do:

1. **Compete with Rust on performance** - Use Rust for hot paths, call from HQL
2. **Replace JavaScript entirely** - Interop is a feature, not a limitation
3. **Full TCO for all recursion** - `loop/recur` is sufficient (matches Clojure)
4. **Build our own VM/runtime** - Leverage existing JS engines

---

## Success Metrics

How we measure if HQL is successful:

1. **Adoption** - Projects using HQL in production
2. **Developer Experience** - Time from idea to working code
3. **Performance** - Within 2x of hand-written JS for typical code
4. **Ecosystem** - Easy to use any npm package

---

## Contributing

To propose a new feature:
1. Create a spec document in `docs/specs/`
2. Include: motivation, syntax, semantics, implementation plan
3. Open discussion before implementation

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2024-12-02 | Initial roadmap document |
