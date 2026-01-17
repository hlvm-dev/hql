/**
 * Production-Ready Features Edge Case Tests
 *
 * Comprehensive tests for production-ready features:
 * 1. withRecovery<T> - Error recovery utility
 * 2. Error handling robustness
 * 3. Expression semantics
 *
 * These tests ensure genuine implementations, not hacks.
 */

import { assertEquals, assertExists, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { withRecovery } from "../../src/common/error.ts";
import hql from "../../mod.ts";

// ============================================================================
// PART 1: withRecovery<T> Edge Cases
// ============================================================================

Deno.test("withRecovery: operation succeeds - returns value directly", () => {
  const result = withRecovery(
    () => 42,
    () => 0,
    "test success"
  );

  assertEquals(result.ok, true);
  assertEquals(result.value, 42);
  assertEquals(result.recovered, false);
  assertEquals(result.error, undefined);
});

Deno.test("withRecovery: operation fails, fallback succeeds", () => {
  const result = withRecovery(
    () => { throw new Error("primary failed"); },
    () => "fallback value",
    "test fallback"
  );

  assertEquals(result.ok, true);
  assertEquals(result.value, "fallback value");
  assertEquals(result.recovered, true);
  assertExists(result.error);
  assertEquals(result.error?.message, "primary failed");
});

Deno.test("withRecovery: both operation and fallback fail", () => {
  const result = withRecovery(
    () => { throw new Error("primary failed"); },
    () => { throw new Error("fallback also failed"); },
    "test double failure"
  );

  assertEquals(result.ok, false);
  assertEquals(result.value, undefined);
  assertEquals(result.recovered, false);
  assertExists(result.error);
  assertEquals(result.error?.message, "primary failed"); // Original error preserved
});

Deno.test("withRecovery: non-Error throw is converted to Error", () => {
  const result = withRecovery(
    () => { throw "string error"; },
    () => "recovered",
    "test string throw"
  );

  assertEquals(result.ok, true);
  assertEquals(result.recovered, true);
  assertExists(result.error);
  assert(result.error instanceof Error);
  assertEquals(result.error.message, "string error");
});

Deno.test("withRecovery: handles null/undefined returns", () => {
  const resultNull = withRecovery(
    () => null,
    () => "fallback",
    "test null"
  );
  assertEquals(resultNull.ok, true);
  assertEquals(resultNull.value, null);
  assertEquals(resultNull.recovered, false);

  const resultUndefined = withRecovery(
    () => undefined,
    () => "fallback",
    "test undefined"
  );
  assertEquals(resultUndefined.ok, true);
  assertEquals(resultUndefined.value, undefined);
  assertEquals(resultUndefined.recovered, false);
});

Deno.test("withRecovery: complex object return", () => {
  const obj = { nested: { value: [1, 2, 3] } };
  const result = withRecovery(
    () => obj,
    () => ({ nested: { value: [] as number[] } }),
    "test object"
  );

  assertEquals(result.ok, true);
  assertEquals(result.value, obj);
  assertEquals(result.value.nested.value, [1, 2, 3]);
});

Deno.test("withRecovery: async-like patterns (sync simulation)", () => {
  const executionOrder: string[] = [];

  const result = withRecovery(
    () => {
      executionOrder.push("primary");
      throw new Error("fail");
    },
    () => {
      executionOrder.push("fallback");
      return "recovered";
    },
    "test execution order"
  );

  assertEquals(executionOrder, ["primary", "fallback"]);
  assertEquals(result.recovered, true);
});

Deno.test("withRecovery: batch processing pattern", () => {
  const items = [1, 2, 3, 4, 5];
  const results = items.map(n =>
    withRecovery(
      () => {
        if (n === 3) throw new Error("bad item");
        return n * 2;
      },
      () => -1, // sentinel for failed items
      `processing item ${n}`
    )
  );

  assertEquals(results.length, 5);
  assertEquals(results[0].value, 2);
  assertEquals(results[1].value, 4);
  assertEquals(results[2].value, -1); // fallback
  assertEquals(results[2].recovered, true);
  assertEquals(results[3].value, 8);
  assertEquals(results[4].value, 10);

  const successes = results.filter(r => r.ok && !r.recovered).length;
  const recovered = results.filter(r => r.recovered).length;
  assertEquals(successes, 4);
  assertEquals(recovered, 1);
});

// ============================================================================
// PART 2: Error Handler Edge Cases
// ============================================================================

Deno.test("error handler: normal errors are handled correctly", async () => {
  try {
    await hql.run(`
      (throw (new Error "test error"))
    `);
    assert(false, "Should have thrown");
  } catch (e) {
    assert(e instanceof Error);
    assert(e.message.includes("test error") || e.message.includes("Error"));
  }
});

Deno.test("error handler: undefined variable error", async () => {
  try {
    await hql.run(`
      (console.log nonexistent-variable)
    `);
    assert(false, "Should have thrown");
  } catch (e) {
    assert(e instanceof Error);
  }
});

Deno.test("error handler: type error in function call", async () => {
  try {
    await hql.run(`
      (let x 42)
      (x)
    `);
    assert(false, "Should have thrown");
  } catch (e) {
    assert(e instanceof Error);
  }
});

// ============================================================================
// PART 3: Expression Semantics Edge Cases
// ============================================================================

Deno.test("expression: if returns value", async () => {
  const result = await hql.run(`
    (let x (if true 1 2))
    x
  `);
  assertEquals(result, 1);
});

Deno.test("expression: if returns else value", async () => {
  const result = await hql.run(`
    (let x (if false 1 2))
    x
  `);
  assertEquals(result, 2);
});

Deno.test("expression: let returns last expression", async () => {
  const result = await hql.run(`
    (let [a 1 b 2]
      (+ a b))
  `);
  assertEquals(result, 3);
});

Deno.test("expression: do returns last expression", async () => {
  const result = await hql.run(`
    (do
      1
      2
      3)
  `);
  assertEquals(result, 3);
});

Deno.test("expression: nested if expressions", async () => {
  const result = await hql.run(`
    (let x (if true
             (if false 1 2)
             3))
    x
  `);
  assertEquals(result, 2);
});

Deno.test("expression: when returns value or nil", async () => {
  const resultTrue = await hql.run(`(when true 42)`);
  assertEquals(resultTrue, 42);

  const resultFalse = await hql.run(`(when false 42)`);
  assertEquals(resultFalse, null);
});

// ============================================================================
// PART 4: Macro Edge Cases (Basic)
// ============================================================================

Deno.test("macro: simple macro definition and use", async () => {
  const result = await hql.run(`
    (macro inc1 [x] \`(+ ~x 1))
    (inc1 5)
  `);
  assertEquals(result, 6);
});

Deno.test("macro: nested macro calls", async () => {
  const result = await hql.run(`
    (macro inc1 [x] \`(+ ~x 1))
    (inc1 (inc1 (inc1 0)))
  `);
  assertEquals(result, 3);
});

Deno.test("macro: gensym in macro", async () => {
  const result = await hql.run(`
    (macro my-let1 [val body]
      (let [g (gensym "x")]
        \`(let (~g ~val) ~body)))
    (my-let1 42 42)
  `);
  assertEquals(result, 42);
});

// ============================================================================
// PART 5: Data Structure Edge Cases
// ============================================================================

Deno.test("data: vector creation and access", async () => {
  const result = await hql.run(`
    (let v [1 2 3])
    [(nth v 0) (nth v 1) (nth v 2)]
  `);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("data: hash-map creation and access", async () => {
  const result = await hql.run(`
    (let m {"a": 1, "b": 2})
    [(get m "a") (get m "b")]
  `);
  assertEquals(result, [1, 2]);
});

Deno.test("data: nested data structures", async () => {
  const result = await hql.run(`
    (let data {"items": [1 2 3], "meta": {"count": 3}})
    (get (get data "meta") "count")
  `);
  assertEquals(result, 3);
});

// ============================================================================
// PART 6: Function Edge Cases
// ============================================================================

Deno.test("fn: anonymous function", async () => {
  const result = await hql.run(`
    ((fn [x] (* x 2)) 21)
  `);
  assertEquals(result, 42);
});

Deno.test("fn: closure captures variable", async () => {
  const result = await hql.run(`
    (let multiplier 10)
    (let f (fn [x] (* x multiplier)))
    (f 5)
  `);
  assertEquals(result, 50);
});

Deno.test("fn: higher-order function", async () => {
  const result = await hql.run(`
    (let apply-twice (fn [f x] (f (f x))))
    (let inc (fn [x] (+ x 1)))
    (apply-twice inc 0)
  `);
  assertEquals(result, 2);
});

// ============================================================================
// PART 7: Sequence Operation Edge Cases
// ============================================================================

Deno.test("seq: map over vector", async () => {
  const result = await hql.run(`
    (into [] (map (fn [x] (* x 2)) [1 2 3]))
  `);
  assertEquals(result, [2, 4, 6]);
});

Deno.test("seq: filter vector", async () => {
  const result = await hql.run(`
    (into [] (filter (fn [x] (> x 2)) [1 2 3 4 5]))
  `);
  assertEquals(result, [3, 4, 5]);
});

Deno.test("seq: reduce vector", async () => {
  const result = await hql.run(`
    (reduce + 0 [1 2 3 4 5])
  `);
  assertEquals(result, 15);
});

Deno.test("seq: take from range", async () => {
  const result = await hql.run(`
    (into [] (take 5 (range 10)))
  `);
  assertEquals(result, [0, 1, 2, 3, 4]);
});

Deno.test("seq: chained operations", async () => {
  const result = await hql.run(`
    (into [] (->> [1 2 3 4 5]
                  (map (fn [x] (* x 2)))
                  (filter (fn [x] (> x 4)))
                  (take 2)))
  `);
  assertEquals(result, [6, 8]);
});

// ============================================================================
// PART 8: Edge Cases That Previously Failed
// ============================================================================

Deno.test("edge: empty vector", async () => {
  const result = await hql.run(`[]`);
  assertEquals(result, []);
});

Deno.test("edge: empty hash-map", async () => {
  const result = await hql.run(`{}`);
  assertEquals(result, {});
});

Deno.test("edge: nil handling", async () => {
  const result = await hql.run(`
    (let x nil)
    (if x "truthy" "falsy")
  `);
  assertEquals(result, "falsy");
});

Deno.test("edge: boolean false handling", async () => {
  const result = await hql.run(`
    (let x false)
    (if x "truthy" "falsy")
  `);
  assertEquals(result, "falsy");
});

Deno.test("edge: zero is falsy (JS semantics)", async () => {
  // HQL uses JavaScript semantics: 0, "", null, undefined, false are falsy
  const result = await hql.run(`
    (if 0 "truthy" "falsy")
  `);
  assertEquals(result, "falsy");
});

Deno.test("edge: empty string is falsy (JS semantics)", async () => {
  // HQL uses JavaScript semantics: 0, "", null, undefined, false are falsy
  const result = await hql.run(`
    (if "" "truthy" "falsy")
  `);
  assertEquals(result, "falsy");
});

Deno.test("edge: non-zero number is truthy", async () => {
  const result = await hql.run(`
    (if 1 "truthy" "falsy")
  `);
  assertEquals(result, "truthy");
});

Deno.test("edge: non-empty string is truthy", async () => {
  const result = await hql.run(`
    (if "hello" "truthy" "falsy")
  `);
  assertEquals(result, "truthy");
});
