/**
 * Map/Object Operations Tests
 * Tests for: get, getIn, assoc, assocIn, dissoc, update, updateIn, merge
 */

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  assoc,
  assocIn,
  dissoc,
  get,
  getIn,
  merge,
  update,
  updateIn,
} from "../../src/lib/stdlib/js/index.js";

// =============================================================================
// get(map, key, notFound) - 10 tests
// =============================================================================

Deno.test("get: object with existing key", () => {
  const result = get({ a: 1, b: 2 }, "a");
  assertEquals(result, 1);
});

Deno.test("get: object with missing key returns notFound", () => {
  const result = get({ a: 1 }, "b", "default");
  assertEquals(result, "default");
});

Deno.test("get: object with missing key returns undefined by default", () => {
  const result = get({ a: 1 }, "b");
  assertEquals(result, undefined);
});

Deno.test("get: Map with existing key", () => {
  const m = new Map([["a", 1], ["b", 2]]);
  const result = get(m, "a");
  assertEquals(result, 1);
});

Deno.test("get: Map with missing key returns notFound", () => {
  const m = new Map([["a", 1]]);
  const result = get(m, "b", "default");
  assertEquals(result, "default");
});

Deno.test("get: nil map returns notFound", () => {
  assertEquals(get(null, "x"), undefined);
  assertEquals(get(null, "x", "default"), "default");
  assertEquals(get(undefined, "x", "default"), "default");
});

Deno.test("get: handles falsy values", () => {
  assertEquals(get({ a: 0 }, "a"), 0);
  assertEquals(get({ a: false }, "a"), false);
  assertEquals(get({ a: "" }, "a"), "");
  assertEquals(get({ a: null }, "a"), null);
});

Deno.test("get: numeric keys with object", () => {
  const obj = { 0: "zero", 1: "one" };
  assertEquals(get(obj, 0), "zero");
  assertEquals(get(obj, "0"), "zero");
});

Deno.test("get: Map preserves key types", () => {
  const m = new Map<number | string, string>([[1, "numeric"], ["1", "string"]]);
  assertEquals(get(m, 1), "numeric");
  assertEquals(get(m, "1"), "string");
});

Deno.test("get: Map with object key", () => {
  const key = { id: 1 };
  const m = new Map([[key, "value"]]);
  assertEquals(get(m, key), "value");
});

// =============================================================================
// getIn(map, path, notFound) - 12 tests
// =============================================================================

Deno.test("getIn: nested object access", () => {
  const obj = { user: { name: "Alice", age: 30 } };
  assertEquals(getIn(obj, ["user", "name"]), "Alice");
  assertEquals(getIn(obj, ["user", "age"]), 30);
});

Deno.test("getIn: deep nesting", () => {
  const obj = { a: { b: { c: { d: "deep" } } } };
  assertEquals(getIn(obj, ["a", "b", "c", "d"]), "deep");
});

Deno.test("getIn: missing path returns notFound", () => {
  const obj = { user: { name: "Alice" } };
  assertEquals(getIn(obj, ["user", "age"], 25), 25);
  assertEquals(getIn(obj, ["admin", "name"], "N/A"), "N/A");
});

Deno.test("getIn: empty path returns the map itself", () => {
  const obj = { a: 1 };
  assertEquals(getIn(obj, []), obj);
});

Deno.test("getIn: single key path (same as get)", () => {
  const obj = { a: 1, b: 2 };
  assertEquals(getIn(obj, ["a"]), 1);
});

Deno.test("getIn: short-circuits on null in path", () => {
  const obj = { user: null };
  assertEquals(getIn(obj, ["user", "name"], "N/A"), "N/A");
});

Deno.test("getIn: nil root returns notFound", () => {
  assertEquals(getIn(null, ["a", "b"], "default"), "default");
  assertEquals(getIn(undefined, ["a"], "default"), "default");
});

Deno.test("getIn: array as intermediate collection", () => {
  const obj = { items: ["a", "b", "c"] };
  assertEquals(getIn(obj, ["items", 1]), "b");
});

Deno.test("getIn: mixed Map and Object", () => {
  const m = new Map([["user", { name: "Bob" }]]);
  assertEquals(getIn(m, ["user", "name"]), "Bob");
});

Deno.test("getIn: nested arrays", () => {
  const data = { matrix: [[1, 2], [3, 4]] };
  assertEquals(getIn(data, ["matrix", 0, 1]), 2);
  assertEquals(getIn(data, ["matrix", 1, 0]), 3);
});

Deno.test("getIn: handles falsy intermediate values", () => {
  const obj = { a: { b: 0 } };
  assertEquals(getIn(obj, ["a", "b"]), 0);
});

Deno.test("getIn: undefined vs notFound", () => {
  const obj = { a: { b: undefined } };
  assertEquals(getIn(obj, ["a", "b"]), undefined);
  assertEquals(getIn(obj, ["a", "c"], "missing"), "missing");
});

// =============================================================================
// assoc(map, key, value) - 12 tests
// =============================================================================

Deno.test("assoc: object - add new key", () => {
  const original = { a: 1 };
  const result = assoc(original, "b", 2);

  assertEquals(result, { a: 1, b: 2 });
  assertEquals(original, { a: 1 }); // Original unchanged
  assert(result !== original); // Different reference
});

Deno.test("assoc: object - update existing key", () => {
  const original = { a: 1, b: 2 };
  const result = assoc(original, "a", 10);

  assertEquals(result, { a: 10, b: 2 });
  assertEquals(original, { a: 1, b: 2 });
});

Deno.test("assoc: Map - add new key", () => {
  const original = new Map([["a", 1]]);
  const result = assoc(original, "b", 2);

  assert(result instanceof Map);
  assertEquals(result.get("a"), 1);
  assertEquals(result.get("b"), 2);
  assertEquals(original.get("b"), undefined); // Original unchanged
  assert(result !== original);
});

Deno.test("assoc: Map - update existing key", () => {
  const original = new Map([["a", 1], ["b", 2]]);
  const result = assoc(original, "a", 10);

  assertEquals(result.get("a"), 10);
  assertEquals(original.get("a"), 1); // Original unchanged
});

Deno.test("assoc: nil map creates new object", () => {
  assertEquals(assoc(null, "a", 1), { a: 1 });
  assertEquals(assoc(undefined, "a", 1), { a: 1 });
});

Deno.test("assoc: numeric key with object", () => {
  const result = assoc({}, 0, "zero");
  assertEquals(result[0], "zero");
});

Deno.test("assoc: object key preserved as string", () => {
  const result = assoc({}, "key", "value");
  assertEquals(result.key, "value");
});

Deno.test("assoc: Map with object as key", () => {
  const key = { id: 1 };
  const m = new Map();
  const result = assoc(m, key, "value");

  assertEquals(result.get(key), "value");
});

Deno.test("assoc: empty object", () => {
  const result = assoc({}, "x", 1);
  assertEquals(result, { x: 1 });
});

Deno.test("assoc: preserves other properties", () => {
  const original = { a: 1, b: 2, c: 3 };
  const result = assoc(original, "b", 20);

  assertEquals(result, { a: 1, b: 20, c: 3 });
});

Deno.test("assoc: value can be any type", () => {
  const fn = () => 42;
  const result1 = assoc({}, "fn", fn);
  assertEquals(typeof result1.fn, "function");
  assertEquals(result1.fn(), 42);

  assertEquals(assoc({}, "obj", { nested: true }).obj, { nested: true });
  assertEquals(assoc({}, "arr", [1, 2, 3]).arr, [1, 2, 3]);
});

Deno.test("assoc: handles undefined and null values", () => {
  assertEquals(assoc({}, "x", undefined), { x: undefined });
  assertEquals(assoc({}, "x", null), { x: null });
});

// =============================================================================
// assocIn(map, path, value) - 15 tests
// =============================================================================

Deno.test("assocIn: nested object - update existing path", () => {
  const original = { user: { name: "Alice", age: 30 } };
  const result = assocIn(original, ["user", "age"], 31);

  assertEquals(result, { user: { name: "Alice", age: 31 } });
  assertEquals(original.user.age, 30); // Original unchanged
});

Deno.test("assocIn: create new nested path", () => {
  const result = assocIn({}, ["user", "name"], "Bob");
  assertEquals(result, { user: { name: "Bob" } });
});

Deno.test("assocIn: deep nesting", () => {
  const result = assocIn({}, ["a", "b", "c", "d"], "deep");
  assertEquals(result, { a: { b: { c: { d: "deep" } } } });
});

Deno.test("assocIn: single key path (same as assoc)", () => {
  const original = { a: 1 };
  const result = assocIn(original, ["b"], 2);

  assertEquals(result, { a: 1, b: 2 });
  assertEquals(original, { a: 1 });
});

Deno.test("assocIn: empty path returns value itself", () => {
  const result = assocIn({ a: 1 }, [], { b: 2 });
  assertEquals(result, { b: 2 });
});

Deno.test("assocIn: preserves sibling properties", () => {
  const original = {
    user: { name: "Alice", age: 30 },
    admin: { role: "superuser" },
  };
  const result = assocIn(original, ["user", "age"], 31);

  assertEquals(result.user, { name: "Alice", age: 31 });
  assertEquals(result.admin, { role: "superuser" });
});

Deno.test("assocIn: creates array when key is numeric", () => {
  const result = assocIn({}, ["items", 0], "first");
  assertEquals(result, { items: ["first"] });
});

Deno.test("assocIn: mixed object and array creation", () => {
  const result = assocIn({}, ["users", 0, "name"], "Alice");
  assertEquals(result, { users: [{ name: "Alice" }] });
});

Deno.test("assocIn: update in array", () => {
  const original = { items: ["a", "b", "c"] };
  const result = assocIn(original, ["items", 1], "B");

  assertEquals(result.items, ["a", "B", "c"]);
  assertEquals(original.items, ["a", "b", "c"]); // Original unchanged
});

Deno.test("assocIn: nil root creates new object", () => {
  const result = assocIn(null, ["user", "name"], "Alice");
  assertEquals(result, { user: { name: "Alice" } });
});

Deno.test("assocIn: partial existing path", () => {
  const original = { user: { name: "Alice" } };
  const result = assocIn(original, ["user", "age"], 30);

  assertEquals(result, { user: { name: "Alice", age: 30 } });
});

Deno.test("assocIn: with Map in path", () => {
  const original = { data: new Map([["key", "value"]]) };
  const result = assocIn(original, ["data", "key"], "newValue");

  assertEquals(result.data.get("key"), "newValue");
});

Deno.test("assocIn: deeply nested array indices", () => {
  const result = assocIn({}, ["matrix", 0, 1], "value");
  // Sparse array creation
  assert(Array.isArray(result.matrix));
  assert(Array.isArray(result.matrix[0]));
  assertEquals(result.matrix[0][1], "value");
});

Deno.test("assocIn: overwrites non-object intermediate values", () => {
  const original = { a: "string" };
  const result = assocIn(original, ["a", "b"], "value");

  // When existing value is not an object, assocIn treats it as an object
  // In JavaScript, strings are iterable but assocIn needs to replace them
  assertEquals(result.a.b, "value");
  assert(typeof result.a === "object");
});

Deno.test("assocIn: immutability at all levels", () => {
  const original = { a: { b: { c: 1 } } };
  const result = assocIn(original, ["a", "b", "c"], 2);

  assertEquals(result.a.b.c, 2);
  assertEquals(original.a.b.c, 1);
  assert(result !== original);
  assert(result.a !== original.a);
  assert(result.a.b !== original.a.b);
});

// =============================================================================
// dissoc(map, ...keys) - 10 tests
// =============================================================================

Deno.test("dissoc: remove single key from object", () => {
  const original = { a: 1, b: 2, c: 3 };
  const result = dissoc(original, "b");

  assertEquals(result, { a: 1, c: 3 });
  assertEquals(original, { a: 1, b: 2, c: 3 }); // Original unchanged
  assert(result !== original);
});

Deno.test("dissoc: remove multiple keys from object", () => {
  const original = { a: 1, b: 2, c: 3, d: 4 };
  const result = dissoc(original, "b", "d");

  assertEquals(result, { a: 1, c: 3 });
});

Deno.test("dissoc: non-existent key doesn't affect result", () => {
  const original = { a: 1, b: 2 };
  const result = dissoc(original, "c");

  assertEquals(result, { a: 1, b: 2 });
  assert(result !== original); // Still creates new object
});

Deno.test("dissoc: Map - remove single key", () => {
  const original = new Map([["a", 1], ["b", 2], ["c", 3]]);
  const result = dissoc(original, "b");

  assert(result instanceof Map);
  assertEquals(result.get("a"), 1);
  assertEquals(result.get("b"), undefined);
  assertEquals(result.get("c"), 3);
  assertEquals(original.get("b"), 2); // Original unchanged
});

Deno.test("dissoc: Map - remove multiple keys", () => {
  const original = new Map([["a", 1], ["b", 2], ["c", 3]]);
  const result = dissoc(original, "a", "c");

  assertEquals(result.size, 1);
  assertEquals(result.get("b"), 2);
});

Deno.test("dissoc: nil map returns empty object", () => {
  assertEquals(dissoc(null, "a"), {});
  assertEquals(dissoc(undefined, "a", "b"), {});
});

Deno.test("dissoc: remove all keys creates empty object", () => {
  const original = { a: 1, b: 2 };
  const result = dissoc(original, "a", "b");

  assertEquals(result, {});
});

Deno.test("dissoc: no keys provided still creates new object", () => {
  const original = { a: 1 };
  const result = dissoc(original);

  assertEquals(result, { a: 1 });
  assert(result !== original);
});

Deno.test("dissoc: numeric keys", () => {
  const original = { 0: "zero", 1: "one", 2: "two" };
  const result = dissoc(original, 1);

  assertEquals(result[0], "zero");
  assertEquals(result[1], undefined);
  assertEquals(result[2], "two");
});

Deno.test("dissoc: preserves other properties", () => {
  const original = { a: 1, b: 2, c: 3, d: 4, e: 5 };
  const result = dissoc(original, "b", "e");

  assertEquals(result, { a: 1, c: 3, d: 4 });
});

// =============================================================================
// update(map, key, fn) - 10 tests
// =============================================================================

Deno.test("update: transform existing value", () => {
  const original = { count: 5 };
  const result = update(original, "count", (x: number) => x + 1);

  assertEquals(result, { count: 6 });
  assertEquals(original, { count: 5 });
});

Deno.test("update: function receives undefined for missing key", () => {
  const original = { a: 1 };
  const result = update(
    original,
    "b",
    (x: number | undefined) => (x || 0) + 10,
  );

  assertEquals(result, { a: 1, b: 10 });
});

Deno.test("update: Map - transform value", () => {
  const original = new Map([["count", 5]]);
  const result = update(original, "count", (x: number) => x * 2);

  assertEquals(result.get("count"), 10);
  assertEquals(original.get("count"), 5);
});

Deno.test("update: string transformation", () => {
  const original = { name: "alice" };
  const result = update(original, "name", (s: string) => s.toUpperCase());

  assertEquals(result, { name: "ALICE" });
});

Deno.test("update: array transformation", () => {
  const original = { items: [1, 2, 3] };
  const result = update(original, "items", (arr: number[]) => [...arr, 4]);

  assertEquals(result.items, [1, 2, 3, 4]);
  assertEquals(original.items, [1, 2, 3]);
});

Deno.test("update: nil map creates new with transformed undefined", () => {
  const result = update(null, "x", (val: number | undefined) => (val || 0) + 1);
  assertEquals(result, { x: 1 });
});

Deno.test("update: function can return any type", () => {
  const original = { value: 10 };
  const result = update(original, "value", (x: number) => `count: ${x}`);

  assertEquals(result, { value: "count: 10" });
});

Deno.test("update: preserves other keys", () => {
  const original = { a: 1, b: 2, c: 3 };
  const result = update(original, "b", (x: number) => x * 10);

  assertEquals(result, { a: 1, b: 20, c: 3 });
});

Deno.test("update: with boolean toggle", () => {
  const original = { enabled: true };
  const result = update(original, "enabled", (x: boolean) => !x);

  assertEquals(result, { enabled: false });
});

Deno.test("update: nested object transformation", () => {
  const original = { user: { name: "Alice", age: 30 } };
  const result = update(
    original,
    "user",
    (user: unknown) => {
      const current = user as { name: string; age: number };
      return { ...current, age: current.age + 1 };
    },
  );

  assertEquals(result, { user: { name: "Alice", age: 31 } });
  assertEquals(original.user.age, 30);
});

// =============================================================================
// updateIn(map, path, fn) - 12 tests
// =============================================================================

Deno.test("updateIn: nested transformation", () => {
  const original = { user: { age: 30 } };
  const result = updateIn(original, ["user", "age"], (x: number) => x + 1);

  assertEquals(result, { user: { age: 31 } });
  assertEquals(original.user.age, 30);
});

Deno.test("updateIn: deep nesting", () => {
  const original = { a: { b: { c: { value: 10 } } } };
  const result = updateIn(
    original,
    ["a", "b", "c", "value"],
    (x: number) => x * 2,
  );

  assertEquals(result.a.b.c.value, 20);
  assertEquals(original.a.b.c.value, 10);
});

Deno.test("updateIn: creates path if missing", () => {
  const result = updateIn(
    {},
    ["user", "age"],
    (x: number | undefined) => (x || 0) + 1,
  );
  assertEquals(result, { user: { age: 1 } });
});

Deno.test("updateIn: single key path (same as update)", () => {
  const original = { count: 5 };
  const result = updateIn(original, ["count"], (x: number) => x + 1);

  assertEquals(result, { count: 6 });
});

Deno.test("updateIn: array index", () => {
  const original = { items: [10, 20, 30] };
  const result = updateIn(original, ["items", 1], (x: number) => x * 2);

  assertEquals(result.items, [10, 40, 30]);
  assertEquals(original.items, [10, 20, 30]);
});

Deno.test("updateIn: mixed object and array path", () => {
  const original = { users: [{ name: "Alice", age: 30 }] };
  const result = updateIn(original, ["users", 0, "age"], (x: number) => x + 1);

  assertEquals(result.users[0].age, 31);
  assertEquals(original.users[0].age, 30);
});

Deno.test("updateIn: nil root creates path", () => {
  const result = updateIn(
    null,
    ["user", "count"],
    (x: number | undefined) => (x || 0) + 1,
  );
  assertEquals(result, { user: { count: 1 } });
});

Deno.test("updateIn: preserves siblings at all levels", () => {
  const original = {
    user: { name: "Alice", age: 30 },
    admin: { role: "super" },
  };
  const result = updateIn(original, ["user", "age"], (x: number) => x + 1);

  assertEquals(result.user.name, "Alice");
  assertEquals(result.admin, { role: "super" });
});

Deno.test("updateIn: empty path applies fn to whole map", () => {
  const original = { a: 1, b: 2 };
  const result = updateIn(
    original,
    [],
    (obj: unknown) => {
      const current = obj as { a: number; b: number };
      return { ...current, c: 3 };
    },
  );

  assertEquals(result, { a: 1, b: 2, c: 3 });
});

Deno.test("updateIn: function receives undefined for missing nested path", () => {
  const original = { user: { name: "Alice" } };
  const result = updateIn(
    original,
    ["user", "age"],
    (x: number | undefined) => (x || 25) + 5,
  );

  assertEquals(result.user.age, 30);
});

Deno.test("updateIn: immutability at all levels", () => {
  const original = { a: { b: { c: 1 } } };
  const result = updateIn(original, ["a", "b", "c"], (x: number) => x + 1);

  assert(result !== original);
  assert(result.a !== original.a);
  assert(result.a.b !== original.a.b);
});

Deno.test("updateIn: with Map in path", () => {
  const original = { data: new Map([["key", 10]]) };
  const result = updateIn(original, ["data", "key"], (x: number) => x * 2);

  assertEquals(result.data.get("key"), 20);
  assertEquals(original.data.get("key"), 10);
});

// =============================================================================
// merge(...maps) - 12 tests
// =============================================================================

Deno.test("merge: two objects", () => {
  const result = merge({ a: 1 }, { b: 2 });
  assertEquals(result, { a: 1, b: 2 });
});

Deno.test("merge: later values win", () => {
  const result = merge({ a: 1, b: 2 }, { b: 3, c: 4 });
  assertEquals(result, { a: 1, b: 3, c: 4 });
});

Deno.test("merge: multiple objects", () => {
  const result = merge({ a: 1 }, { b: 2 }, { c: 3 });
  assertEquals(result, { a: 1, b: 2, c: 3 });
});

Deno.test("merge: originals unchanged", () => {
  const obj1 = { a: 1 };
  const obj2 = { b: 2 };
  const result = merge(obj1, obj2);

  assertEquals(result, { a: 1, b: 2 });
  assertEquals(obj1, { a: 1 });
  assertEquals(obj2, { b: 2 });
  assert(result !== obj1);
  assert(result !== obj2);
});

Deno.test("merge: Maps", () => {
  const m1 = new Map([["a", 1]]);
  const m2 = new Map([["b", 2]]);
  const result = merge(m1, m2);

  assert(result instanceof Map);
  assertEquals(result.get("a"), 1);
  assertEquals(result.get("b"), 2);
});

Deno.test("merge: nil maps are ignored", () => {
  const result = merge({ a: 1 }, null, { b: 2 }, undefined, { c: 3 });
  assertEquals(result, { a: 1, b: 2, c: 3 });
});

Deno.test("merge: all nil returns empty object", () => {
  assertEquals(merge(null, undefined), {});
});

Deno.test("merge: no arguments returns empty object", () => {
  assertEquals(merge(), {});
});

Deno.test("merge: single object returns copy", () => {
  const original = { a: 1, b: 2 };
  const result = merge(original);

  assertEquals(result, { a: 1, b: 2 });
  assert(result !== original);
});

Deno.test("merge: overwrites with undefined", () => {
  const result = merge({ a: 1, b: 2 }, { b: undefined });
  assertEquals(result.b, undefined);
});

Deno.test("merge: nested objects (shallow merge)", () => {
  const result = merge(
    { user: { name: "Alice", age: 30 } },
    { user: { age: 31 } },
  );

  // Shallow merge - second 'user' object completely replaces first
  assertEquals(result, { user: { age: 31 } });
});

Deno.test("merge: preserves all keys from all sources", () => {
  const result = merge(
    { a: 1, b: 2 },
    { c: 3, d: 4 },
    { e: 5 },
  );

  assertEquals(result, { a: 1, b: 2, c: 3, d: 4, e: 5 });
});
