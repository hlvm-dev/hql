/**
 * Type Conversion Tests
 * Tests for: vec, set
 */

import { assert, assertEquals } from "jsr:@std/assert@1";
import { set, vec } from "../../src/hql/lib/stdlib/js/index.js";

// =============================================================================
// vec(coll) - 10 tests
// =============================================================================

Deno.test("vec: from array - creates new copy", () => {
  const original = [1, 2, 3];
  const result = vec(original);

  assertEquals(result, [1, 2, 3]);
  assert(result !== original); // MUST be different reference!
});

Deno.test("vec: from Set", () => {
  const s = new Set([1, 2, 3]);
  const result = vec(s);

  assertEquals(result, [1, 2, 3]);
  assert(Array.isArray(result));
});

Deno.test("vec: from Map entries", () => {
  const m = new Map([["a", 1], ["b", 2]]);
  const result = vec(m);

  assertEquals(result, [["a", 1], ["b", 2]]);
});

Deno.test("vec: from string", () => {
  const result = vec("hello");
  assertEquals(result, ["h", "e", "l", "l", "o"]);
});

Deno.test("vec: from LazySeq", async () => {
  const { LazySeq } = await import(
    "../../src/hql/lib/stdlib/js/internal/seq-protocol.js"
  );
  // New LazySeq accepts generator functions (backwards compat)
  const lazy = new LazySeq(function* () {
    yield 1;
    yield 2;
    yield 3;
  });

  const result = vec(lazy);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("vec: nil input returns empty array", () => {
  assertEquals(vec(null), []);
  assertEquals(vec(undefined), []);
});

Deno.test("vec: empty array returns new empty array", () => {
  const original: number[] = [];
  const result = vec(original);

  assertEquals(result, []);
  assert(result !== original); // Still different reference!
});

Deno.test("vec: preserves order", () => {
  const arr = [3, 1, 4, 1, 5, 9];
  const result = vec(arr);

  assertEquals(result, [3, 1, 4, 1, 5, 9]);
});

Deno.test("vec: from iterable (custom)", () => {
  const iterable = {
    *[Symbol.iterator]() {
      yield "a";
      yield "b";
      yield "c";
    },
  };

  const result = vec(iterable);
  assertEquals(result, ["a", "b", "c"]);
});

Deno.test("vec: mutation of result doesn't affect original", () => {
  const original = [1, 2, 3];
  const result = vec(original);

  result.push(4);
  assertEquals(result, [1, 2, 3, 4]);
  assertEquals(original, [1, 2, 3]); // Original unchanged
});

// =============================================================================
// set(coll) - 10 tests
// =============================================================================

Deno.test("set: from array", () => {
  const result = set([1, 2, 3]);

  assert(result instanceof Set);
  assertEquals(result.size, 3);
  assert(result.has(1));
  assert(result.has(2));
  assert(result.has(3));
});

Deno.test("set: from Set - creates new copy", () => {
  const original = new Set([1, 2, 3]);
  const result = set(original);

  assertEquals(result.size, 3);
  assert(result !== original); // MUST be different reference!
});

Deno.test("set: removes duplicates", () => {
  const result = set([1, 2, 2, 3, 3, 3]);

  assertEquals(result.size, 3);
  assert(result.has(1));
  assert(result.has(2));
  assert(result.has(3));
});

Deno.test("set: from string", () => {
  const result = set("hello");

  assertEquals(result.size, 4); // 'h', 'e', 'l', 'o' (duplicates removed)
  assert(result.has("h"));
  assert(result.has("e"));
  assert(result.has("l"));
  assert(result.has("o"));
});

Deno.test("set: from Map keys", () => {
  const m = new Map([["a", 1], ["b", 2], ["c", 3]]);
  const result = set(m.keys());

  assertEquals(result.size, 3);
  assert(result.has("a"));
  assert(result.has("b"));
  assert(result.has("c"));
});

Deno.test("set: nil input returns empty Set", () => {
  assertEquals(set(null).size, 0);
  assertEquals(set(undefined).size, 0);
  assert(set(null) instanceof Set);
});

Deno.test("set: empty array returns empty Set", () => {
  const result = set([]);

  assertEquals(result.size, 0);
  assert(result instanceof Set);
});

Deno.test("set: preserves object references", () => {
  const obj1 = { id: 1 };
  const obj2 = { id: 2 };
  const result = set([obj1, obj2, obj1]); // obj1 appears twice

  assertEquals(result.size, 2); // Deduplicated
  assert(result.has(obj1));
  assert(result.has(obj2));
});

Deno.test("set: mutation of result doesn't affect original", () => {
  const original = new Set([1, 2, 3]);
  const result = set(original);

  result.add(4);
  assertEquals(result.size, 4);
  assertEquals(original.size, 3); // Original unchanged
});

Deno.test("set: from iterable (custom)", () => {
  const iterable = {
    *[Symbol.iterator]() {
      yield "a";
      yield "b";
      yield "a"; // Duplicate
    },
  };

  const result = set(iterable);
  assertEquals(result.size, 2); // Deduplicated
  assert(result.has("a"));
  assert(result.has("b"));
});
