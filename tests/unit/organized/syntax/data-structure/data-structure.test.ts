// test/syntax-data-structure.test.ts
// Comprehensive tests for vectors, maps, sets, and get operations
// Based on hql_datastructure.md spec

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../../../helpers.ts";

// ============================================================================
// SECTION 1: VECTORS (Arrays)
// ============================================================================

Deno.test("DataStructure: create empty vector []", async () => {
  const code = `
(var v [])
v
`;
  const result = await run(code);
  assertEquals(result, []);
});

Deno.test("DataStructure: create vector with elements [1, 2, 3]", async () => {
  const code = `
(var v [1, 2, 3])
v
`;
  const result = await run(code);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("DataStructure: vector with mixed types", async () => {
  const code = `
(var v [1, "hello", true, null])
v
`;
  const result = await run(code);
  assertEquals(result, [1, "hello", true, null]);
});

Deno.test("DataStructure: nested vectors [[1, 2], [3, 4]]", async () => {
  const code = `
(var v [[1, 2], [3, 4]])
v
`;
  const result = await run(code);
  assertEquals(result, [[1, 2], [3, 4]]);
});

Deno.test("DataStructure: access vector element by index", async () => {
  const code = `
(var v ["apple", "banana", "cherry"])
(get v 1)
`;
  const result = await run(code);
  assertEquals(result, "banana");
});

Deno.test("DataStructure: vector length property", async () => {
  const code = `
(var v [1, 2, 3, 4, 5])
v.length
`;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("DataStructure: push to mutable vector", async () => {
  const code = `
(var v [1, 2, 3])
(v.push 4)
v
`;
  const result = await run(code);
  assertEquals(result, [1, 2, 3, 4]);
});

// ============================================================================
// SECTION 2: HASH MAPS (Objects)
// ============================================================================

Deno.test("DataStructure: create empty map {}", async () => {
  const code = `
(var m {})
m
`;
  const result = await run(code);
  assertEquals(result, {});
});

Deno.test("DataStructure: create map with key-value pairs", async () => {
  const code = `
(var m {"name": "Alice", "age": 30})
m
`;
  const result = await run(code);
  assertEquals(result, { name: "Alice", age: 30 });
});

Deno.test("DataStructure: access map value by key", async () => {
  const code = `
(var m {"name": "Alice", "age": 30})
(get m "name")
`;
  const result = await run(code);
  assertEquals(result, "Alice");
});

Deno.test("DataStructure: nested maps", async () => {
  const code = `
(var m {"user": {"name": "Bob", "id": 123}})
(get (get m "user") "name")
`;
  const result = await run(code);
  assertEquals(result, "Bob");
});

Deno.test("DataStructure: add property to mutable map", async () => {
  const code = `
(var m {"count": 10})
(= m.newProp "added")
(get m "newProp")
`;
  const result = await run(code);
  assertEquals(result, "added");
});

Deno.test("DataStructure: map with numeric keys", async () => {
  const code = `
(var m {"0": "zero", "1": "one"})
(get m "0")
`;
  const result = await run(code);
  assertEquals(result, "zero");
});

// ============================================================================
// SECTION 3: HASH SETS
// ============================================================================

Deno.test("DataStructure: create empty set #[]", async () => {
  const code = `
(var s #[])
s
`;
  const result = await run(code);
  // Sets in JS are objects, check if it's a Set
  assertEquals(result instanceof Set, true);
  assertEquals(result.size, 0);
});

Deno.test("DataStructure: create set with elements #[1, 2, 3]", async () => {
  const code = `
(var s #[1, 2, 3])
s
`;
  const result = await run(code);
  assertEquals(result instanceof Set, true);
  assertEquals(result.size, 3);
  assertEquals(result.has(1), true);
  assertEquals(result.has(2), true);
  assertEquals(result.has(3), true);
});

Deno.test("DataStructure: set automatically deduplicates values", async () => {
  const code = `
(var s #[1, 2, 2, 3, 3, 3])
s.size
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("DataStructure: check set membership with has", async () => {
  const code = `
(var s #["red", "green", "blue"])
(s.has "green")
`;
  const result = await run(code);
  assertEquals(result, true);
});

// ============================================================================
// SECTION 4: GET OPERATIONS
// ============================================================================

Deno.test("DataStructure: get from vector by numeric index", async () => {
  const code = `
(var v [10, 20, 30, 40])
(get v 2)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("DataStructure: get from map by string key", async () => {
  const code = `
(var m {"host": "localhost", "port": 8080})
(get m "port")
`;
  const result = await run(code);
  assertEquals(result, 8080);
});

Deno.test("DataStructure: get with default value (non-existent key)", async () => {
  const code = `
(var m {"name": "Alice"})
(if (get m "age")
  (get m "age")
  "default-age")
`;
  const result = await run(code);
  assertEquals(result, "default-age");
});

Deno.test("DataStructure: chained get operations", async () => {
  const code = `
(var data {"users": [{"name": "Alice"}, {"name": "Bob"}]})
(get (get (get data "users") 1) "name")
`;
  const result = await run(code);
  assertEquals(result, "Bob");
});

// ============================================================================
// SECTION 5: COLLECTION OPERATIONS
// ============================================================================

Deno.test("DataStructure: map over vector", async () => {
  const code = `
(var numbers [1, 2, 3, 4, 5])
(numbers.map (fn [n] (* n 2)))
`;
  const result = await run(code);
  assertEquals(result, [2, 4, 6, 8, 10]);
});

Deno.test("DataStructure: filter vector", async () => {
  const code = `
(var numbers [1, 2, 3, 4, 5, 6])
(numbers.filter (fn [n] (> n 3)))
`;
  const result = await run(code);
  assertEquals(result, [4, 5, 6]);
});

Deno.test("DataStructure: reduce vector to sum", async () => {
  const code = `
(var numbers [1, 2, 3, 4, 5])
(numbers.reduce (fn [acc n] (+ acc n)) 0)
`;
  const result = await run(code);
  assertEquals(result, 15);
});
