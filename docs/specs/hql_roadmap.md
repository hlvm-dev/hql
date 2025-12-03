# HQL Feature Roadmap

## Status: Living Document
## Last Updated: 2025-12-03

---

## Vision

HQL aims to be:
- **Lisp expressiveness** with **JavaScript ecosystem** access
- **High abstraction** that compiles to efficient code
- **Universal reach**: Run everywhere JavaScript runs (which is everywhere)

**Key Insight**: JavaScript already runs everywhere that matters — browsers, servers (Node/Deno/Bun), edge workers, mobile (React Native), desktop (Electron), and even compiles to native binaries (via Deno compile). The JS backend achieves universal reach TODAY.

---

## Architecture Philosophy

### Core Strategy: Hub and Spoke from HQL IR

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         HQL COMPILATION ARCHITECTURE                             │
│                              "Hub and Spoke Model"                               │
└─────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────────┐
                              │      HQL Source     │
                              │     (your code)     │
                              └──────────┬──────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    │         HQL COMPILER (we build)         │
                    │                    │                    │
                    │    Parser → Macro → AST → IR → Opt     │
                    │                    │                    │
                    └────────────────────┼────────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │       HQL IR        │ ◄── SINGLE SOURCE OF TRUTH
                              │    (hub, center)    │     (optimized, validated)
                              └──────────┬──────────┘
                                         │
                          ┌──────────────┴──────────────┐
                          │                             │
                          ▼                             ▼
                   ┌────────────┐               ┌────────────┐
                   │ JS Backend │               │Rust Backend│
                   │  (spoke 1) │               │  (spoke 2) │
                   │            │               │            │
                   │ ir-to-js   │               │ ir-to-rust │
                   └──────┬─────┘               └──────┬─────┘
                          │                        │       │
                          ▼                        ▼       ▼
                     JavaScript               wasm-pack   cargo
                          │                        │       │
            ┌─────────────┼─────────────┐          │       │
            ▼             ▼             ▼          ▼       ▼
        Browser        Node.js        Deno       WASM   Native
        (Chrome)       (Server)       (Bun)    (Edge)  (Binary)
```

### Architecture: JS Primary + Rust Optional Future

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  JS BACKEND: PRIMARY — "Universal Reach, Today"                                 │
│  ──────────────────────────────────────────────                                 │
│                                                                                 │
│  Philosophy:  Same code runs on all JavaScript platforms                        │
│  Targets:     Browser, Node.js, Deno, Bun, Edge Workers                        │
│  + Native:    Deno compile → self-contained binaries (Linux, macOS, Windows)   │
│  Strength:    npm ecosystem (2M+ packages), rapid iteration                    │
│  Use cases:   Web apps, APIs, scripts, CLI tools, native binaries              │
│  Status:      COMPLETE — achieves universal reach                               │
│                                                                                 │
│  KEY INSIGHT: JavaScript runs everywhere WASM runs, and V8 is faster than      │
│  QuickJS-in-WASM. Deno compile provides native binaries without Rust.          │
│                                                                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│  RUST BACKEND: OPTIONAL FUTURE — "Performance When Needed"                      │
│  ─────────────────────────────────────────────────────────                      │
│                                                                                 │
│  Philosophy:  Direct compilation to optimized native code                       │
│  Targets:     Native binaries, WASM modules                                    │
│  Strength:    Raw performance, minimal binary size, no V8 overhead             │
│  Use cases:   Performance-critical systems, embedded, game scripting           │
│  Status:      FUTURE — build when market demands it                            │
│                                                                                 │
│  NOT NEEDED FOR: Universality (JS already achieves this)                       │
│  NEEDED FOR: Performance optimization niche market                              │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### HQL's Peer Group

HQL is a **high-level language targeting JavaScript**, similar to:
- **ClojureScript**: Clojure → JavaScript (expressiveness + ecosystem)
- **Elm**: Functional → JavaScript (safety + ecosystem)
- **TypeScript**: Types → JavaScript (tooling + ecosystem)

NOT a systems language like Nim/Zig that target native code. HQL optimizes for **expressiveness + ecosystem access**, not raw performance.

### Why Two Backends, Not Chained

We evaluated several strategies:

| Strategy | Description | Verdict |
|----------|-------------|---------|
| TS Intermediate | HQL → TS → Tools → Targets | ❌ No TS→WASM/Native tools exist |
| WasmGC Direct | HQL IR → WasmGC | ❌ 6-12 months effort, reinventing wheel |
| Javy (QuickJS) | JS → WASM via embedded engine | ⚠️ Works but 2MB+ overhead |
| **Hub & Spoke** | HQL IR → {JS, Rust} directly | ✓ Proven pattern, each backend optimized |

**Key Insight**: TypeScript→WASM tooling doesn't exist (porffor is experimental, AssemblyScript is a different language). Rather than hope for tools that may never mature, we generate directly from HQL IR to each target.

### Why Rust (Not C)

Both C and Rust can produce native binaries and WASM. We chose Rust for **user experience**:

| Aspect | C | Rust |
|--------|---|------|
| WASM Build | `emcc` with complex flags | `wasm-pack build` (one command) |
| Cross-compile | Manual toolchain setup | `cargo build --target x86_64-linux` |
| Package mgmt | vcpkg/conan/manual | `cargo` (unified) |
| Memory safety | Manual, segfaults possible | Guaranteed, no segfaults |
| Lisp→X precedent | 30+ years (Chicken Scheme) | Less, but growing |

**Trade-off**: Rust codegen is harder to write (borrow checker), but output is easier for users to consume. We absorb complexity once; users benefit forever.

---

## Feature Roadmap

### Completed

| Feature | Description | Status |
|---------|-------------|--------|
| Core Language | Functions, bindings, conditionals, loops | ✅ Done |
| Macro System | Compile-time metaprogramming | ✅ Done |
| JS Interop | js-call, js-get, js-set, dot notation | ✅ Done |
| Threading Macros | `->`, `->>`, `as->` (Clojure-compatible) | ✅ Done |
| Lazy Sequences | Lazy evaluation via stdlib | ✅ Done |
| Module System | import/export, circular deps, HTTP imports | ✅ Done |
| Pattern Matching | `match/case/default` with guards, destructuring | ✅ Done |
| TCO | Automatic tail call optimization | ✅ Done |

### High Priority (Next)

| Feature | Description | Effort | Value |
|---------|-------------|--------|-------|
| HQL CLI Toolchain | `hql compile` wrapping Deno compile | 1-2 days | High |

**HQL CLI Toolchain unlocks:**
- `hql compile app.hql` → JavaScript output
- `hql compile app.hql --target native` → Native binary (current platform)
- `hql compile app.hql --target linux/macos/windows` → Cross-compiled binaries
- Users never need to type "deno" — HQL is fully self-contained

### Medium Priority

| Feature | Description | Effort | Value |
|---------|-------------|--------|-------|
| Type Annotations | Optional `^type` hints in HQL | 1-2 weeks | Medium |
| Better Error Messages | Source-mapped, contextual | 2-3 weeks | Medium |

### Future (Optional)

| Feature | Description | When |
|---------|-------------|------|
| Rust Backend | HQL IR → Rust → Native/WASM | When performance market demands |
| Actor Model / CSP | Message passing, channels | Design needed |
| Additional Backends | LLVM direct, etc. | If needed |

**Note on Rust Backend**: The specification exists in [hql_rust_backend.md](./hql_rust_backend.md). Build when:
- Users need smaller binaries (50-100MB → 5-10MB)
- Users need raw performance (no V8 overhead)
- Embedded/game scripting markets emerge

---

## CLI Interface

### Commands

```bash
hql repl                               # Interactive REPL
hql init                               # Initialize new project
hql run app.hql                        # Execute HQL directly
hql compile app.hql                    # Compile to JavaScript (default)
hql publish                            # Publish package
```

### `hql compile` (wraps Deno compile)

```bash
# Compile to JavaScript (default)
hql compile app.hql                    # → app.js

# Compile to native binary
hql compile app.hql --target native    # → app (current platform)
hql compile app.hql --target native -o myapp  # → myapp

# Cross-compilation
hql compile app.hql --target linux       # → Linux x86_64 binary
hql compile app.hql --target macos       # → macOS ARM64 binary (Apple Silicon)
hql compile app.hql --target macos-intel # → macOS x86_64 binary (Intel)
hql compile app.hql --target windows     # → Windows .exe

# Compile for all platforms
hql compile app.hql --target all         # → 4 binaries
```

**Key Design**: Users interact only with `hql` — Deno is an implementation detail. The HQL binary itself is compiled with `deno compile`, and can spawn itself to compile user code.

---

## The HQL IR

HQL IR is the **single source of truth** — an optimized, JavaScript-shaped AST where all backends read from:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  HQL IR (Internal Representation)                                               │
│  ────────────────────────────────                                               │
│                                                                                 │
│  Purpose:     Optimization target, backend input                                │
│  Structure:   FunctionDeclaration, IfStatement, WhileStatement, etc.           │
│  Similar to:  ESTree (JavaScript AST standard)                                 │
│                                                                                 │
│  Optimizations applied at IR level:                                            │
│  • TCO - tail recursive functions → while loops                                │
│  • For-loop optimization - foreach → native for loops                          │
│  • Semantic validation - duplicate declarations, TDZ                           │
│  • (Future) Dead code elimination                                              │
│  • (Future) Inlining                                                           │
│                                                                                 │
│  All backends consume the SAME optimized IR                                    │
│  No backend-specific optimization needed                                       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Feature Specs

### 1. Pattern Matching (Completed)

See: [docs/features/15-pattern-matching/](../features/15-pattern-matching/)

### 2. TCO - Tail Call Optimization (Completed)

See: [docs/features/16-tco/](../features/16-tco/)

```lisp
(fn factorial [n acc]
  (if (<= n 1) acc
    (factorial (- n 1) (* n acc))))
;; Automatically optimized to while loop - no stack overflow
```

### 3. Rust Backend (Future, Optional)

See: [hql_rust_backend.md](./hql_rust_backend.md)

**Status**: Future enhancement for performance optimization. Not needed for universal reach.

**When to build:**
- Market demands smaller binaries (5-10MB vs 50-100MB)
- Users need raw performance without V8 overhead
- Embedded systems or game scripting use cases emerge

### 4. Actor Model / CSP Channels (Future)

```clojure
;; Create a channel
(let ch (chan))

;; Send/receive
(>! ch value)
(let result (<! ch))

;; Select from multiple channels
(select
  [msg (<! ch1)] (handle-ch1 msg)
  [msg (<! ch2)] (handle-ch2 msg)
  :default (handle-timeout))
```

---

## Non-Goals

Things HQL explicitly does NOT aim to do:

1. **Compete with Rust on raw performance** - Use Rust for hot paths, call from HQL
2. **Replace JavaScript entirely** - Interop is a feature, not a limitation
3. **Full TCO for ALL recursion** - Only tail calls; tree recursion uses stack
4. **Build our own VM/runtime** - Leverage existing engines (V8, Rust)
5. **Chain through intermediate languages** - Direct IR → target, no TS middleman

---

## Success Metrics

1. **Adoption** - Projects using HQL in production
2. **Developer Experience** - Time from idea to working code
3. **Performance** - Within 2x of hand-written JS/Rust for typical code
4. **Ecosystem** - Easy to use npm packages (JS) and crates (Rust)
5. **Multi-Target** - Same HQL code builds as JS, WASM, or native

---

## External Tools We Leverage

### JS Backend (Existing)

| Tool | Purpose | Status |
|------|---------|--------|
| esbuild | Fast bundling | Stable |
| Babel | Code generation | Stable |
| V8/SpiderMonkey | Runtime | Stable |

### Rust Backend (Planned)

| Tool | Purpose | Status |
|------|---------|--------|
| rustc | Rust compiler | Stable |
| cargo | Build system | Stable |
| wasm-pack | WASM toolchain | Stable |
| wasm-bindgen | JS interop in WASM | Stable |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2024-12-02 | Initial roadmap document |
| 0.2 | 2024-12-03 | Added Pattern Matching and TCO as completed |
| 0.3 | 2024-12-03 | TypeScript backend strategy (superseded) |
| 0.4 | 2025-12-03 | Two-backend architecture (JS + Rust), hub-and-spoke model |
| 0.5 | 2025-12-03 | **Architecture finalized**: JS backend PRIMARY (universal reach), Rust backend OPTIONAL FUTURE (performance niche). Added `hql compile` CLI specification. |
