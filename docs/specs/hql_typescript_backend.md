# HQL TypeScript Backend Proposal

## Status: Proposal
## Date: 2024-12-02
## Author: Architecture Discussion

---

## Executive Summary

This proposal outlines adding a TypeScript intermediate layer to HQL's compilation pipeline, enabling:
1. Better tooling support (IDE, type checking) today
2. A path to WebAssembly compilation in the future (via emerging TS→WASM tools)

---

## Current Architecture

```
HQL Source → Parser → AST → IR → JavaScript
```

## Proposed Architecture

```
HQL Source → Parser → AST → IR → TypeScript → { JavaScript, WASM }
                                      │
                                      ├── tsc/esbuild/swc → JavaScript (today)
                                      │
                                      └── porffor/future  → WASM (future)
```

---

## Rationale

### Why TypeScript as Intermediate?

1. **Types Enable WASM Compilation**
   - JavaScript cannot be compiled to WASM (dynamic types)
   - TypeScript with type annotations CAN be compiled to WASM
   - Emerging tools (porffor, etc.) compile typed TS to WASM

2. **Better Developer Experience Today**
   - Generated TS can be type-checked
   - IDE support for generated code
   - Easier debugging

3. **Future Optionality**
   - If ANY TS→WASM tool matures, HQL benefits
   - We're not betting on one specific tool
   - Types are the universal enabler

### Why Not Direct WASM Backend?

| Approach | Effort | Risk |
|----------|--------|------|
| HQL → WASM directly | 6-12 months | High (need GC, closures, etc.) |
| HQL → TS → WASM | 2-4 weeks (TS backend) | Low (leverage existing tools) |

---

## Technical Design

### 1. IR → TypeScript Codegen

Similar to current IR → JS codegen, but with type annotations:

**HQL Input:**
```clojure
(fn add [a b]
  (+ a b))

(fn greet [name]
  (str "Hello, " name "!"))
```

**TypeScript Output:**
```typescript
function add(a: number, b: number): number {
  return a + b;
}

function greet(name: string): string {
  return "Hello, " + name + "!";
}
```

### 2. Type Inference

For functions without explicit type hints, infer from:
- Literal values
- Operator usage (`+` on numbers, etc.)
- Return statements
- Default to `any` when truly dynamic

### 3. Optional Type Annotations in HQL

Add optional type hints syntax:

```clojure
;; With type hints (compiles to typed TS)
(fn add ^number [^number a ^number b]
  (+ a b))

;; Without type hints (inferred or any)
(fn process [data]
  (transform data))
```

### 4. Build Pipeline

```
hql build src/main.hql
    │
    ├── Phase 1: HQL → TS (new)
    │   Output: dist/main.ts
    │
    ├── Phase 2: TS → JS (via tsc/esbuild)
    │   Output: dist/main.js
    │
    └── (Future) Phase 2b: TS → WASM (via porffor)
        Output: dist/main.wasm
```

---

## Implementation Plan

### Phase 1: TS Backend (2-3 weeks)
- [ ] Create IR → TypeScript codegen
- [ ] Add type inference for common patterns
- [ ] Generate `.ts` files instead of `.js`
- [ ] Update build pipeline to run tsc/esbuild

### Phase 2: Type Annotations (1 week)
- [ ] Add `^type` syntax to parser
- [ ] Pass type hints through AST → IR → TS
- [ ] Document type annotation syntax

### Phase 3: WASM Integration (future, when tools mature)
- [ ] Evaluate TS → WASM tools (porffor, etc.)
- [ ] Add `--target wasm` flag
- [ ] Test with typed HQL subset

---

## What Changes vs What Stays

### Unchanged
- HQL syntax
- Parser
- AST structure
- IR structure
- Macro system
- All existing semantics
- All existing tests

### New
- IR → TypeScript codegen module
- Optional type annotation syntax (`^type`)
- Build flag: `--emit ts` or `--emit js`

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| TS→WASM tools don't mature | Medium | Low | TS output still valuable for DX |
| Type inference is incomplete | Low | Low | Fall back to `any` |
| Performance overhead of TS step | Low | Low | Use esbuild (fast) |

---

## Success Criteria

1. All existing HQL tests pass with TS backend
2. Generated TS compiles without errors
3. Generated TS has meaningful types (not all `any`)
4. Build time increase < 20%

---

## Future Possibilities

With TypeScript as intermediate:

1. **WASM Compilation** - When tools mature
2. **Type Checking** - Catch errors at compile time
3. **Better Source Maps** - TS → JS source maps are excellent
4. **IDE Integration** - TS language server works on output
5. **Gradual Typing** - Users can add types incrementally

---

## Conclusion

Adding a TypeScript backend is:
- **Low risk**: Even without WASM, TS output improves DX
- **High optionality**: Positions HQL for future WASM compilation
- **Minimal change**: Only affects final codegen step
- **Proven path**: Other languages use TS as intermediate successfully

Recommendation: **Proceed with implementation.**

---

## References

- [porffor](https://github.com/AliasQli/porffor) - JS/TS to WASM compiler
- [WasmGC](https://github.com/AliasQli/porffor) - WebAssembly Garbage Collection proposal
- [AssemblyScript](https://www.assemblyscript.org/) - TS-like syntax to WASM (different semantics)
- [Static TypeScript](https://www.microsoft.com/en-us/research/publication/static-typescript/) - Microsoft Research
