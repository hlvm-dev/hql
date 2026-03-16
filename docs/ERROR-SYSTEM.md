# HQL Error Reporting System

This document describes how HQL detects, reports, and maps errors back to your original source code.

## Table of Contents

1. [Overview](#overview)
2. [Error Categories](#error-categories)
3. [The Compilation Pipeline](#the-compilation-pipeline)
4. [Position Tracking](#position-tracking)
5. [Source Map Chain](#source-map-chain)
6. [Type Error Integration](#type-error-integration)
7. [Error Message Format](#error-message-format)
8. [Error Codes Reference](#error-codes-reference)
9. [Troubleshooting](#troubleshooting)

---

## Overview

HQL provides comprehensive error reporting across all compilation phases. When something goes wrong, HQL tells you:

- **What** went wrong (clear error message)
- **Where** it happened (file, line, column)
- **Why** it might have happened (suggestions)
- **How** to fix it (when possible)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Example Error Output                                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  error[HQL2001]: Unexpected token ')'                                        │
│                                                                              │
│   5 │ (fn add [a b] (+ a b))                                                 │
│     │                      ^                                                 │
│                                                                              │
│  Where: src/math.hql:5:22                                                    │
│  Suggestion: Check for mismatched parentheses or missing expression.        │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Error Categories

HQL has four main categories of errors, each occurring at different stages:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ERROR CATEGORIES                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐     │
│  │   PARSE     │   │ TRANSFORM   │   │    TYPE     │   │   RUNTIME   │     │
│  │   ERRORS    │──▶│   ERRORS    │──▶│   ERRORS    │──▶│   ERRORS    │     │
│  │             │   │             │   │             │   │             │     │
│  │ HQL1xxx     │   │ HQL4xxx     │   │ TSxxxx      │   │ HQL5xxx     │     │
│  └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘     │
│        │                 │                 │                 │              │
│        ▼                 ▼                 ▼                 ▼              │
│   Syntax issues    IR generation     TypeScript        Execution           │
│   Invalid tokens   Macro expansion   type checker      exceptions          │
│   Mismatched ( )   Unknown forms     Type mismatch     Undefined vars      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. Parse Errors (HQL1xxx)

Occur when HQL cannot understand your code's structure.

```clojure
// Missing closing parenthesis
(fn add [a b] (+ a b)   // ← HQL1001: Unexpected end of input

// Invalid token
(let x @invalid)        // ← HQL1002: Unexpected character '@'

// Mismatched brackets
(let arr [1 2 3)]       // ← HQL1003: Mismatched brackets
```

### 2. Transform Errors (HQL4xxx)

Occur during AST transformation or macro expansion.

```clojure
// Invalid macro syntax
(macro bad)             // ← HQL4001: Macro requires name, params, and body

// Unknown special form
(unknown-form x y)      // ← HQL4002: Unknown special form
```

### 3. Type Errors (TSxxxx)

Occur when TypeScript's type checker finds type mismatches. These are **warnings** by default (code still runs).

```clojure
// Type mismatch
(fn add [a:number b:number] :number (+ a b))
(add "hello" "world")   // ← TS2345: Argument of type 'string' is not
                        //           assignable to parameter of type 'number'
```

### 4. Runtime Errors (HQL5xxx)

Occur when code executes but encounters a problem.

```clojure
// Undefined variable
(print unknown-var)     // ← HQL5001: unknown-var is not defined

// Not a function
(let x 5)
(x 10)                  // ← HQL5005: x is not a function
```

---

## The Compilation Pipeline

Understanding the pipeline helps you understand where errors come from:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        HQL COMPILATION PIPELINE                              │
└──────────────────────────────────────────────────────────────────────────────┘

     YOUR CODE                                                    OUTPUT
         │                                                           ▲
         ▼                                                           │
┌─────────────────┐                                                  │
│                 │                                                  │
│   math.hql      │  Your HQL source file                           │
│                 │                                                  │
└────────┬────────┘                                                  │
         │                                                           │
         │  PHASE 1: PARSING                                         │
         │  ─────────────────                                        │
         │  • Tokenize source code                                   │
         │  • Build Abstract Syntax Tree (AST)                       │
         │  • Track line:column for each token                       │
         │  • ERRORS: HQL1xxx (syntax errors)                        │
         ▼                                                           │
┌─────────────────┐                                                  │
│                 │                                                  │
│   AST           │  Tree structure of your code                     │
│   (with pos)    │  Each node has position info                     │
│                 │                                                  │
└────────┬────────┘                                                  │
         │                                                           │
         │  PHASE 2: TRANSFORMATION                                  │
         │  ───────────────────────                                  │
         │  • Expand macros                                          │
         │  • Convert to IR (Intermediate Representation)            │
         │  • Preserve positions through transforms                  │
         │  • ERRORS: HQL4xxx (transform errors)                     │
         ▼                                                           │
┌─────────────────┐                                                  │
│                 │                                                  │
│   IR            │  Intermediate Representation                     │
│   (with pos)    │  Normalized code structure                       │
│                 │                                                  │
└────────┬────────┘                                                  │
         │                                                           │
         │  PHASE 3: TYPESCRIPT GENERATION                           │
         │  ──────────────────────────────                           │
         │  • Generate TypeScript code                               │
         │  • Include type annotations                               │
         │  • Create SOURCE MAP 1 (HQL → TS)                         │
         ▼                                                           │
┌─────────────────┐                                                  │
│                 │                                                  │
│  generated.ts   │  TypeScript code                                 │
│  + source map   │  Maps back to HQL positions                      │
│                 │                                                  │
└────────┬────────┘                                                  │
         │                                                           │
         │  PHASE 4: TYPE CHECKING                                   │
         │  ──────────────────────                                   │
         │  • TypeScript compiler analyzes types                     │
         │  • Reports type mismatches                                │
         │  • We map positions back to HQL                           │
         │  • ERRORS: TSxxxx (type errors)                           │
         ▼                                                           │
┌─────────────────┐                                                  │
│                 │                                                  │
│  Type Errors    │  Mapped to HQL positions                         │
│  (warnings)     │  Displayed to user                               │
│                 │                                                  │
└────────┬────────┘                                                  │
         │                                                           │
         │  PHASE 5: JAVASCRIPT COMPILATION                          │
         │  ───────────────────────────────                          │
         │  • TypeScript compiles to JavaScript                      │
         │  • Creates SOURCE MAP 2 (TS → JS)                         │
         │  • We chain: HQL → TS → JS = HQL → JS                     │
         ▼                                                           │
┌─────────────────┐                                                  │
│                 │                                                  │
│   output.js     │  Final JavaScript                                │
│   + source map  │  Chained map points to HQL                       │
│                 │                                                  │
└────────┬────────┘                                                  │
         │                                                           │
         │  PHASE 6: EXECUTION                                       │
         │  ──────────────────                                       │
         │  • JavaScript runs                                        │
         │  • Runtime errors occur here                              │
         │  • Stack traces mapped to HQL                             │
         │  • ERRORS: HQL5xxx (runtime errors)                       │
         ▼                                                           │
┌─────────────────┐                                                  │
│                 │                                                  │
│   Result or     │◀─────────────────────────────────────────────────┘
│   Runtime Error │
│                 │
└─────────────────┘
```

---

## Position Tracking

HQL tracks the original position (line and column) of every piece of code through all transformations.

### How Positions Flow Through the Pipeline

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        POSITION TRACKING FLOW                                │
└──────────────────────────────────────────────────────────────────────────────┘

  Original HQL:
  ─────────────
  Line 3: (print (add "wrong" 5))
                      ▲
                      └── Position: line=3, column=18

  After Parsing (AST):
  ────────────────────
  CallExpression {
    callee: "add",
    arguments: [
      StringLiteral {
        value: "wrong",
        position: { line: 3, column: 18 }   ← Position preserved!
      },
      NumberLiteral { value: 5, position: { line: 3, column: 26 } }
    ],
    position: { line: 3, column: 9 }
  }

  After Transform (IR):
  ─────────────────────
  IRCallExpression {
    callee: IRIdentifier { name: "add" },
    arguments: [
      IRStringLiteral {
        value: "wrong",
        position: { line: 3, column: 18 }   ← Still preserved!
      },
      ...
    ]
  }

  Generated TypeScript:
  ─────────────────────
  console.log(add("wrong", 5))//
                  ▲
                  └── Generated at: line=7, column=17
                      Maps to HQL: line=3, column=18

  Source Map Entry:
  ─────────────────
  {
    generated: { line: 7, column: 17 },
    original: { line: 3, column: 18 },
    source: "math.hql"
  }
```

### The emit() Function

Position tracking happens in the TypeScript generator:

```typescript
// In ir-to-typescript.ts
private emit(text: string, irPosition?: IR.SourcePosition): void {
  // Record mapping if we have original position
  if (irPosition && irPosition.line !== undefined) {
    this.mappings.push({
      generated: {
        line: this.currentLine,
        column: this.currentColumn
      },
      original: {
        line: irPosition.line,
        column: irPosition.column
      },
      source: irPosition.filePath
    })//
  }

  // Update current position in generated code
  this.code += text//
  // ... update currentLine/currentColumn
}
```

---

## Source Map Chain

HQL creates a **chain** of source maps to trace from final JavaScript back to original HQL:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          SOURCE MAP CHAIN                                    │
└──────────────────────────────────────────────────────────────────────────────┘

    math.hql                  generated.ts                output.js
    ────────                  ────────────                ─────────

    Line 3                    Line 7                      Line 5
    Column 18                 Column 17                   Column 12
         │                         │                           │
         │                         │                           │
         │     SOURCE MAP 1        │      SOURCE MAP 2         │
         │     (HQL → TS)          │      (TS → JS)            │
         │                         │                           │
         ▼                         ▼                           ▼
    ┌─────────┐              ┌─────────┐               ┌─────────┐
    │  HQL    │─────────────▶│   TS    │──────────────▶│   JS    │
    │ Source  │              │ Source  │               │ Output  │
    └─────────┘              └─────────┘               └─────────┘
         ▲                                                  │
         │                                                  │
         │              CHAINED SOURCE MAP                  │
         │              (HQL → JS)                          │
         └──────────────────────────────────────────────────┘
                               │
                               ▼
                    When error at JS 5:12
                    We look up: JS → TS → HQL
                    Result: HQL 3:18
```

### Chaining Process

```typescript
// In source-map-chain.ts
export async function chainSourceMaps(
  hqlToTsMappings: SourceMapping[],  // Map 1: HQL → TS
  tsToJsMapJson: string,              // Map 2: TS → JS (from tsc)
  hqlSourcePath: string
): Promise<ChainedSourceMap> {

  // Build lookup: TS position → HQL position
  const tsToHqlMap = new Map<string, Position>()//
  for (const mapping of hqlToTsMappings) {
    const key = `${mapping.generated.line}:${mapping.generated.column}`//
    tsToHqlMap.set(key, mapping.original)//
  }

  // For each JS → TS mapping, look up TS → HQL
  // Result: JS → HQL (chained)
}
```

---

## Type Error Integration

HQL leverages TypeScript's type checker as a "free" type system:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     TYPE ERROR FLOW                                          │
└──────────────────────────────────────────────────────────────────────────────┘

  1. YOUR HQL CODE
  ─────────────────
  (fn add [a:number b:number] :number (+ a b))
  (print (add "wrong" 5))
              ▲
              └── You made a type error here!


  2. GENERATED TYPESCRIPT
  ───────────────────────
  function add(a: number, b: number): number {
    return a + b//
  }
  console.log(add("wrong", 5))//
                  ▲
                  └── TypeScript sees this


  3. TYPESCRIPT TYPE CHECKER
  ──────────────────────────
  ┌────────────────────────────────────────────────────────────────────────┐
  │  TypeScript Compiler (tsc)                                             │
  │                                                                        │
  │  "I found an error!"                                                   │
  │                                                                        │
  │  {                                                                     │
  │    message: "Argument of type 'string' is not assignable               │
  │              to parameter of type 'number'",                           │
  │    code: 2345,                                                         │
  │    file: "generated.ts",                                               │
  │    line: 4,                                                            │
  │    column: 17                                                          │
  │  }                                                                     │
  │                                                                        │
  └────────────────────────────────────────────────────────────────────────┘


  4. MAP BACK TO HQL
  ──────────────────
  Source map lookup: TS 4:17 → HQL 2:13


  5. DISPLAY TO USER
  ──────────────────
  ┌────────────────────────────────────────────────────────────────────────┐
  │                                                                        │
  │  ⚠️ Type error at math.hql:2:13: Argument of type 'string' is not     │
  │     assignable to parameter of type 'number'.                          │
  │                                                                        │
  │     2 │ (print (add "wrong" 5))                                        │
  │       │              ▲▲▲▲▲▲▲                                           │
  │                                                                        │
  └────────────────────────────────────────────────────────────────────────┘
```

### Type Errors Are Warnings

By default, type errors are **warnings** - your code still runs:

```bash
$ hlvm run math.hql

⚠️ Type checking found 1 error(s), 0 warning(s)
⚠️ Type error at math.hql:2:13: Argument of type 'string' is not
   assignable to parameter of type 'number'.

wrong5     # ← Code still executes (JavaScript is dynamic)
```

To make type errors fatal, use strict mode:

```bash
$ hlvm run --strict math.hql

error: Type checking failed
```

---

## Error Message Format

All HQL errors follow a consistent format:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        ERROR MESSAGE ANATOMY                                 │
└──────────────────────────────────────────────────────────────────────────────┘

  error[HQL5001]: variable-name is not defined      ← Error code + message

   5 │ (print variable-name)                        ← Source context
     │        ▲▲▲▲▲▲▲▲▲▲▲▲▲▲                        ← Pointer to error

  Where: src/app.hql:5:9                            ← File:line:column
  Suggestion: The variable 'variable-name' is      ← Helpful suggestion
              not defined. Did you mean 'var-name'?

  For more information, see:                        ← Documentation link
  https://hlvm.dev/errors/HQL5001

```

### Components

| Component | Description |
|-----------|-------------|
| Error Code | Unique identifier (e.g., `HQL5001`) |
| Message | Brief description of the problem |
| Source Context | The line of code with the error |
| Pointer | Visual indicator of exact location |
| Where | Full path with line:column |
| Suggestion | How to fix the problem |
| Documentation | Link to detailed explanation |

### Error Domains

The code prefix indicates the owning runtime boundary:

- `HQL` errors come from language parsing, compilation, and runtime semantics.
- `HLVM` errors come from the local HLVM runtime host (HTTP protocol, sessions, tool events, lifecycle).
- `PRV` errors come from external provider calls (OpenAI, Anthropic, Gemini, Ollama, etc.).

---

## Error Codes Reference

### Parse Errors (HQL1xxx)

| Code | Description |
|------|-------------|
| HQL1001 | Unexpected end of input |
| HQL1002 | Unexpected character |
| HQL1003 | Mismatched brackets |
| HQL1004 | Invalid number format |
| HQL1005 | Unterminated string |

### Syntax Errors (HQL2xxx)

| Code | Description |
|------|-------------|
| HQL2001 | Invalid function definition |
| HQL2002 | Invalid let binding |
| HQL2003 | Invalid macro definition |
| HQL2004 | Missing required argument |

### Semantic Errors (HQL3xxx)

| Code | Description |
|------|-------------|
| HQL3001 | Duplicate definition |
| HQL3002 | Invalid export |
| HQL3003 | Circular dependency |

### Transform Errors (HQL4xxx)

| Code | Description |
|------|-------------|
| HQL4001 | Transformation failed |
| HQL4002 | Macro expansion failed |
| HQL4003 | Invalid IR node |

### Runtime Errors (HQL5xxx)

| Code | Description |
|------|-------------|
| HQL5001 | Variable not defined |
| HQL5002 | Type mismatch at runtime |
| HQL5003 | Division by zero |
| HQL5004 | Null or undefined dereference |
| HQL5005 | Function not found |

### HLVM Host Errors (HLVM5xxx)

| Code | Description |
|------|-------------|
| HLVM5006 | Runtime host request or lifecycle failure |
| HLVM5007 | Runtime host request rejected |
| HLVM5008 | Runtime host request payload too large |
| HLVM5009 | Runtime host transport failure |
| HLVM5010 | Runtime host stream parsing failure |

### Provider Errors (PRV9xxx)

| Code | Description |
|------|-------------|
| PRV9001 | Provider request failed |
| PRV9002 | Provider request rejected |
| PRV9003 | Provider request payload too large |
| PRV9004 | Provider authentication/authorization failed |
| PRV9005 | Provider rate limit hit |
| PRV9006 | Provider unavailable |
| PRV9007 | Provider network failure |
| PRV9008 | Provider request timeout |
| PRV9009 | Provider stream protocol parse error |

### Type Errors (TSxxxx)

Type errors use TypeScript's error codes directly:

| Code | Description |
|------|-------------|
| TS2345 | Argument type mismatch |
| TS2322 | Type not assignable |
| TS2339 | Property does not exist |
| TS2349 | Cannot invoke non-function |

---

## Troubleshooting

### Error Position Seems Wrong

If an error points to the wrong location:

1. **Check for macros** - Macro-generated code might have positions from macro definition
2. **Check for multi-byte characters** - Unicode might affect column counting
3. **Check imports** - Error might be in an imported file

### Type Error Not Detected

If a type error isn't being caught:

1. **Add type annotations** - HQL uses gradual typing; untyped code isn't checked
2. **Check parameter types** - Use `Array<T>` instead of `T[]` for parameters
3. **Verify syntax** - Type annotation must be `:type` with no space

```clojure
// Wrong - space before colon
(fn add [a : number] ...)

// Correct - no space
(fn add [a:number] ...)
```

### Stack Trace Points to Generated Code

If runtime errors show JavaScript line numbers:

1. **Source maps should handle this** - Check that .js.map file exists
2. **Use `hlvm run`** - Direct `deno run` might not load source maps
3. **Report a bug** - If positions are wrong, please report it

---

## See Also

- [Type System Documentation](./TYPE-SYSTEM.md) - Full type annotation guide
- [HQL Manual](./MANUAL.md) - Complete language reference
- [Testing Guide](./TESTING.md) - How to test HQL code

---

## Production Readiness

This section documents the verified accuracy and known limitations of HQL's error reporting system.

### Test Coverage Summary

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    ERROR SYSTEM TEST RESULTS                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  POSITION ACCURACY TESTS                              RESULT             │
│  ──────────────────────────────────────────────────────────────          │
│  • Deeply nested expressions (10+ levels)             ✅ PASS            │
│  • Very long lines (400+ characters)                  ✅ PASS            │
│  • CRLF line endings (Windows)                        ✅ PASS            │
│  • Mixed tabs and spaces                              ✅ PASS            │
│  • Runtime stack traces                               ✅ PASS            │
│  • Multiple errors in one file                        ✅ PASS            │
│  • Generic types (Array<T>)                           ✅ PASS            │
│  • Higher-order functions                             ✅ PASS            │
│  • Method calls (.toUpperCase)                        ✅ PASS            │
│  • Unicode (emoji, CJK characters)                    ✅ PASS            │
│  • Large files (1000+ lines)                          ✅ PASS            │
│  • Threading macros (->, ->>)                         ✅ PASS            │
│  • Multi-line expressions                             ✅ PASS            │
│  • Parse errors with caret display                    ✅ PASS            │
│  • Unit test suite (27 tests)                         ✅ ALL PASS        │
│                                                                          │
│  OVERALL ACCURACY:  100% (24/24 test categories)                         │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Verified Working Scenarios

| Scenario | Example | Position Accuracy |
|----------|---------|-------------------|
| Basic type errors | `(fn f [x:number] x) (f "str")` | ✅ 100% |
| Nested expressions | 10+ levels of nesting | ✅ 100% |
| Unicode strings | `"👍"`, `"你好世界"` | ✅ 100% |
| CJK identifiers | `(let 变量 "value")` | ✅ 100% |
| Long lines | 400+ character lines | ✅ 100% |
| CRLF endings | Windows-style line endings | ✅ 100% |
| Tab characters | Mixed tabs and spaces | ✅ 100% |
| Multi-error | 3+ errors in one file | ✅ 100% |
| Generic types | `Array<number>`, `Promise<T>` | ✅ 100% |
| Threading macros | `(-> x (f) (g))` | ✅ 100% |
| Same-file macros | User macros in same file | ✅ 100% |
| Parse errors | Missing parens, bad tokens | ✅ 100% |
| Runtime errors | Undefined variables | ✅ 100% |

### Known Limitations

#### 1. User-Defined Macro Positions (Same File)

**Status:** ✅ Fixed (December 2024)

~~When a user-defined macro and its call site are in the **same file**, type errors in macro-expanded code may point to the macro definition instead of the call site.~~

This bug has been fixed. The `updateMetaRecursively` function in `src/hql/s-exp/macro.ts` now correctly updates positions when:
1. No existing metadata
2. Different source file (macro definition in another file)
3. Same file but expression comes from earlier in file (macro definition)

```clojure
// Example - now correctly reports line 5
(macro my-add [a b]
  `(+ ~a ~b))           // Line 2 - macro definition

(fn check [x:number] :number x)
(check (my-add "x" 5))  // Line 5 - call site

// Error correctly reports: "Type error at test.hql:5:8"
```

#### 2. Property Access Syntax Limitation

**Status:** By design (gradual typing)

Property access without method call syntax (`x.length`) on untyped variables does not trigger type errors - it returns `undefined` at runtime.

```clojure
// No type error (returns undefined)
(let x 42)
(print x.length)        // → undefined (no error)

// Type error IS caught with typed parameter
(fn f [x:number] :number
  (.length x))          // → Type error: 'length' doesn't exist on number
```

**Workaround:** Use typed parameters in functions to get full type checking.

---

## Technical Implementation

For developers working on HQL itself:

| Component | File |
|-----------|------|
| Parser | `src/hql/transpiler/pipeline/parser.ts` |
| IR Generator | `src/hql/transpiler/pipeline/syntax-transformer.ts` |
| TS Generator | `src/hql/transpiler/pipeline/ir-to-typescript.ts` |
| Type Checker | `src/hql/transpiler/pipeline/ts-compiler.ts` |
| Source Maps | `src/hql/transpiler/pipeline/source-map-chain.ts` |
| Error Formatter | `src/common/error.ts` |
| Error Codes | `src/common/error-codes.ts` |
