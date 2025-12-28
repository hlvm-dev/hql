/**
 * Expression-Everywhere Tests for Iteration and Case
 *
 * Tests that for-of, for-await-of, and case are true expressions
 * that return values, following Clojure's semantics.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/transpiler/index.ts";
import { run } from "./helpers.ts";

// ============================================================================
// FOR-OF AS EXPRESSION - Returns nil (like Clojure's doseq)
// ============================================================================

Deno.test("for-of: returns null (expression semantics)", async () => {
  const code = `
    (let result (for-of [x [1 2 3]]
                  (console.log x)))
    result
  `;
  assertEquals(await run(code), null);
});

Deno.test("for-of: can be used in expression position", async () => {
  const code = `
    (let results [
      (for-of [x [1]] x)
      (for-of [y [2]] y)
    ])
    results
  `;
  assertEquals(await run(code), [null, null]);
});

Deno.test("for-of: works in if branches", async () => {
  const code = `
    (let arr [])
    (if true
      (for-of [x [1 2 3]] (arr.push x))
      (for-of [x [4 5 6]] (arr.push x)))
    arr
  `;
  assertEquals(await run(code), [1, 2, 3]);
});

Deno.test("for-of: generates IIFE wrapper", async () => {
  const result = await transpile(`
    (for-of [x items]
      (process x))
  `);
  // Should be wrapped in an IIFE that returns null
  assertStringIncludes(result.code, "return null");
});

Deno.test("for-of: IIFE is invoked immediately", async () => {
  const result = await transpile(`
    (let result (for-of [x [1 2 3]] x))
  `);
  // The IIFE should be called: (() => { ... })()
  assertStringIncludes(result.code, ")()");
});

// ============================================================================
// FOR-AWAIT-OF AS EXPRESSION - Returns nil asynchronously
// ============================================================================

Deno.test("for-await-of: generates async IIFE", async () => {
  const result = await transpile(`
    (for-await-of [chunk stream]
      (process chunk))
  `);
  // Should be wrapped in an async IIFE
  assertStringIncludes(result.code, "async");
  assertStringIncludes(result.code, "return null");
});

Deno.test("for-await-of: returns null after iteration", async () => {
  // Just test the transpiled output has async IIFE
  const result = await transpile(`
    (async fn test []
      (for-await-of [x stream]
        (process x)))
  `);
  // The for-await-of should be wrapped in async IIFE
  assertStringIncludes(result.code, "async");
  assertStringIncludes(result.code, "for await");
  assertStringIncludes(result.code, "return null");
});

// ============================================================================
// CASE AS EXPRESSION - Returns matched value (like Clojure's case)
// ============================================================================

Deno.test("case: returns matched value", async () => {
  const code = `
    (let day "monday")
    (case day
      "monday" "Start of week"
      "friday" "Almost weekend"
      "Other day")
  `;
  assertEquals(await run(code), "Start of week");
});

Deno.test("case: returns default when no match", async () => {
  const code = `
    (let day "wednesday")
    (case day
      "monday" "Start of week"
      "friday" "Almost weekend"
      "Other day")
  `;
  assertEquals(await run(code), "Other day");
});

Deno.test("case: returns null when no match and no default", async () => {
  const code = `
    (let day "wednesday")
    (case day
      "monday" "Start of week"
      "friday" "Almost weekend")
  `;
  assertEquals(await run(code), null);
});

Deno.test("case: can be assigned to variable", async () => {
  const code = `
    (let status "ok")
    (let message (case status
                   "ok" "Success"
                   "error" "Failed"
                   "Unknown"))
    message
  `;
  assertEquals(await run(code), "Success");
});

Deno.test("case: works with numbers", async () => {
  const code = `
    (let code 200)
    (case code
      200 "OK"
      404 "Not Found"
      500 "Server Error"
      "Unknown")
  `;
  assertEquals(await run(code), "OK");
});

Deno.test("case: works in expression position", async () => {
  const code = `
    (let x 1)
    (let y 2)
    (+
      (case x 1 10 2 20 0)
      (case y 1 100 2 200 0))
  `;
  // x=1 -> 10, y=2 -> 200, total = 210
  assertEquals(await run(code), 210);
});

Deno.test("case: can be used in array literal", async () => {
  const code = `
    [
      (case 1 1 "one" 2 "two" "other")
      (case 2 1 "one" 2 "two" "other")
      (case 3 1 "one" 2 "two" "other")
    ]
  `;
  assertEquals(await run(code), ["one", "two", "other"]);
});

Deno.test("case: can be used as function argument", async () => {
  const code = `
    (fn describe [s] (str "Status: " s))
    (describe (case "active"
                "active" "Running"
                "stopped" "Halted"
                "Unknown"))
  `;
  assertEquals(await run(code), "Status: Running");
});

Deno.test("case: generates native ternary (optimized)", async () => {
  const result = await transpile(`
    (case x
      1 "one"
      2 "two"
      "other")
  `);
  // Now optimized to chained ternaries instead of IIFE-wrapped switch
  assertStringIncludes(result.code, "x === 1");
  assertStringIncludes(result.code, "x === 2");
  assertStringIncludes(result.code, "?");
});

Deno.test("case: returns expression result not statement", async () => {
  const code = `
    (let result (case "test"
                  "test" (+ 1 2 3)
                  0))
    result
  `;
  assertEquals(await run(code), 6);
});

// ============================================================================
// COMPOSITIONAL TESTS - Combining with other expressions
// ============================================================================

Deno.test("composition: for-of in function body", async () => {
  const code = `
    (fn processAll [items]
      (let results [])
      (for-of [x items]
        (results.push (* x 2)))
      results)
    (processAll [1 2 3])
  `;
  assertEquals(await run(code), [2, 4, 6]);
});

Deno.test("composition: case inside for-of", async () => {
  const code = `
    (let results [])
    (for-of [x [1 2 3]]
      (results.push (case x
                      1 "one"
                      2 "two"
                      3 "three")))
    results
  `;
  assertEquals(await run(code), ["one", "two", "three"]);
});

Deno.test("composition: case with complex expressions", async () => {
  const code = `
    (let op "add")
    (let a 10)
    (let b 5)
    (case op
      "add" (+ a b)
      "sub" (- a b)
      "mul" (* a b)
      "div" (/ a b)
      0)
  `;
  assertEquals(await run(code), 15);
});

Deno.test("composition: nested case expressions", async () => {
  const code = `
    (let category "fruit")
    (let item "apple")
    (case category
      "fruit" (case item
                "apple" "Red fruit"
                "banana" "Yellow fruit"
                "Unknown fruit")
      "vegetable" "Some veggie"
      "Unknown category")
  `;
  assertEquals(await run(code), "Red fruit");
});

// ============================================================================
// MACRO COMPATIBILITY - Works with macros
// ============================================================================

Deno.test("macro: for-of works inside when", async () => {
  const code = `
    (let arr [])
    (when true
      (for-of [x [1 2 3]]
        (arr.push x)))
    arr
  `;
  assertEquals(await run(code), [1, 2, 3]);
});

Deno.test("macro: case works inside if", async () => {
  const code = `
    (let type "a")
    (let subtype "x")
    (if (=== type "a")
      (case subtype
        "x" "A-X"
        "y" "A-Y"
        "A-other")
      "Unknown")
  `;
  assertEquals(await run(code), "A-X");
});

// ============================================================================
// SWITCH AS EXPRESSION - Returns matched value
// ============================================================================

Deno.test("switch: returns matched value", async () => {
  const code = `
    (let day "monday")
    (switch day
      (case "monday" "Start of week")
      (case "friday" "Almost weekend")
      (default "Other day"))
  `;
  assertEquals(await run(code), "Start of week");
});

Deno.test("switch: returns default when no match", async () => {
  const code = `
    (let day "wednesday")
    (switch day
      (case "monday" "Start of week")
      (case "friday" "Almost weekend")
      (default "Other day"))
  `;
  assertEquals(await run(code), "Other day");
});

Deno.test("switch: returns null when no match and no default", async () => {
  const code = `
    (let day "wednesday")
    (switch day
      (case "monday" "Start of week")
      (case "friday" "Almost weekend"))
  `;
  assertEquals(await run(code), null);
});

Deno.test("switch: can be assigned to variable", async () => {
  const code = `
    (let status "ok")
    (let message (switch status
                   (case "ok" "Success")
                   (case "error" "Failed")
                   (default "Unknown")))
    message
  `;
  assertEquals(await run(code), "Success");
});

Deno.test("switch: works with numbers", async () => {
  const code = `
    (let code 200)
    (switch code
      (case 200 "OK")
      (case 404 "Not Found")
      (case 500 "Server Error")
      (default "Unknown"))
  `;
  assertEquals(await run(code), "OK");
});

Deno.test("switch: works in expression position", async () => {
  const code = `
    (let x 1)
    (let y 2)
    (+
      (switch x (case 1 10) (case 2 20) (default 0))
      (switch y (case 1 100) (case 2 200) (default 0)))
  `;
  assertEquals(await run(code), 210);
});

Deno.test("switch: with multi-statement body returns last value", async () => {
  const code = `
    (let x "test")
    (switch x
      (case "test"
        (let a 10)
        (let b 20)
        (+ a b))
      (default 0))
  `;
  assertEquals(await run(code), 30);
});

Deno.test("switch: generates native ternary (optimized)", async () => {
  const result = await transpile(`
    (switch x
      (case 1 "one")
      (case 2 "two")
      (default "other"))
  `);
  // Now optimized to chained ternaries instead of IIFE-wrapped switch
  assertStringIncludes(result.code, "x === 1");
  assertStringIncludes(result.code, "x === 2");
  assertStringIncludes(result.code, "?");
});

// ============================================================================
// LABELED BREAK/CONTINUE WITH FOR-OF - Edge case handling
// ============================================================================

Deno.test("labeled break: works with for-of (label inside IIFE)", async () => {
  const code = `
    (let results [])
    (label outer
      (for-of [x [1 2 3 4 5]]
        (if (=== x 3)
          (break outer)
          (results.push x))))
    results
  `;
  // Should break at 3, collecting only [1, 2]
  assertEquals(await run(code), [1, 2]);
});

Deno.test("labeled break: for-of with label returns null", async () => {
  const code = `
    (let arr [])
    (let result (label outer
                  (for-of [x [1 2 3]]
                    (arr.push x)
                    (if (=== x 2) (break outer)))))
    [arr result]
  `;
  assertEquals(await run(code), [[1, 2], null]);
});

Deno.test("labeled break: generates label inside IIFE", async () => {
  const result = await transpile(`
    (label outer
      (for-of [x items]
        (if (=== x 2) (break outer))))
  `);
  // Label should be inside IIFE, not outside
  // Pattern: (() => { outer: for (const x of ...) { ... }; return null; })()
  assertStringIncludes(result.code, "outer:");
  assertStringIncludes(result.code, "for (const");
  assertStringIncludes(result.code, "return null");
  assertStringIncludes(result.code, ")()");
});

Deno.test("labeled continue: works with for-of", async () => {
  const code = `
    (let results [])
    (label outer
      (for-of [x [1 2 3 4 5]]
        (if (=== x 3)
          (continue outer)
          (results.push x))))
    results
  `;
  // Should skip 3, collecting [1, 2, 4, 5]
  assertEquals(await run(code), [1, 2, 4, 5]);
});

Deno.test("labeled break: nested for-of loops", async () => {
  const code = `
    (let results [])
    (label outer
      (for-of [x [1 2 3]]
        (for-of [y ["a" "b" "c"]]
          (if (and (=== x 2) (=== y "b"))
            (break outer)
            (results.push (str x y))))))
    results
  `;
  // Should break when x=2, y="b", collecting ["1a", "1b", "1c", "2a"]
  assertEquals(await run(code), ["1a", "1b", "1c", "2a"]);
});

// ============================================================================
// DEEP NESTING TESTS - Verify generalized solution works at any depth
// ============================================================================

Deno.test("labeled break: for-of inside do block", async () => {
  const code = `
    (let results [])
    (label outer
      (do
        (results.push "start")
        (for-of [x [1 2 3]]
          (if (=== x 2) (break outer))
          (results.push x))))
    results
  `;
  assertEquals(await run(code), ["start", 1]);
});

Deno.test("labeled break: for-of inside if branch", async () => {
  const code = `
    (let results [])
    (label outer
      (if true
        (for-of [x [1 2 3]]
          (if (=== x 2) (break outer))
          (results.push x))))
    results
  `;
  assertEquals(await run(code), [1]);
});

Deno.test("labeled break: for-of inside when macro", async () => {
  const code = `
    (let results [])
    (label outer
      (when true
        (for-of [x [1 2 3]]
          (if (=== x 2) (break outer))
          (results.push x))))
    results
  `;
  assertEquals(await run(code), [1]);
});

Deno.test("labeled break: multiple nested labels (both targeted)", async () => {
  const code = `
    (let results [])
    (label outer
      (label inner
        (for-of [x [1 2 3 4 5]]
          (if (=== x 2) (continue inner))
          (if (=== x 4) (break outer))
          (results.push x))))
    results
  `;
  // x=1 → push, x=2 → continue inner, x=3 → push, x=4 → break outer
  assertEquals(await run(code), [1, 3]);
});

Deno.test("labeled break: returns null from deeply nested structure", async () => {
  const code = `
    (let result
      (label outer
        (do
          (let arr [])
          (for-of [x [1 2 3]]
            (if (=== x 2) (break outer))
            (arr.push x)))))
    result
  `;
  assertEquals(await run(code), null);
});
