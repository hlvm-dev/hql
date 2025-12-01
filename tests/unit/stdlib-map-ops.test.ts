/**
 * Map/Object Operations Tests - REWRITTEN
 * Now uses hql.run() to test actual language integration
 */

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

// =============================================================================
// get(map, key, notFound)
// =============================================================================

Deno.test("get: object with existing key", async () => {
  const result = await run(`(get {"a": 1, "b": 2} "a")`);
  assertEquals(result, 1);
});

Deno.test("get: object with missing key returns notFound", async () => {
  const result = await run(`(get {"a": 1} "b" "default")`);
  assertEquals(result, "default");
});

Deno.test("get: object with missing key returns undefined by default", async () => {
  const result = await run(`(get {"a": 1} "b")`);
  assertEquals(result, undefined);
});

Deno.test("get: nil map returns notFound", async () => {
  const result = await run(`(get nil "x" "default")`);
  assertEquals(result, "default");
});

// =============================================================================
// getIn(map, path, notFound)
// =============================================================================

Deno.test("getIn: nested object access", async () => {
  const result = await run(`(getIn {"user": {"name": "Alice", "age": 30}} ["user" "name"])`);
  assertEquals(result, "Alice");
});

Deno.test("getIn: deep nesting", async () => {
  const result = await run(`(getIn {"a": {"b": {"c": {"d": "deep"}}}} ["a" "b" "c" "d"])`);
  assertEquals(result, "deep");
});

Deno.test("getIn: missing path returns notFound", async () => {
  const result = await run(`(getIn {"user": {"name": "Alice"}} ["user" "age"] 25)`);
  assertEquals(result, 25);
});

Deno.test("getIn: array as intermediate collection", async () => {
  const result = await run(`(getIn {"items": ["a" "b" "c"]} ["items" 1])`);
  assertEquals(result, "b");
});

// =============================================================================
// assoc(map, key, value)
// =============================================================================

Deno.test("assoc: object - add new key", async () => {
  const result = await run(`(assoc {"a": 1} "b" 2)`);
  assertEquals(result, { a: 1, b: 2 });
});

Deno.test("assoc: object - update existing key", async () => {
  const result = await run(`(assoc {"a": 1, "b": 2} "a" 10)`);
  assertEquals(result, { a: 10, b: 2 });
});

Deno.test("assoc: nil map creates new object", async () => {
  const result = await run(`(assoc nil "a" 1)`);
  assertEquals(result, { a: 1 });
});

Deno.test("assoc: numeric key with object", async () => {
  // In HQL runtime, assoc on object with numeric key treats it as object property
  const result = await run(`(assoc {} 0 "zero")`);
  assertEquals(result, { "0": "zero" });
});

// =============================================================================
// assocIn(map, path, value)
// =============================================================================

Deno.test("assocIn: nested object - update existing path", async () => {
  const result = await run(`(assocIn {"user": {"name": "Alice", "age": 30}} ["user" "age"] 31)`);
  assertEquals(result, { user: { name: "Alice", age: 31 } });
});

Deno.test("assocIn: create new nested path", async () => {
  const result = await run(`(assocIn {} ["user" "name"] "Bob")`);
  assertEquals(result, { user: { name: "Bob" } });
});

Deno.test("assocIn: creates array when key is numeric", async () => {
  const result = await run(`(assocIn {} ["items" 0] "first")`);
  // Note: HQL runtime helper logic creates object vs array based on key type
  // If we pass number 0 in HQL, it should result in array if the parent determines it
  // assocIn implementation checks if key is number -> creates array
  assertEquals(result, { items: ["first"] });
});

// =============================================================================
// dissoc(map, ...keys)
// =============================================================================

Deno.test("dissoc: remove single key from object", async () => {
  const result = await run(`(dissoc {"a": 1, "b": 2, "c": 3} "b")`);
  assertEquals(result, { a: 1, c: 3 });
});

Deno.test("dissoc: remove multiple keys from object", async () => {
  const result = await run(`(dissoc {"a": 1, "b": 2, "c": 3, "d": 4} "b" "d")`);
  assertEquals(result, { a: 1, c: 3 });
});

Deno.test("dissoc: nil map returns empty object", async () => {
  const result = await run(`(dissoc nil "a")`);
  assertEquals(result, {});
});

// =============================================================================
// update(map, key, fn)
// =============================================================================

Deno.test("update: transform existing value", async () => {
  const result = await run(`(update {"count": 5} "count" inc)`);
  assertEquals(result, { count: 6 });
});

Deno.test("update: function receives undefined for missing key", async () => {
  // (fn [x] (+ (or x 0) 10))
  const result = await run(`(update {"a": 1} "b" (fn [x] (+ (if (isNil x) 0 x) 10)))`);
  assertEquals(result, { a: 1, b: 10 });
});

// =============================================================================
// updateIn(map, path, fn)
// =============================================================================

Deno.test("updateIn: nested transformation", async () => {
  const result = await run(`(updateIn {"user": {"age": 30}} ["user" "age"] inc)`);
  assertEquals(result, { user: { age: 31 } });
});

Deno.test("updateIn: creates path if missing", async () => {
  // Same fix as update
  const result = await run(`(updateIn {} ["user" "age"] (fn [x] (+ (if (isNil x) 0 x) 1)))`);
  assertEquals(result, { user: { age: 1 } });
});

// =============================================================================
// merge(...maps)
// =============================================================================

Deno.test("merge: two objects", async () => {
  const result = await run(`(merge {"a": 1} {"b": 2})`);
  assertEquals(result, { a: 1, b: 2 });
});

Deno.test("merge: later values win", async () => {
  const result = await run(`(merge {"a": 1, "b": 2} {"b": 3, "c": 4})`);
  assertEquals(result, { a: 1, b: 3, c: 4 });
});

Deno.test("merge: nil maps are ignored", async () => {
  const result = await run(`(merge {"a": 1} nil {"b": 2})`);
  assertEquals(result, { a: 1, b: 2 });
});
