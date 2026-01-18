/**
 * Tests for macro system bugs that need fixing
 * These tests document the expected behavior after fixes
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import hql from "../../mod.ts";
import { defineMacro, hqlEval, resetRuntime, transpile } from "../../mod.ts";
import { captureConsole } from "./helpers.ts";

// ============================================================================
// BUG 1: CACHE INVALIDATION
// ============================================================================

Deno.test("Macro Bug Fix: Cache invalidation on redefinition (runtime API)", async () => {
  await resetRuntime();

  // Define macro that adds 1
  await defineMacro("(macro cache-test [n] `(+ 1 ~n))");
  const js1 = await hqlEval("(cache-test 5)");
  const result1 = eval(js1); // Execute the generated JS
  assertEquals(result1, 6, "First definition should return 6");

  // Redefine macro to add 2
  await defineMacro("(macro cache-test [n] `(+ 2 ~n))");
  const js2 = await hqlEval("(cache-test 5)");
  const result2 = eval(js2); // Execute the generated JS
  assertEquals(result2, 7, "After redefinition should return 7 (not cached 6)");
});

Deno.test("Macro Bug Fix: Cache invalidation within same compilation", async () => {
  const code = `
(macro redef [x] \`(+ 1 ~x))
(var r1 (redef 5))

(macro redef [x] \`(+ 2 ~x))
(var r2 (redef 5))

[r1 r2]
`;
  const result = await hql.run(code);
  assertEquals(result, [6, 7], "Both definitions should work independently");
});

// ============================================================================
// BUG 2: NESTED QUASIQUOTE
// ============================================================================

Deno.test("Macro Bug Fix: Nested quasiquote with single unquote", async () => {
  const code = `
(var x 42)
\`(outer \`(inner ~x))
`;
  const result = await hql.run(code);
  // Inner quasiquote should expand, inner unquote should NOT evaluate (depth=1)
  // Expected: ["outer", ["inner", "x"]] - x is quoted at inner level
  assertEquals(
    result,
    ["outer", ["inner", "x"]],
    "Nested quasiquote should preserve inner structure with quoted x",
  );
});

Deno.test("Macro Bug Fix: Nested quasiquote with double unquote", async () => {
  const code = `
(var x 42)
\`(outer \`(inner ~~x))
`;
  const result = await hql.run(code);
  // Double unquote should evaluate at outer level
  // Expected: ["outer", ["inner", 42]]
  assertEquals(
    result,
    ["outer", ["inner", 42]],
    "Double unquote should evaluate at outer level",
  );
});

Deno.test("Macro Bug Fix: Triple nested quasiquote", async () => {
  const code = `
(var x 42)
\`(a \`(b \`(c ~x)))
`;
  const result = await hql.run(code);
  // At depth 2, ~x doesn't evaluate
  // Expected: ["a", ["b", ["c", "x"]]]
  assertEquals(
    result,
    ["a", ["b", ["c", "x"]]],
    "Triple nesting should preserve innermost structure",
  );
});

// ============================================================================
// BUG 3: VARIABLE CAPTURE (HYGIENE)
// ============================================================================

Deno.test("Macro behavior: Variable capture (manual hygiene)", async () => {
  const code = `
(var x 100)
(macro use-x []
  \`(+ x 5))

(fn test-scope []
  (var x 200)
  (use-x))

(test-scope)
`;
  // Known limitation: HQL uses manual hygiene (like Common Lisp)
  // Free variables in macro bodies capture from call site scope
  // Result: uses x=200 from call site → 200 + 5 = 205
  const result = await hql.run(code);
  assertEquals(result, 205, "Free variable captures from call site scope");
});

Deno.test("Macro behavior: Manual hygiene with unique names works", async () => {
  const code = `
(macro with-temp [value & body]
  \`(let (temp_generated_1234 ~value)
     ~@body))

(var temp 999)
(with-temp 100
  temp_generated_1234)
`;
  // Manual hygiene: using a unique variable name avoids collision
  const result = await hql.run(code);
  assertEquals(result, 100, "Manually unique variable names work");
});

Deno.test("Macro behavior: Basic macros work correctly", async () => {
  // Known Limitation: HQL does not have automatic hygiene like Scheme/Clojure
  // Users must manually ensure variable names don't collide
  // This is similar to Common Lisp's approach
  const code = `
(macro simple [x]
  \`(* 2 ~x))
(simple 5)
`;
  const result = await hql.run(code);
  assertEquals(result, 10, "Basic macros work fine");
});

Deno.test("Macro behavior: Free variables capture from outer scope", async () => {
  const code = `
(var scale 10)
(macro multiply-by-scale [n]
  \`(* scale ~n))

(multiply-by-scale 5)
`;
  // Known limitation: scale is a free variable that captures from outer scope
  // In a fully hygienic system, this would error or be renamed
  // Currently it captures scale=10 from the definition site
  const result = await hql.run(code);
  assertEquals(
    result,
    50,
    "Free variable captures from outer scope: 10 * 5 = 50",
  );
});

Deno.test("Macro behavior: Explicitly unquoted variables capture correctly", async () => {
  const code = `
(macro use-var [var-name value]
  \`(+ ~var-name ~value))

(var x 100)
(use-var x 5)
`;
  // ~var-name is explicitly unquoted, so it SHOULD evaluate to x
  // Then x SHOULD capture the outer x=100
  // Result: 100 + 5 = 105
  const result = await hql.run(code);
  assertEquals(
    result,
    105,
    "Explicitly unquoted variables should capture correctly",
  );
});

// ============================================================================
// BUG FIX: SAME-FILE MACRO POSITION TRACKING
// ============================================================================

Deno.test({
  name: "Macro Bug Fix: Same-file macro error reports call site position (December 2024)",
  fn: async () => {
  // This tests that when a macro is defined and called in the same file,
  // type errors report the CALL SITE position, not the macro definition position
  //
  // Previously, errors would report line 2 (macro definition) instead of line 5 (call site)

  const code = `
(macro my-add [a b]
  \`(+ ~a ~b))

(fn check [x:number] :number x)
(check (my-add "wrong" 5))
`;

  // Use transpile API to capture type errors
  const { stderr } = await captureConsole(
    () => transpile(code),
    ["error"],
  );

  // Should have a type error
  assertEquals(stderr.includes("Type error"), true, "Expected type error");

  // CRITICAL: Error should report line 6 (call site), NOT line 2 (macro definition)
  // The error format is: "Type error at <file>:<line>:<column>"
  const errorMatch = stderr.match(/Type error at [^:]+:(\d+):(\d+)/);

  assertEquals(
    errorMatch !== null,
    true,
    `Expected type error with location, got: ${stderr}`,
  );

  if (errorMatch) {
    const errorLine = parseInt(errorMatch[1], 10);
    // Line 6 is where (check (my-add "wrong" 5)) is called
    // The macro call (my-add "wrong" 5) is at column ~8
    assertEquals(
      errorLine,
      6,
      `Error should report call site (line 6), not macro definition (line 2). Got line ${errorLine}`,
    );
  }
  },
});
