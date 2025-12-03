# HQL TypeScript Backend Specification

## Status: SUPERSEDED
## Date: 2024-12-03 (Original) → 2025-12-03 (Superseded)

---

## ⚠️ This Document is Historical

**This specification has been superseded by the Two-Backend Architecture.**

See instead:
- [hql_roadmap.md](./hql_roadmap.md) - Current architecture overview
- [hql_rust_backend.md](./hql_rust_backend.md) - Rust backend specification

---

## Why This Approach Was Superseded

The TypeScript intermediate strategy was based on the assumption that ecosystem tools would provide TS→WASM compilation. After thorough analysis, we found:

| Tool | Status | Problem |
|------|--------|---------|
| porffor | Experimental | Uncertain future, limited feature support |
| AssemblyScript | Stable | NOT TypeScript - different language with TS syntax |
| ts2wasm (general) | Doesn't exist | Fundamental semantic gap between TS and WASM |

### The Core Issue

```
TypeScript semantics ≠ WASM semantics

TypeScript:                    WASM:
• Dynamic typing               • Static typing
• Prototype chains             • No inheritance model
• Closures with captures       • No closures
• Garbage collected            • Manual memory (or WasmGC)
• eval(), Function()           • No dynamic code

No tool bridges this gap reliably for real TypeScript.
```

### The New Architecture

Instead of hoping for TS→WASM tools, we adopted a **hub-and-spoke** model:

```
                        HQL IR (hub)
                            │
             ┌──────────────┴──────────────┐
             ▼                             ▼
      ┌────────────┐               ┌────────────┐
      │ JS Backend │               │Rust Backend│
      │ (existing) │               │   (new)    │
      └────────────┘               └────────────┘
             │                         │     │
             ▼                         ▼     ▼
        JavaScript                  WASM   Native
```

Each backend generates directly from HQL IR. No chaining through intermediate languages.

---

## Historical Content (Archived Below)

The original specification is preserved below for historical reference.

---

<details>
<summary>Click to expand original specification (archived)</summary>

## Original Executive Summary

This specification outlines HQL's compilation strategy: **TypeScript as the universal intermediate target**, enabling multiple output formats (JS, WASM, and potentially more) by leveraging existing ecosystem tools rather than building custom backends.

## Original Architecture

```
HQL → TypeScript → esbuild → JavaScript
                → porffor → WASM (hoped)
                → wasm2c → C → LLVM → Native (hoped)
```

## Why This Was Proposed

1. **Leverage ecosystem tools** rather than build custom backends
2. **TypeScript as universal intermediate** - typed, readable
3. **Single codegen** for multiple targets

## Why This Was Rejected

1. **porffor is experimental** - uncertain if it will mature
2. **No TS→WASM tool exists** for real TypeScript
3. **AssemblyScript is not TypeScript** - different semantics
4. **Chaining adds complexity** without benefit if tools don't exist

## The Better Approach

Direct backends from HQL IR:
- JS Backend: Already exists, works perfectly
- Rust Backend: Generates Rust, uses cargo/wasm-pack for WASM and native

See [hql_rust_backend.md](./hql_rust_backend.md) for the current approach.

</details>

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2024-12-02 | Initial proposal |
| 0.2 | 2024-12-03 | Complete specification |
| 0.3 | 2025-12-03 | **SUPERSEDED** by two-backend architecture |
