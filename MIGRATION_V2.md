# HQL v2.0 Migration Guide

## Overview

HQL v2.0 introduces **full JavaScript operator alignment** for a more intuitive development experience. This guide helps you migrate from v1.x to v2.0.

## Quick Summary

| Feature | v1.x Syntax | v2.0 Syntax |
|---------|-------------|-------------|
| **Assignment** | `(set! x 10)` | `(= x 10)` |
| **Strict Equality** | `(= a b)` | `(=== a b)` |
| **Loose Equality** | N/A | `(== a b)` |
| **Strict Inequality** | `(!= a b)` | `(!== a b)` |
| **Loose Inequality** | N/A | `(!= a b)` |

## Breaking Changes

### 1. Assignment Operator

**v1.x:**
```lisp
(set! x 10)
(set! obj.property "value")
```

**v2.0:**
```lisp
(= x 10)
(= obj.property "value")
```

**Migration:** Replace all `(set! ...)` with `(= ...)`

### 2. Equality Operators

**v1.x:**
```lisp
(= a b)           ;; Strict equality
(!= a b)          ;; Strict inequality
```

**v2.0:**
```lisp
(=== a b)         ;; Strict equality (JavaScript ===)
(!== a b)         ;; Strict inequality (JavaScript !==)
(== a b)          ;; Loose equality (JavaScript ==)
(!= a b)          ;; Loose inequality (JavaScript !=)
```

**Migration:** Replace all `(= ...)` comparison expressions with `(=== ...)`

### 3. Destructuring Default Values

**IMPORTANT:** In destructuring patterns, `(= value)` means "default value", NOT equality!

**Correct (both versions):**
```lisp
;; Array destructuring with defaults
(const [x (= 1) y (= 2)] [10])  ;; x = 10, y = 2

;; Object destructuring with defaults
(const {a (= 5) b (= 10)} {a: 3})  ;; a = 3, b = 10
```

**Note:** This syntax remains unchanged in v2.0 because it's NOT an equality check!

## New Features in v2.0

### 1. Complete Comparison Operators

```lisp
;; Equality
(=== 1 1)        ;; true (strict)
(== "1" 1)       ;; true (loose)
(!== 1 2)        ;; true (strict inequality)
(!= "1" 2)       ;; true (loose inequality)

;; Relational
(> 5 3)          ;; Greater than
(>= 5 5)         ;; Greater than or equal
(< 3 5)          ;; Less than
(<= 5 5)         ;; Less than or equal
```

### 2. Logical Operators

```lisp
;; Boolean logic
(&& true false)   ;; Logical AND
(|| false true)   ;; Logical OR
(! true)          ;; Logical NOT
(?? null 10)      ;; Nullish coalescing
```

### 3. Bitwise Operators

```lisp
(& 5 3)          ;; Bitwise AND
(| 5 3)          ;; Bitwise OR
(^ 5 3)          ;; Bitwise XOR
(~ 5)            ;; Bitwise NOT
(<< 5 2)         ;; Left shift
(>> 5 2)         ;; Right shift (sign-propagating)
(>>> 5 2)        ;; Right shift (zero-fill)
```

### 4. Type Operators

```lisp
(typeof x)           ;; Get type as string
(instanceof obj cls) ;; Check instance
(in "prop" obj)      ;; Check property existence
(delete obj.prop)    ;; Delete property
(void expr)          ;; Evaluate and return undefined
```

## Automated Migration

Use the provided migration script:

```bash
# Dry run (preview changes)
deno run -A tools/migrate-v2.ts

# Apply changes
deno run -A tools/migrate-v2.ts --apply
```

### What the Script Does

1. **Phase 1:** `(const ...)` → markers (protect from double-conversion)
2. **Phase 2:** `(let ...)` → `(const ...)`
3. **Phase 3:** `(var ...)` → markers (protect mutable variables)
4. **Phase 4:** `(set! ...)` → temporary markers
5. **Phase 5:** `(= ...)` → `(=== ...)` (equality comparisons only)
6. **Phase 6:** Temporary markers → `(= ...)` (final assignments)

### Script Limitations

The script **cannot** automatically fix:

1. **Destructuring patterns** - Must manually verify `(= value)` remains unchanged
2. **Complex nested expressions** - May need manual review
3. **Comments and strings** - Patterns inside strings won't be converted

## Common Migration Patterns

### Pattern 1: Variable Assignment in Conditionals

**v1.x:**
```lisp
(if condition
  (set! x 10)
  (set! x 20))
```

**v2.0:**
```lisp
(if condition
  (= x 10)
  (= x 20))
```

### Pattern 2: Property Assignment

**v1.x:**
```lisp
(set! this.value initial)
(set! obj.count (+ obj.count 1))
```

**v2.0:**
```lisp
(= this.value initial)
(= obj.count (+ obj.count 1))
```

### Pattern 3: Equality Checks in Conditions

**v1.x:**
```lisp
(if (= x 10) "yes" "no")
(when (= status "active") (do-something))
```

**v2.0:**
```lisp
(if (=== x 10) "yes" "no")
(when (=== status "active") (do-something))
```

### Pattern 4: Inequality Checks

**v1.x:**
```lisp
(if (!= x null) x "default")
```

**v2.0:**
```lisp
;; Strict inequality (recommended)
(if (!== x null) x "default")

;; Or use nullish coalescing
(?? x "default")
```

## Package Migration

### @hql/test Library

**v1.x:**
```lisp
(assert (= 1 1) "should equal")
(var isEqual (= actualStr expectedStr))
(catch err (set! didThrow true))
```

**v2.0:**
```lisp
(assert (=== 1 1) "should equal")
(var isEqual (=== actualStr expectedStr))
(catch err (= didThrow true))
```

### Embedded Packages

After migrating package source files, regenerate embedded packages:

```bash
deno run -A scripts/embed-packages.ts
```

## Verification Checklist

After migration:

- [ ] Run full test suite: `deno test --allow-all`
- [ ] Check for assignment in comparisons: `grep -r "(= .* .*)" --include="*.hql"`
- [ ] Verify `set!` is removed: `grep -r "set!" --include="*.hql"`
- [ ] Test destructuring: Check all `(const [...]` and `(const {...}` patterns
- [ ] Regenerate embedded packages if changed: `deno run -A scripts/embed-packages.ts`
- [ ] Clear cache: `rm -rf .hql-cache`

## Troubleshooting

### Error: "Assignment to constant variable"

**Cause:** Trying to reassign a `const` variable

**Fix:** Change equality check from `(= ...)` to `(=== ...)`

**Example:**
```lisp
;; WRONG (v2.0)
(const x 10)
(if (= x undefined) "missing" "ok")  ;; Tries to ASSIGN undefined to x!

;; CORRECT (v2.0)
(const x 10)
(if (=== x undefined) "missing" "ok")  ;; CHECKS equality
```

### Error: "Identifier already declared"

**Cause:** Using `const` where mutation is needed

**Fix:** Use `let` or `var` for mutable variables

**Example:**
```lisp
;; WRONG
(const sum 0)
(for (i 10) (= sum (+ sum i)))  ;; Can't reassign const!

;; CORRECT
(let sum 0)
(for (i 10) (= sum (+ sum i)))  ;; let allows reassignment
```

### Error: "=== requires exactly 2 arguments"

**Cause:** Destructuring pattern using `(=== value)` instead of `(= value)`

**Fix:** In destructuring, use `(= value)` for defaults

**Example:**
```lisp
;; WRONG
(const [x (=== 10)] [])  ;; === needs 2 arguments!

;; CORRECT
(const [x (= 10)] [])    ;; (= value) means "default value"
```

## Benefits of v2.0

1. **JavaScript Alignment:** Operators match JavaScript exactly
2. **More Operators:** 40+ operators vs. 13 in v1.x
3. **Type Safety:** Distinguish strict (`===`) vs. loose (`==`) equality
4. **Bitwise Operations:** Full bitwise operator support
5. **Nullish Coalescing:** Modern `??` operator for null/undefined handling
6. **Clearer Semantics:** `=` for assignment matches JavaScript

## Migration Statistics

- **Total Changes:** ~1000+ operator replacements across codebase
- **Files Modified:** 79 core files + user code
- **Test Coverage:** 1288/1288 tests passing (100%)
- **Breaking Changes:** 2 major (assignment, equality)
- **New Features:** 27 new operators

## Support

If you encounter issues during migration:

1. Check this guide's troubleshooting section
2. Review the automated migration script output
3. Examine test files for examples: `test/*.test.ts`
4. Check `PROJECT_STATUS.md` for implementation details

---

**Migration Script:** `tools/migrate-v2.ts`
**Test Suite:** `deno test --allow-all`
**Verification:** `VERIFICATION_CHECKLIST.md`

**Last Updated:** 2025-11-17
**HQL Version:** 2.0.0
