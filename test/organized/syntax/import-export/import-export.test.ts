// test/organized/syntax/import-export/import-export.test.ts
// Comprehensive tests for import and export statements
// Combines: syntax-import, syntax-reexport, syntax-ts-import, syntax-remote-imports

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../../../helpers.ts";

// ============================================================================
// SECTION 1: LOCAL IMPORTS - BASIC
// ============================================================================

Deno.test("Import: import single function from module", async () => {
  const code = `
(import [add] from "./test/fixtures/math.hql")
(add 5 10)
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Import: import multiple functions from module", async () => {
  const code = `
(import [add, subtract, multiply] from "./test/fixtures/math.hql")
(+ (add 5 3) (subtract 10 2) (multiply 2 4))
`;
  const result = await run(code);
  // 8 + 8 + 8 = 24
  assertEquals(result, 24);
});

Deno.test("Import: import constants from module", async () => {
  const code = `
(import [PI, E] from "./test/fixtures/constants.hql")
(+ PI E)
`;
  const result = await run(code);
  // 3.14159 + 2.71828 = 5.85987
  assertEquals(Math.round(result * 100000) / 100000, 5.85987);
});

Deno.test("Import: import variable from module", async () => {
  const code = `
(import [counter] from "./test/fixtures/constants.hql")
counter
`;
  const result = await run(code);
  assertEquals(result, 0);
});

// ============================================================================
// SECTION 2: LOCAL IMPORTS - PATTERNS
// ============================================================================

Deno.test("Import: import with alias", async () => {
  const code = `
(import [add as sum, multiply as times] from "./test/fixtures/math.hql")
(+ (sum 5 3) (times 2 4))
`;
  const result = await run(code);
  // 8 + 8 = 16
  assertEquals(result, 16);
});

Deno.test("Import: namespace import", async () => {
  const code = `
(import math from "./test/fixtures/math.hql")
(math.add 10 20)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Import: import from utils module", async () => {
  const code = `
(import [double, triple] from "./test/fixtures/utils.hql")
(+ (double 5) (triple 3))
`;
  const result = await run(code);
  // 10 + 9 = 19
  assertEquals(result, 19);
});

Deno.test("Import: chained function calls", async () => {
  const code = `
(import [square, double] from "./test/fixtures/utils.hql")
(square (double 3))
`;
  const result = await run(code);
  // double(3) = 6, square(6) = 36
  assertEquals(result, 36);
});

// ============================================================================
// SECTION 3: LOCAL IMPORTS - COMPLEX SCENARIOS
// ============================================================================

Deno.test("Import: import class and instantiate", async () => {
  const code = `
(import [Calculator] from "./test/fixtures/calculator.hql")
(var calc (new Calculator 10))
(calc.add 5)
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Import: import class and chain methods", async () => {
  const code = `
(import [Calculator] from "./test/fixtures/calculator.hql")
(var calc (new Calculator 5))
(calc.add 3)
(calc.multiply 2)
`;
  const result = await run(code);
  // (5 + 3) * 2 = 16
  assertEquals(result, 16);
});

Deno.test("Import: import and use in expression", async () => {
  const code = `
(import [add, multiply] from "./test/fixtures/math.hql")
(var result (* (add 5 10) (multiply 2 3)))
result
`;
  const result = await run(code);
  // (5 + 10) * (2 * 3) = 15 * 6 = 90
  assertEquals(result, 90);
});

Deno.test("Import: import constants in computation", async () => {
  const code = `
(import [PI] from "./test/fixtures/constants.hql")
(* PI 2)
`;
  const result = await run(code);
  // PI * 2 = 6.28318
  assertEquals(Math.round(result * 100000) / 100000, 6.28318);
});

Deno.test("Import: import multiple modules", async () => {
  const code = `
(import [add] from "./test/fixtures/math.hql")
(import [double] from "./test/fixtures/utils.hql")
(double (add 5 10))
`;
  const result = await run(code);
  // double(add(5, 10)) = double(15) = 30
  assertEquals(result, 30);
});

// ============================================================================
// SECTION 4: RE-EXPORTS
// ============================================================================

Deno.test("Re-export: import function through re-export", async () => {
  const code = `
(import [greet] from "./test/fixtures/reexport/middleware.hql")
(greet "World")
`;
  const result = await run(code);
  // middleware.hql re-exports greet from original.hql
  // greet("World") = "Hello, World!"
  assertEquals(result, "Hello, World!");
});

Deno.test("Re-export: import multiple items through re-export", async () => {
  const code = `
(import [greet, farewell] from "./test/fixtures/reexport/middleware.hql")
(+ (greet "Alice") " " (farewell "Bob"))
`;
  const result = await run(code);
  // greet("Alice") + " " + farewell("Bob")
  // = "Hello, Alice!" + " " + "Goodbye, Bob!"
  assertEquals(result, "Hello, Alice! Goodbye, Bob!");
});

Deno.test("Re-export: import value through re-export", async () => {
  const code = `
(import [secretValue] from "./test/fixtures/reexport/middleware.hql")
secretValue
`;
  const result = await run(code);
  // middleware.hql re-exports secretValue from original.hql
  // secretValue = 42
  assertEquals(result, 42);
});

// ============================================================================
// SECTION 5: TYPESCRIPT FILE IMPORTS
// ============================================================================

Deno.test({
  name: "TS Import: import function from TypeScript file",
  sanitizeResources: false, // Known issue: subprocess not cleaned up properly
  sanitizeOps: false,
  async fn() {
    const code = `
(import [tsMultiply] from "./test/fixtures/ts-module.ts")
(tsMultiply 5)
`;
    const result = await run(code);
    assertEquals(result, 15);
  },
});

Deno.test({
  name: "TS Import: import multiple functions from TypeScript file",
  sanitizeResources: false, // Known issue: subprocess not cleaned up properly
  sanitizeOps: false,
  async fn() {
    const code = `
(import [tsMultiply, tsAdd] from "./test/fixtures/ts-module.ts")
(+ (tsMultiply 4) (tsAdd 10 20))
`;
    const result = await run(code);
    // (4 * 3) + (10 + 20) = 12 + 30 = 42
    assertEquals(result, 42);
  },
});

Deno.test({
  name: "TS Import: import constant from TypeScript file",
  sanitizeResources: false, // Known issue: subprocess not cleaned up properly
  sanitizeOps: false,
  async fn() {
    const code = `
(import [TS_CONSTANT] from "./test/fixtures/ts-module.ts")
TS_CONSTANT
`;
    const result = await run(code);
    assertEquals(result, "TypeScript works!");
  },
});

// ============================================================================
// SECTION 6: REMOTE IMPORTS - JSR
// ============================================================================

Deno.test("JSR Import: import from jsr: specifier", async () => {
  const code = `
(import [assertEquals] from "jsr:@std/assert")
(assertEquals 1 1)
"test-passed"
`;
  const result = await run(code);
  assertEquals(result, "test-passed");
});

Deno.test("JSR Import: import multiple functions from jsr:", async () => {
  const code = `
(import [assertEquals, assertExists] from "jsr:@std/assert")
(assertEquals 1 1)
(assertExists "hello")
"test-passed"
`;
  const result = await run(code);
  assertEquals(result, "test-passed");
});

// ============================================================================
// SECTION 7: REMOTE IMPORTS - HTTPS
// ============================================================================

Deno.test("HTTPS Import: import from https:// URL", async () => {
  const code = `
(import [assertEquals] from "https://deno.land/std@0.208.0/assert/mod.ts")
(assertEquals 2 2)
"test-passed"
`;
  const result = await run(code);
  assertEquals(result, "test-passed");
});

Deno.test("HTTPS Import: import multiple functions from https://", async () => {
  const code = `
(import [assertEquals, assertNotEquals] from "https://deno.land/std@0.208.0/assert/mod.ts")
(assertEquals 1 1)
(assertNotEquals 1 2)
"test-passed"
`;
  const result = await run(code);
  assertEquals(result, "test-passed");
});

// ============================================================================
// SECTION 8: REMOTE IMPORTS - NPM
// ============================================================================

Deno.test({
  name: "NPM Import: import default export from npm package (chalk)",
  sanitizeResources: false, // npm imports may create background resources
  sanitizeOps: false,
  async fn() {
    // Test default import syntax - chalk is a default export
    const code = `
(import [default] from "npm:chalk@4.1.2")
(var chalk default)
chalk
`;
    const result = await run(code);
    // Should return the chalk object/function
    assertEquals(typeof result, "function");
  },
});

Deno.test({
  name: "NPM Import: import default export from npm package (ms)",
  sanitizeResources: false, // npm imports may create background resources
  sanitizeOps: false,
  async fn() {
    // Test default import with ms package
    const code = `
(import [default] from "npm:ms@2.1.3")
(var ms default)
ms
`;
    const result = await run(code);
    // Should return the ms function
    assertEquals(typeof result, "function");
  },
});

Deno.test({
  name: "NPM Import: use default import in variable assignment",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Verify the imported function can be assigned and returned
    const code = `
(import [default] from "npm:ms@2.1.3")
(var ms default)
ms
`;
    const result = await run(code);
    // Should return the ms function (already tested above, but verify assignment works)
    assertEquals(typeof result, "function");
  },
});
