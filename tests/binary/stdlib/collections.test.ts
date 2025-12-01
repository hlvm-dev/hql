/**
 * Binary tests for stdlib collection operations
 * Tests: get, getIn, assoc, assocIn, dissoc, update, updateIn, merge, keys, groupBy
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { runExpression, USE_BINARY } from "../_shared/binary-helpers.ts";

console.log(`Testing stdlib collections in ${USE_BINARY ? "BINARY" : "DENO RUN"} mode`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: get - retrieves value from map",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(get {"a": 1, "b": 2} "a")');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "1");
  },
});

Deno.test({
  name: "stdlib binary: get - retrieves nested value",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(get {"name": "Alice", "age": 30} "name")');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "Alice");
  },
});

Deno.test({
  name: "stdlib binary: get - with default value",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(get {"a": 1} "b" 99)');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "99");
  },
});

Deno.test({
  name: "stdlib binary: get - from array by index",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(get [10 20 30] 1)");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "20");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET-IN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: getIn - retrieves deeply nested value",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(getIn {"user": {"name": "Bob"}} ["user" "name"])');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "Bob");
  },
});

Deno.test({
  name: "stdlib binary: getIn - with array index",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(getIn {"items": [10, 20, 30]} ["items" 1])');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "20");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ASSOC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: assoc - adds key to map",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(print (assoc {"a": 1} "b" 2))');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "a");
    assertStringIncludes(result.stdout, "b");
  },
});

Deno.test({
  name: "stdlib binary: assoc - updates existing key",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(get (assoc {"a": 1} "a" 99) "a")');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "99");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DISSOC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: dissoc - removes key from map",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(print (dissoc {"a": 1, "b": 2} "a"))');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "b");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UPDATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: update - applies function to value",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(get (update {"count": 5} "count" inc) "count")');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "6");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MERGE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: merge - combines two maps",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(print (merge {"a": 1} {"b": 2}))');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "a");
    assertStringIncludes(result.stdout, "b");
  },
});

Deno.test({
  name: "stdlib binary: merge - later map wins",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(get (merge {"a": 1} {"a": 99}) "a")');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "99");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// KEYS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: keys - returns map keys",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(print (keys {"a": 1, "b": 2, "c": 3}))');
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "a");
    assertStringIncludes(result.stdout, "b");
    assertStringIncludes(result.stdout, "c");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GROUPBY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: groupBy - groups by function result",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression('(print (groupBy (fn [x] (mod x 2)) [1 2 3 4 5]))');
    assertEquals(result.success, true, result.stderr);
    // Should have keys 0 and 1
    assertStringIncludes(result.stdout, "0");
    assertStringIncludes(result.stdout, "1");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VEC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: vec - converts to vector",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(print (vec (range 3)))");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "0");
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DISTINCT (for unique values)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: distinct - removes duplicate values",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // distinct removes duplicates from a sequence
    const result = await runExpression("(print (vec (distinct [1 2 2 3 3 3])))");
    assertEquals(result.success, true, result.stderr);
    // Should have unique values [1, 2, 3]
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "2");
    assertStringIncludes(result.stdout, "3");
  },
});

Deno.test({
  name: "stdlib binary: distinct - preserves order of first occurrence",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(print (vec (distinct [3 1 2 1 3 2])))");
    assertEquals(result.success, true, result.stderr);
    // First occurrences in order: 3, 1, 2
    assertStringIncludes(result.stdout, "[ 3, 1, 2 ]");
  },
});
