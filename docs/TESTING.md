# Testing HQL

Complete guide to testing HQL code.

## Quick Test

Test the binary works:

```bash
make test
```

This runs basic smoke tests.

## Running HQL's Test Suite

### Run All Tests

```bash
deno task test:unit
```

### Run Specific Test Files

```bash
deno test --allow-all tests/unit/syntax-ternary.test.ts
```

### Watch Mode

Rerun tests on file changes:

```bash
deno task test:watch
```

## Test Structure

### Test Organization

```
tests/
├── unit/                  # Unit tests
│   ├── syntax-*.test.ts   # Syntax tests
│   ├── stdlib-*.test.ts   # Standard library tests
│   ├── macro-*.test.ts    # Macro tests
│   └── organized/         # Feature-organized tests
├── binary/                # Binary/CLI tests
└── e2e/                   # End-to-end tests
```

### Example Test

```typescript
import { assertEquals } from "jsr:@std/assert@1";
import hql from "../mod.ts";

async function run(code: string) {
  return await hql.run(code);
}

Deno.test("addition works", async () => {
  const result = await run("(+ 1 2 3)");
  assertEquals(result, 6);
});

Deno.test("functions work", async () => {
  const result = await run(`
    (fn double [x] (* x 2))
    (double 5)
  `);
  assertEquals(result, 10);
});
```

## Writing Your Own Tests

### Setup

Create `my-test.test.ts`:

```typescript
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import hql from "./mod.ts";

async function run(code: string) {
  return await hql.run(code);
}
```

### Test Functions

```typescript
Deno.test("my function works", async () => {
  const result = await run(`
    (fn greet [name]
      (+ "Hello, " name))
    (greet "World")
  `);
  assertEquals(result, "Hello, World");
});
```

### Test Errors

```typescript
Deno.test("division by zero throws", async () => {
  await assertThrows(
    async () => await run("(/ 1 0)"),
    Error,
    "Division by zero"
  );
});
```

### Test Async Code

```typescript
Deno.test("async operations work", async () => {
  const result = await run(`
    (fn async-double [x]
      (await (Promise.resolve (* x 2))))
    (await (async-double 5))
  `);
  assertEquals(result, 10);
});
```

## Test Utilities

### Run Expression

```typescript
const result = await hql.run("(+ 1 2)");
```

### Transpile Only

```typescript
const js = await hql.transpile("(+ 1 2)");
// js contains JavaScript code
```

### Parse Only

```typescript
const ast = await hql.parse("(+ 1 2)");
// ast contains syntax tree
```

## Test Categories

### Unit Tests

Test individual functions:

```lisp
; tests/unit/math.test.hql
(fn test-addition []
  (assert (= (+ 1 2) 3))
  (assert (= (+ 10 20 30) 60)))

(test-addition)
```

### Integration Tests

Test feature combinations:

```lisp
; tests/integration/pipeline.test.hql
(fn test-pipeline []
  (let numbers [1 2 3 4 5])
  (let result
    (reduce +
      0
      (map (fn [x] (* x 2))
           (filter (fn [x] (> x 2)) numbers))))
  (assert (=== result 24)))

(test-pipeline)
```

### Regression Tests

Test bug fixes:

```lisp
; tests/regression/issue-123.test.hql
(fn test-macro-expansion []
  ; Ensure macro expands correctly
  (macro when [test & body]
    `(if ~test (do ~@body)))
  (let result (when true 42))
  (assert (=== result 42)))

(test-macro-expansion)
```

## Test Performance

### Benchmark

Time execution:

```bash
hql run --time script.hql
```

### Profile

Profile compilation:

```bash
hql compile --time --verbose script.hql
```

## Continuous Integration

### GitHub Actions

Tests run automatically on:

- Push to main
- Pull requests
- Releases

See `.github/workflows/release.yml`.

### Local CI Simulation

Run same tests as CI:

```bash
make test
```

## Test Best Practices

### 1. Test Naming

Use descriptive names:

```typescript
// Good
Deno.test("map transforms all elements", async () => {
  // ...
});

// Bad
Deno.test("test1", async () => {
  // ...
});
```

### 2. One Assertion Per Test

```typescript
// Good
Deno.test("addition works", async () => {
  assertEquals(await run("(+ 1 2)"), 3);
});

Deno.test("subtraction works", async () => {
  assertEquals(await run("(- 5 3)"), 2);
});

// Bad
Deno.test("math works", async () => {
  assertEquals(await run("(+ 1 2)"), 3);
  assertEquals(await run("(- 5 3)"), 2);
});
```

### 3. Test Edge Cases

```typescript
Deno.test("empty array", async () => {
  assertEquals(await run("(first [])"), null);
});

Deno.test("single element", async () => {
  assertEquals(await run("(first [1])"), 1);
});

Deno.test("multiple elements", async () => {
  assertEquals(await run("(first [1 2 3])"), 1);
});
```

### 4. Clean Up

```typescript
Deno.test("file operations", async () => {
  // Create test file
  await Deno.writeTextFile("/tmp/test.txt", "hello");

  try {
    const result = await run(`
      (import fs from "npm:fs/promises")
      (await (fs.readFile "/tmp/test.txt" "utf-8"))
    `);
    assertEquals(result, "hello");
  } finally {
    // Clean up
    await Deno.remove("/tmp/test.txt");
  }
});
```

## Debugging Tests

### Verbose Output

```bash
deno test --allow-all tests/unit/
```

### Single Test

```bash
deno test --allow-all tests/unit/specific.test.ts
```

### Debug Mode

```bash
HQL_DEBUG=1 deno test --allow-all tests/unit/
```

## Test Coverage Goals

All features must have tests.

## Next Steps

- [Build Guide](./BUILD.md) - Build from source
- [Contributing](../CONTRIBUTING.md) - Contribute tests
