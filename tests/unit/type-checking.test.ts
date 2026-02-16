/**
 * Comprehensive tests for HQL Type System
 *
 * Tests the actual TYPE CHECKING functionality, verifying that:
 * 1. Type errors ARE caught (wrong types produce warnings)
 * 2. Correct code passes without type errors
 * 3. All documented type features work correctly
 *
 * This complements type-annotations.test.ts which tests parsing.
 */

import { assertEquals, assertStringIncludes, assertMatch } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/hql/transpiler/index.ts";
import hql from "../../mod.ts";
import { getErrorMessage } from "../../src/common/utils.ts";
import { captureConsole } from "./helpers.ts";

/**
 * Helper to run HQL code and capture type errors and output
 * Uses transpile API for type checking and hql.run for execution
 */
async function runHQL(code: string): Promise<{ stdout: string; stderr: string; success: boolean }> {
  // Capture type errors from transpile
  const { stderr: transpileErrors } = await captureConsole(
    () => transpile(code),
    ["error"],
  );

  let stderr = transpileErrors;

  // Capture stdout from running the code, and any runtime errors
  const { stdout, stderr: runErrors } = await captureConsole(async () => {
    try {
      await hql.run(code);
    } catch (e) {
      // Capture runtime errors too (for tests that check runtime behavior)
      const errMsg = getErrorMessage(e);
      console.error(errMsg);
    }
  }, ["log", "error"]);

  if (runErrors) {
    stderr = stderr ? stderr + "\n" + runErrors : runErrors;
  }

  return {
    stdout,
    stderr,
    success: !stderr.includes("Type error"),
  };
}

// ============================================================================
// SECTION 1: BASIC TYPE CHECKING - ERRORS SHOULD BE CAUGHT
// ============================================================================

Deno.test("Type Checking - Wrong argument type at call site (backward compat: TS syntax)", async () => {
  // Backward compat: old TS-style type names still work
  const code = `
    (fn add [a:number b:number] :number (+ a b))
    (add "hello" "world")
  `;
  const result = await runHQL(code);

  // Should report type error about string not assignable to number
  assertStringIncludes(result.stderr, "Type error");
  assertMatch(result.stderr, /string.*not assignable.*number|Argument.*string.*number|Expected.*number.*got.*string/i);
});

Deno.test("Type Checking - Wrong return type", async () => {
  const code = `
    (fn get-num [] -> Int
      "not a number")
    (print (get-num))
  `;
  const result = await runHQL(code);

  // Should report type error about string not assignable to number
  assertStringIncludes(result.stderr, "Type error");
  assertMatch(result.stderr, /string.*not assignable.*number|Cannot use.*string.*where.*number/i);
});

Deno.test("Type Checking - Array access returns T | undefined", async () => {
  const code = `
    (fn first-num [arr:Array<Int>] -> Int
      (get arr 0))
    (print (first-num [1 2 3]))
  `;
  const result = await runHQL(code);

  // Should report type error about undefined
  assertStringIncludes(result.stderr, "Type error");
  assertMatch(result.stderr, /undefined|number \| undefined/i);
});

// ============================================================================
// SECTION 2: PROPERTY ACCESS TYPE CHECKING (NEW FIX!)
// ============================================================================

Deno.test({
  name: "Type Checking - Property access on wrong type (FIXED)",
  fn: async () => {
    const code = `
      (fn get-length [n:Int] -> Int
        n.length)
      (print (get-length 42))
    `;
    const result = await runHQL(code);

    // Should report type error - length doesn't exist on number
    assertStringIncludes(result.stderr, "Type error");
    assertMatch(result.stderr, /length.*does not exist.*number|Property.*length/i);
  },
});

Deno.test("Type Checking - Valid property access passes", async () => {
  const code = `
    (fn get-length [s:String] -> Int
      s.length)
    (print (get-length "hello"))
  `;
  const result = await runHQL(code);

  // Should NOT have type errors (string has .length)
  const hasTypeError = result.stderr.includes("Type error");
  assertEquals(hasTypeError, false, `Unexpected type error: ${result.stderr}`);
  assertEquals(result.stdout, "5");
});

// ============================================================================
// SECTION 3: METHOD RETURN TYPE INFERENCE (NEW FIX!)
// ============================================================================

Deno.test("Type Checking - Method return type mismatch (FIXED)", async () => {
  const code = `
    (fn upper [s:String] -> Int
      (.toUpperCase s))
    (print (upper "hello"))
  `;
  const result = await runHQL(code);

  // Should report type error - toUpperCase returns string, not number
  assertStringIncludes(result.stderr, "Type error");
  assertMatch(result.stderr, /string.*not assignable.*number|Cannot use.*string.*where.*number/i);
});

Deno.test("Type Checking - Correct method return type passes", async () => {
  const code = `
    (fn upper [s:String] -> String
      (.toUpperCase s))
    (print (upper "hello"))
  `;
  const result = await runHQL(code);

  // Should NOT have type errors
  const hasTypeError = result.stderr.includes("Type error");
  assertEquals(hasTypeError, false, `Unexpected type error: ${result.stderr}`);
  assertEquals(result.stdout, "HELLO");
});

// ============================================================================
// SECTION 4: TYPE INFERENCE (NEW FIX!)
// ============================================================================

Deno.test("Untyped HQL catches wrong method on number at runtime", async () => {
  // Untyped code - no type annotations
  // Error caught at runtime (like JavaScript/Python)
  const code = `
    (let x 5)
    (print (.toUpperCase x))
  `;
  const result = await runHQL(code);

  // Should catch error: numbers don't have toUpperCase
  assertStringIncludes(result.stderr, "is not a function");
});

Deno.test("Type Checking - Type inference allows correct method on string", async () => {
  const code = `
    (let s "hello")
    (print (.toUpperCase s))
  `;
  const result = await runHQL(code);

  // Should NOT have type errors
  const hasTypeError = result.stderr.includes("Type error");
  assertEquals(hasTypeError, false, `Unexpected type error: ${result.stderr}`);
  assertEquals(result.stdout, "HELLO");
});

// ============================================================================
// SECTION 5: GENERIC TYPES
// ============================================================================

Deno.test("Type Checking - Array<T> type mismatch at call site", async () => {
  const code = `
    (fn sum [nums:Array<Int>] -> Int
      (reduce + 0 nums))
    (sum ["a" "b" "c"])
  `;
  const result = await runHQL(code);

  // Should report type error about string[] not assignable to number[]
  assertStringIncludes(result.stderr, "Type error");
});

Deno.test("Type Checking - Array<T> correct usage passes", async () => {
  const code = `
    (fn first-element [arr:Array<String>] -> String
      (get arr 0))
    (print (or (first-element ["hello" "world"]) "default"))
  `;
  const result = await runHQL(code);

  // Code should run (may have undefined warning which is fine)
  assertEquals(result.stdout, "hello");
});

// ============================================================================
// SECTION 6: UNION TYPES
// ============================================================================

Deno.test("Type Checking - Union type accepts valid types", async () => {
  const code = `
    (fn maybe-double [v:String|Int] -> String|Int
      v)
    (print (maybe-double 42))
    (print (maybe-double "hello"))
  `;
  const result = await runHQL(code);

  // Should work for both string and number
  assertStringIncludes(result.stdout, "42");
  assertStringIncludes(result.stdout, "hello");
});

Deno.test("Type Checking - Union type rejects invalid types", async () => {
  const code = `
    (fn stringify [v:String|Int] -> String
      (str v))
    (stringify true)
  `;
  const result = await runHQL(code);

  // Should report type error - boolean not in string|number
  assertStringIncludes(result.stderr, "Type error");
});

// ============================================================================
// SECTION 7: VOID AND ANY TYPES
// ============================================================================

Deno.test("Type Checking - void return type", async () => {
  const code = `
    (fn log-msg [msg:String] -> Void
      (print msg))
    (log-msg "hello")
  `;
  const result = await runHQL(code);

  // Should work without type errors
  const hasTypeError = result.stderr.includes("Type error");
  assertEquals(hasTypeError, false, `Unexpected type error: ${result.stderr}`);
  assertEquals(result.stdout, "hello");
});

Deno.test("Type Checking - any type accepts anything", async () => {
  const code = `
    (fn identity [x:Any] -> Any x)
    (print (identity 42))
    (print (identity "hello"))
    (print (identity true))
  `;
  const result = await runHQL(code);

  // Should work without type errors
  const hasTypeError = result.stderr.includes("Type error");
  assertEquals(hasTypeError, false, `Unexpected type error: ${result.stderr}`);
});

// ============================================================================
// SECTION 8: GRADUAL TYPING (MIXED)
// ============================================================================

Deno.test("Type Checking - Mixed typed and untyped params", async () => {
  const code = `
    (fn process [typed:Int untyped]
      (+ typed untyped))
    (print (process 10 20))
  `;
  const result = await runHQL(code);

  // Should work - untyped param is implicitly any
  const hasTypeError = result.stderr.includes("Type error");
  assertEquals(hasTypeError, false, `Unexpected type error: ${result.stderr}`);
  assertEquals(result.stdout, "30");
});

Deno.test("Type Checking - Mixed typed and untyped with wrong typed arg", async () => {
  const code = `
    (fn process [typed:Int untyped]
      (+ typed untyped))
    (process "wrong" 20)
  `;
  const result = await runHQL(code);

  // Should catch error on typed param
  assertStringIncludes(result.stderr, "Type error");
});

// ============================================================================
// SECTION 9: BACKWARD COMPATIBILITY
// ============================================================================

Deno.test("Type Checking - Untyped code works identically", async () => {
  const code = `
    (fn add [a b] (+ a b))
    (fn sub [a b] (- a b))
    (print (add 10 5))
    (print (sub 10 5))
  `;
  const result = await runHQL(code);

  // Should work without any type errors
  const hasTypeError = result.stderr.includes("Type error");
  assertEquals(hasTypeError, false, `Unexpected type error: ${result.stderr}`);
  assertEquals(result.stdout, "15\n5");
});

// ============================================================================
// SECTION 10: T[] SHORTHAND
// ============================================================================

Deno.test("Type Checking - T[] shorthand in return type works", async () => {
  const code = `
    (fn get-nums [] -> Int[]
      [1 2 3])
    (print (get-nums))
  `;
  const result = await runHQL(code);

  // T[] should work in return position
  assertEquals(result.stdout, "[ 1, 2, 3 ]");
});

// ============================================================================
// SECTION 11: CORRECT CODE (NO FALSE POSITIVES)
// ============================================================================

Deno.test("Type Checking - Fully typed calculator functions", async () => {
  const code = `
    (fn add [a:Int b:Int] -> Int (+ a b))
    (fn mul [a:Int b:Int] -> Int (* a b))
    (print (add 10 5))
    (print (mul 3 4))
  `;
  const result = await runHQL(code);

  const hasTypeError = result.stderr.includes("Type error");
  assertEquals(hasTypeError, false, `Unexpected type error: ${result.stderr}`);
  assertEquals(result.stdout, "15\n12");
});

Deno.test("Type Checking - Boolean functions", async () => {
  const code = `
    (fn is-positive [n:Int] -> Bool
      (> n 0))
    (fn is-even [n:Int] -> Bool
      (=== (mod n 2) 0))
    (print (is-positive 5))
    (print (is-even 4))
  `;
  const result = await runHQL(code);

  const hasTypeError = result.stderr.includes("Type error");
  assertEquals(hasTypeError, false, `Unexpected type error: ${result.stderr}`);
  assertEquals(result.stdout, "true\ntrue");
});

Deno.test("Type Checking - String functions", async () => {
  const code = `
    (fn greet [name:String] -> String
      (+ "Hello, " name "!"))
    (print (greet "World"))
  `;
  const result = await runHQL(code);

  const hasTypeError = result.stderr.includes("Type error");
  assertEquals(hasTypeError, false, `Unexpected type error: ${result.stderr}`);
  assertEquals(result.stdout, "Hello, World!");
});

// ============================================================================
// SECTION 12: DOT NOTATION CODE GENERATION
// ============================================================================

Deno.test({
  name: "Type Checking - Dot notation generates proper TypeScript",
  fn: async () => {
    // This test verifies that n.length generates (n).length not (n)["length"]
    const code = `
      (fn valid-length [s:String] -> Int s.length)
      (fn invalid-length [n:Int] -> Int n.length)
      (print "done")
    `;
    const result = await runHQL(code);

    // valid-length should pass, invalid-length should fail
    assertStringIncludes(result.stderr, "Type error");
    assertMatch(result.stderr, /length.*does not exist.*number/i);

    // Code still runs (type errors are warnings)
    assertEquals(result.stdout, "done");
  },
});

// ============================================================================
// SECTION 13: EDGE CASES
// ============================================================================

Deno.test("Type Checking - Empty params with return type", async () => {
  const code = `
    (fn get-value [] -> Int 42)
    (print (get-value))
  `;
  const result = await runHQL(code);

  const hasTypeError = result.stderr.includes("Type error");
  assertEquals(hasTypeError, false, `Unexpected type error: ${result.stderr}`);
  assertEquals(result.stdout, "42");
});

Deno.test("Type Checking - Anonymous function with types", async () => {
  const code = `
    (const double (fn [x:Int] -> Int (* x 2)))
    (print (double 21))
  `;
  const result = await runHQL(code);

  const hasTypeError = result.stderr.includes("Type error");
  assertEquals(hasTypeError, false, `Unexpected type error: ${result.stderr}`);
  assertEquals(result.stdout, "42");
});

Deno.test("Type Checking - Promise return type syntax", async () => {
  const code = `
    (async fn fetch-data [url:String] -> Promise<String>
      "mock data")
    (print "async function defined")
  `;
  const result = await runHQL(code);

  // Should parse and transpile without errors
  const hasTypeError = result.stderr.includes("Type error");
  assertEquals(hasTypeError, false, `Unexpected type error: ${result.stderr}`);
});

// ============================================================================
// SECTION 14: COMPREHENSIVE INTEGRATION TEST
// ============================================================================

Deno.test("Type Checking - Comprehensive integration test", async () => {
  const code = `
    // All type features in one test

    // 1. Basic types
    (fn add [a:Int b:Int] -> Int (+ a b))

    // 2. String types
    (fn greet [name:String] -> String (+ "Hi " name))

    // 3. Boolean types
    (fn is-positive [n:Int] -> Bool (> n 0))

    // 4. Union types
    (fn echo [v:String|Int] -> String|Int v)

    // 6. void return
    (fn log [msg:String] -> Void (print msg))

    // 7. any type
    (fn identity [x:Any] -> Any x)

    // 8. Gradual typing (mixed)
    (fn mixed [typed:Int untyped] (+ typed untyped))

    // 9. Property access (FIXED)
    (fn str-len [s:String] -> Int s.length)

    // 10. Method calls (FIXED)
    (fn upper [s:String] -> String (.toUpperCase s))

    // Test correct usage
    (print (add 1 2))
    (print (greet "World"))
    (print (is-positive 5))
    (print (echo 42))
    (print (str-len "hello"))
    (print (upper "test"))

    (print "All tests passed!")
  `;
  const result = await runHQL(code);

  // Should have no type errors for correct code
  const typeErrors = (result.stderr.match(/Type error/g) || []).length;
  assertEquals(typeErrors, 0, `Expected 0 type errors, got ${typeErrors}. Stderr: ${result.stderr}`);

  // Verify outputs
  assertStringIncludes(result.stdout, "3");        // add
  assertStringIncludes(result.stdout, "Hi World"); // greet
  assertStringIncludes(result.stdout, "true");     // is-positive
  assertStringIncludes(result.stdout, "42");       // echo
  assertStringIncludes(result.stdout, "5");        // str-len
  assertStringIncludes(result.stdout, "TEST");    // upper
  assertStringIncludes(result.stdout, "All tests passed!");
});
