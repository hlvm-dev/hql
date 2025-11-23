// test/syntax-error.test.ts
// Comprehensive tests for error handling (try/catch/finally/throw)
// REAL RUNTIME TESTS - Execute actual code and verify results

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

// ============================================================================
// SECTION 1: THROW STATEMENT
// ============================================================================

Deno.test("Error: throw string error", async () => {
  const code = `
(try
  (throw "simple error")
  (catch e
    e))
`;
  const result = await run(code);
  assertEquals(result, "simple error");
});

Deno.test("Error: throw number error", async () => {
  const code = `
(try
  (throw 404)
  (catch e
    e))
`;
  const result = await run(code);
  assertEquals(result, 404);
});

Deno.test("Error: throw after helper retains thrown value", async () => {
  const code = `
(try
  (do
    (range 5)
    (throw "boom"))
  (catch e
    e))
`;
  const result = await run(code);
  assertEquals(result, "boom");
});

// ============================================================================
// SECTION 2: TRY/CATCH
// ============================================================================

Deno.test("Error: try/catch catches thrown error", async () => {
  const code = `
(try
  (throw "caught error")
  (catch e
    (+ "Handled: " e)))
`;
  const result = await run(code);
  assertEquals(result, "Handled: caught error");
});

Deno.test("Error: try/catch with no error returns value", async () => {
  const code = `
(try
  42
  (catch e
    0))
`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Error: try/catch can access error parameter", async () => {
  const code = `
(try
  (throw "test message")
  (catch err
    err))
`;
  const result = await run(code);
  assertEquals(result, "test message");
});

// ============================================================================
// SECTION 3: TRY/FINALLY
// ============================================================================

Deno.test("Error: try/finally executes finally block", async () => {
  const code = `
(var cleanup false)
(try
  42
  (finally
    (set! cleanup true)))
cleanup
`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Error: try/finally returns try value", async () => {
  const code = `
(try
  "success"
  (finally
    (var done true)))
`;
  const result = await run(code);
  assertEquals(result, "success");
});

// ============================================================================
// SECTION 4: TRY/CATCH/FINALLY
// ============================================================================

Deno.test("Error: try/catch/finally all execute on error", async () => {
  const code = `
(var cleanup false)
(try
  (throw "error")
  (catch e
    (+ "Caught: " e))
  (finally
    (set! cleanup true)))
`;
  const result = await run(code);
  assertEquals(result, "Caught: error");
});

Deno.test("Error: try/catch/finally executes finally on success", async () => {
  const code = `
(var executed false)
(let result
  (try
    100
    (catch e
      0)
    (finally
      (set! executed true))))
[result, executed]
`;
  const result = await run(code);
  assertEquals(result, [100, true]);
});

// ============================================================================
// SECTION 5: NESTED ERROR HANDLING
// ============================================================================

Deno.test("Error: nested try/catch blocks", async () => {
  const code = `
(try
  (try
    (throw "inner error")
    (catch e
      (+ "Inner: " e)))
  (catch outer
    (+ "Outer: " outer)))
`;
  const result = await run(code);
  assertEquals(result, "Inner: inner error");
});

Deno.test("Error: catch in inner, rethrow to outer", async () => {
  const code = `
(try
  (try
    (throw "propagated")
    (catch e
      (throw (+ "Modified: " e))))
  (catch final
    final))
`;
  const result = await run(code);
  assertEquals(result, "Modified: propagated");
});

// ============================================================================
// SECTION 6: ERROR HANDLING IN FUNCTIONS
// ============================================================================

Deno.test("Error: function with try/catch for safe division", async () => {
  const code = `
(fn safe-divide [a b]
  (try
    (/ a b)
    (catch e
      0)))
(safe-divide 10 2)
`;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("Error: throw from function caught outside", async () => {
  const code = `
(fn thrower []
  (try
    (throw "error from function")
    (catch inner
      (throw inner))))
(try
  (thrower)
  (catch e
    (+ "Caught: " e)))
`;
  const result = await run(code);
  assertEquals(result, "Caught: error from function");
});

// ============================================================================
// SECTION 7: COMPLEX ERROR SCENARIOS
// ============================================================================

Deno.test("Error: try block returns successful value", async () => {
  const code = `
(let result
  (try
    (+ 10 20)
    (catch e
      0)))
result
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Error: catch block handles actual error", async () => {
  const code = `
(try
  (do
    (throw "test")
    100)
  (catch e
    (+ e " caught")))
`;
  const result = await run(code);
  assertEquals(result, "test caught");
});
