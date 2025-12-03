# HQL Rust Backend Specification

## Status: Future Enhancement (Optional)
## Date: 2025-12-03
## Author: Architecture Discussion

---

## ⚠️ Important Context

**This is an OPTIONAL FUTURE enhancement, not an immediate priority.**

The JS backend already achieves HQL's primary goal of **universal reach**:
- JavaScript runs everywhere WASM runs (and V8 is faster than QuickJS-in-WASM)
- `deno compile` produces native binaries for all major platforms
- Users never need to leave the HQL ecosystem

**Build the Rust backend when:**
- Market demands smaller binaries (5-10MB vs 50-100MB with embedded V8)
- Users need raw performance without V8 overhead
- Embedded systems or game scripting use cases emerge

---

## Executive Summary

This specification outlines HQL's **Rust Backend** — a second compilation target that generates Rust source code from HQL IR, enabling native binaries and WebAssembly output.

**Key Insight**: By generating Rust, HQL gains access to the mature Rust toolchain (cargo, wasm-pack, cross-compilation) without building custom native/WASM infrastructure.

**When to build**: When performance optimization becomes a market demand, not for universality.

---

## Architecture Overview

### The Hub and Spoke Model

HQL uses a **hub and spoke** architecture where HQL IR is the central hub, and backends are independent spokes:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         HQL COMPILATION ARCHITECTURE                             │
└─────────────────────────────────────────────────────────────────────────────────┘

                                    HQL Source
                                        │
                                        ▼
                              ┌─────────────────┐
                              │     HQL IR      │ ◄── Single Source of Truth
                              │    (the hub)    │
                              └────────┬────────┘
                                       │
                        ┌──────────────┴──────────────┐
                        │                             │
                        ▼                             ▼
                 ┌────────────┐               ┌────────────┐
                 │ JS Backend │               │Rust Backend│
                 │ (existing) │               │   (NEW)    │
                 └─────┬──────┘               └─────┬──────┘
                       │                            │
                       ▼                       ┌────┴────┐
                  JavaScript                   ▼         ▼
                       │                    Rust      Rust
                       │                   Source    Source
            ┌──────────┼──────────┐            │         │
            ▼          ▼          ▼            ▼         ▼
         Browser    Node.js     Deno       wasm-pack   cargo
                                               │         │
                                               ▼         ▼
                                             WASM     Native
                                                      Binary
```

### Why Two Backends (Not Chained)

| Approach | Description | Problem |
|----------|-------------|---------|
| HQL → TS → Rust | Chain through TypeScript | No TS→Rust tool exists |
| HQL → TS → WASM | Chain through TypeScript | porffor experimental, AssemblyScript is different language |
| HQL → JS → WASM | Chain through JavaScript | Javy works but 2MB+ overhead |
| **HQL IR → Rust** | Direct generation | ✅ Clean, no dependencies on uncertain tools |

**Each backend generates directly from HQL IR.** No chaining through intermediate languages.

---

## The Two Philosophies

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│  JS BACKEND                              RUST BACKEND                           │
│  ──────────                              ────────────                           │
│                                                                                 │
│  "Write Once, RUN Everywhere"            "Write Once, PORT Everywhere"          │
│                                                                                 │
│  Same JS runs on all platforms           Compile to each platform               │
│  Browser, Node, Deno, Bun, Edge          Linux, macOS, Windows, ARM, WASM       │
│                                                                                 │
│  npm ecosystem (2M+ packages)            Standalone executables                 │
│  Rapid iteration                         Maximum performance                    │
│  No compilation for end users            No runtime needed                      │
│                                                                                 │
│  Use case:                               Use case:                              │
│  • Web applications                      • CLI tools                            │
│  • API servers                           • High-performance servers             │
│  • Scripts                               • WASM modules                         │
│  • Prototyping                           • Embedded systems                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Why Rust (Not C)

We considered both C and Rust. Both can produce native binaries and WASM.

### Comparison

| Aspect | C | Rust |
|--------|---|------|
| **Lisp→X Precedent** | 30+ years (Chicken Scheme) | Growing |
| **Codegen Complexity** | Lower (no borrow checker) | Higher |
| **Compile Speed** | Fast | Slow |
| **WASM Toolchain** | Emscripten (complex flags) | wasm-pack (one command) |
| **Cross-compile** | Manual toolchain setup | `cargo build --target` |
| **Package Management** | vcpkg/conan/manual | cargo (unified) |
| **Memory Safety** | Manual, segfaults possible | Guaranteed |
| **User Experience** | Harder to use output | Easier to use output |

### The Trade-off

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│  C Backend:                                                                     │
│  • Easier to WRITE the compiler (simpler codegen)                              │
│  • Harder for USERS to consume (toolchain pain)                                │
│                                                                                 │
│  Rust Backend:                                                                  │
│  • Harder to WRITE the compiler (borrow checker)                               │
│  • Easier for USERS to consume (cargo/wasm-pack just work)                     │
│                                                                                 │
│  Decision: Optimize for USER EXPERIENCE                                        │
│  We absorb complexity ONCE; users benefit FOREVER                              │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### The "Free Lunch" from Rust Toolchain

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  WHAT RUST GIVES US FOR FREE                                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  1. WASM Generation                                                             │
│     $ wasm-pack build --target web                                             │
│     → Optimal WASM + JS bindings, one command                                  │
│                                                                                 │
│  2. Cross-Compilation                                                           │
│     $ cargo build --target x86_64-unknown-linux-musl                           │
│     → Linux binary from macOS, just works                                      │
│                                                                                 │
│  3. Package Management                                                          │
│     $ cargo add serde                                                          │
│     → Unified, consistent, no vcpkg/conan/manual pain                          │
│                                                                                 │
│  4. Memory Safety                                                               │
│     → Zero segfaults in generated code                                         │
│     → No debugging memory corruption                                           │
│                                                                                 │
│  5. Optimization                                                                │
│     → LLVM optimizes generated Rust automatically                              │
│     → Release builds are fast without manual tuning                            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Technical Design

### The HQL Runtime (Rust Crate)

A small Rust runtime library that handles HQL's dynamic typing:

```rust
// hql-runtime/src/lib.rs

use std::rc::Rc;
use std::cell::RefCell;
use std::collections::HashMap;

/// Universal value type for HQL's dynamic typing
#[derive(Clone)]
pub enum Value {
    Nil,
    Bool(bool),
    Number(f64),
    String(Rc<String>),
    Symbol(Rc<String>),
    Keyword(Rc<String>),
    List(Rc<RefCell<Vec<Value>>>),
    Vector(Rc<RefCell<Vec<Value>>>),
    Map(Rc<RefCell<HashMap<String, Value>>>),
    Fn(Rc<dyn Fn(Vec<Value>) -> Value>),
}

// Arithmetic operations
impl Value {
    pub fn add(&self, other: &Value) -> Value {
        match (self, other) {
            (Value::Number(a), Value::Number(b)) => Value::Number(a + b),
            (Value::String(a), Value::String(b)) => {
                Value::String(Rc::new(format!("{}{}", a, b)))
            }
            _ => panic!("Type error: cannot add {:?} and {:?}", self, other),
        }
    }

    pub fn sub(&self, other: &Value) -> Value {
        match (self, other) {
            (Value::Number(a), Value::Number(b)) => Value::Number(a - b),
            _ => panic!("Type error: cannot subtract"),
        }
    }

    // ... mul, div, comparison ops, etc.
}

// Boolean coercion (Lisp truthiness)
impl Value {
    pub fn is_truthy(&self) -> bool {
        match self {
            Value::Nil => false,
            Value::Bool(b) => *b,
            _ => true,  // Everything else is truthy
        }
    }
}
```

### The "Dumb Rust" Strategy

We generate simple, correct Rust code rather than clever, optimized Rust:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  "DUMB RUST" STRATEGY                                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  DO:                                                                            │
│  • Use Rc<RefCell<T>> everywhere for reference counting                        │
│  • Clone values when in doubt                                                   │
│  • Use Value enum for all HQL values                                           │
│  • Generate verbose but correct code                                            │
│                                                                                 │
│  DON'T:                                                                         │
│  • Try to infer ownership/lifetimes                                            │
│  • Optimize for minimal allocations                                            │
│  • Generate "idiomatic" Rust                                                   │
│                                                                                 │
│  WHY:                                                                           │
│  • Borrow checker is satisfied automatically                                   │
│  • Code compiles without fighting Rust                                         │
│  • LLVM still optimizes the result                                             │
│  • Correctness over cleverness                                                 │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Code Generation Examples

**HQL Input:**
```clojure
(fn factorial [n acc]
  (if (<= n 1)
    acc
    (factorial (- n 1) (* n acc))))

(print (factorial 10 1))
```

**Generated Rust:**
```rust
use hql_runtime::Value;

fn factorial(mut n: Value, mut acc: Value) -> Value {
    loop {  // TCO applied
        if n.lte(&Value::Number(1.0)).is_truthy() {
            return acc;
        }
        let new_n = n.sub(&Value::Number(1.0));
        let new_acc = n.mul(&acc);
        n = new_n;
        acc = new_acc;
    }
}

fn main() {
    let result = factorial(Value::Number(10.0), Value::Number(1.0));
    println!("{}", result);
}
```

**HQL Input (with closures):**
```clojure
(fn make-adder [x]
  (fn [y] (+ x y)))

(let add5 (make-adder 5))
(print (add5 10))  ;; => 15
```

**Generated Rust:**
```rust
use hql_runtime::Value;
use std::rc::Rc;

fn make_adder(x: Value) -> Value {
    let x = x.clone();  // Capture by cloning
    Value::Fn(Rc::new(move |args: Vec<Value>| {
        let y = args[0].clone();
        x.add(&y)
    }))
}

fn main() {
    let add5 = make_adder(Value::Number(5.0));

    // Call the closure
    if let Value::Fn(f) = &add5 {
        let result = f(vec![Value::Number(10.0)]);
        println!("{}", result);  // 15
    }
}
```

---

## CLI Interface

### Proposed Commands

```bash
# JavaScript (default, existing behavior)
hql run app.hql                      # Execute immediately via JS
hql build app.hql                    # → dist/app.mjs (JavaScript)

# Native binaries (via Rust backend)
hql build app.hql --target native    # → Binary for current platform
hql build app.hql --target linux     # → Linux x86_64 binary
hql build app.hql --target macos     # → macOS binary
hql build app.hql --target windows   # → Windows .exe
hql build app.hql --target arm64     # → ARM64 binary

# WebAssembly (via Rust backend)
hql build app.hql --target wasm      # → app.wasm + JS bindings

# Intermediate output (for debugging)
hql build app.hql --emit rust        # → Generated Rust source
```

### What Happens Internally

```
USER COMMAND                           INTERNAL PIPELINE
────────────                           ─────────────────
hql build app.hql                      HQL → IR → JS (existing)
hql build app.hql --target native      HQL → IR → Rust → cargo build
hql build app.hql --target wasm        HQL → IR → Rust → wasm-pack build
hql build app.hql --target linux       HQL → IR → Rust → cargo build --target x86_64-linux
hql build app.hql --emit rust          HQL → IR → Rust source (stop here)
```

---

## Implementation Plan

### Phase 1: HQL Runtime Crate (2 weeks)

```
hql-runtime/
├── Cargo.toml
├── src/
│   ├── lib.rs           # Main exports
│   ├── value.rs         # Value enum
│   ├── ops.rs           # Arithmetic, comparison
│   ├── collections.rs   # List, Vector, Map operations
│   └── builtins.rs      # print, str, etc.
```

**Deliverables:**
- [ ] Value enum with all HQL types
- [ ] Arithmetic operators (+, -, *, /, %)
- [ ] Comparison operators (=, <, >, <=, >=)
- [ ] Boolean operations (and, or, not)
- [ ] Collection operations (first, rest, conj, get)
- [ ] String operations (str, concat)
- [ ] Closure support via Rc<dyn Fn>
- [ ] Print/debug support

### Phase 2: Code Generator (3 weeks)

```
src/transpiler/
├── backends/
│   ├── javascript/
│   │   └── ir-to-js.ts      # Existing
│   └── rust/
│       ├── ir-to-rust.ts    # NEW: IR → Rust source
│       └── rust-runtime.ts  # NEW: Runtime code embedding
```

**Deliverables:**
- [ ] `ir-to-rust.ts` module
- [ ] Convert all IR node types to Rust
- [ ] Handle closures with move semantics
- [ ] TCO → loop transformation (already in IR)
- [ ] Pattern matching → Rust match
- [ ] Generate valid, compilable Rust

### Phase 3: Build Integration (1 week)

**Deliverables:**
- [ ] CLI `--target native|wasm|linux|macos|windows` flags
- [ ] Generate Cargo.toml for each build
- [ ] Invoke cargo/wasm-pack from HQL CLI
- [ ] Handle build output and errors
- [ ] Clean temporary build artifacts

### Phase 4: Testing & Polish (1 week)

**Deliverables:**
- [ ] All HQL tests pass via Rust backend
- [ ] Benchmark vs JS backend
- [ ] Documentation
- [ ] Example projects

**Total: 5-6 weeks**

---

## Performance Expectations

### Compared to JS Backend

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  PERFORMANCE COMPARISON                                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  Aspect              JS Backend           Rust Backend                          │
│  ──────              ──────────           ────────────                          │
│  Startup time        Instant              Instant (compiled binary)             │
│  Execution           V8-optimized JIT     LLVM-optimized native                 │
│  Memory              GC overhead          Rc overhead (less)                    │
│  Numeric             Fast (V8)            Faster (native f64)                   │
│  Allocation          Fast (V8 GC)         Rc/clone overhead                     │
│                                                                                 │
│  Expected: Rust backend ~2-5x faster for compute-heavy code                    │
│  Note: Dynamic typing overhead exists in both                                  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### The Dynamic Typing Tax

Both backends pay a "dynamic typing tax" compared to statically-typed languages:

```rust
// Static Rust (hand-written)
fn factorial(n: i64, acc: i64) -> i64 { ... }  // Direct i64, no boxing

// HQL-generated Rust
fn factorial(n: Value, acc: Value) -> Value { ... }  // Value enum, runtime checks
```

This is inherent to HQL being a dynamic Lisp. The Rust backend's advantage is in:
- Native code execution (no JIT warmup)
- Better memory efficiency (Rc vs GC)
- LLVM optimizations on inner loops

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Borrow checker fights | Medium | Medium | "Dumb Rust" strategy (Rc everywhere) |
| Closure complexity | Medium | Medium | Clone captures, Rc<dyn Fn> |
| Performance worse than expected | Low | Medium | Benchmark early, optimize hot paths |
| Rust compile times slow UX | High | Low | Cache builds, incremental compilation |
| wasm-pack issues | Low | Low | wasm-pack is mature, fallback to manual |

---

## Success Criteria

1. **Correctness**: All HQL tests pass via Rust backend
2. **Compilation**: Generated Rust compiles without errors
3. **Performance**: Native binary faster than JS for compute benchmarks
4. **WASM**: wasm-pack produces working .wasm modules
5. **Cross-compile**: Can target Linux/macOS/Windows from any platform
6. **User Experience**: `hql build --target native` just works

---

## Future Possibilities

With Rust backend:

1. **Embedded Systems** - Compile HQL for microcontrollers (no_std)
2. **Game Dev** - HQL as scripting language in Rust games
3. **Serverless** - WASM modules for Cloudflare Workers, Fastly
4. **Mobile** - Native libraries for iOS/Android
5. **Performance-Critical** - Hot paths in native code
6. **Self-Hosting** - Eventually rewrite HQL compiler in HQL→Rust

---

## References

### Rust Ecosystem

- [cargo](https://doc.rust-lang.org/cargo/) - Rust package manager
- [wasm-pack](https://rustwasm.github.io/wasm-pack/) - WASM toolchain
- [wasm-bindgen](https://rustwasm.github.io/wasm-bindgen/) - JS/WASM interop

### Similar Projects

- [Chicken Scheme](https://call-cc.org/) - Scheme→C (30+ years, production)
- [Carp](https://github.com/carp-lang/Carp) - Lisp with Rust-like ownership
- [Ketos](https://github.com/murarth/ketos) - Lisp interpreter in Rust

### Research

- [Compiling Lisp to Native Code](https://bernsteinbear.com/blog/compiling-a-lisp-0/)
- [Reference Counting in Rust](https://doc.rust-lang.org/book/ch15-04-rc.html)

---

## Conclusion

The Rust backend is HQL's **optional path to performance optimization**:

- **Direct from IR**: No chaining through TypeScript or other intermediates
- **Leverage Rust Toolchain**: cargo, wasm-pack, cross-compilation for free
- **"Dumb Rust" Strategy**: Rc<RefCell<Value>> everywhere, correctness over cleverness
- **User Experience First**: Harder to write backend, easier for users

**Architecture Summary:**
- **JS Backend (PRIMARY)**: Universal reach — runs everywhere, native binaries via `deno compile`
- **Rust Backend (FUTURE)**: Performance optimization — smaller binaries, no V8 overhead

**Note**: Universal reach is ALREADY achieved with the JS backend. The Rust backend adds performance optimization for niche markets when needed.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2025-12-03 | Initial specification |
| 0.2 | 2025-12-03 | Status changed to "Future Enhancement (Optional)" — JS backend already achieves universal reach |
