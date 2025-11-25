/**
 * Week 3: Collection Protocols
 * Tests for seq, empty, conj, into
 */

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  conj,
  doall,
  empty,
  first,
  into,
  LazySeq,
  seq,
} from "../../src/lib/stdlib/js/index.js";

// =============================================================================
// seq(coll) - 12 tests
// =============================================================================

Deno.test("seq: array returns LazySeq", () => {
  const result = seq([1, 2, 3]);
  assertEquals(result instanceof LazySeq, true);
  assertEquals(doall(result!), [1, 2, 3]);
});

Deno.test("seq: empty array returns null", () => {
  const result = seq([]);
  assertEquals(result, null);
});

Deno.test("seq: null returns null", () => {
  const result = seq(null);
  assertEquals(result, null);
});

Deno.test("seq: undefined returns null", () => {
  const result = seq(undefined);
  assertEquals(result, null);
});

Deno.test("seq: string returns character sequence", () => {
  const result = seq("abc");
  assertEquals(result instanceof LazySeq, true);
  assertEquals(doall(result!), ["a", "b", "c"]);
});

Deno.test("seq: empty string returns null", () => {
  const result = seq("");
  assertEquals(result, null);
});

Deno.test("seq: Set returns LazySeq", () => {
  const result = seq(new Set([1, 2, 3]));
  assertEquals(result instanceof LazySeq, true);
  assertEquals(doall(result!), [1, 2, 3]);
});

Deno.test("seq: empty Set returns null", () => {
  const result = seq(new Set());
  assertEquals(result, null);
});

Deno.test("seq: Map returns entry sequence", () => {
  const result = seq(new Map([[1, 2], [3, 4]]));
  assertEquals(result instanceof LazySeq, true);
  assertEquals(doall(result!), [[1, 2], [3, 4]]);
});

Deno.test("seq: object returns entry sequence", () => {
  const result = seq({ a: 1, b: 2 });
  assertEquals(result instanceof LazySeq, true);
  const entries = doall(result!);
  assertEquals(entries.length, 2);
  assertEquals(entries[0], ["a", 1]);
  assertEquals(entries[1], ["b", 2]);
});

Deno.test("seq: empty object returns null", () => {
  const result = seq({});
  assertEquals(result, null);
});

Deno.test("seq: empty LazySeq pass-through", () => {
  const empty = new LazySeq(function* () {});
  const result = seq(empty);
  // Pass through the LazySeq, don't realize to check if empty
  assertEquals(result, empty);
});

Deno.test("seq: LazySeq maintains lazy evaluation", () => {
  let counter = 0;
  const lazy = new LazySeq(function* () {
    counter++;
    yield 1;
    counter++;
    yield 2;
  });

  const result = seq(lazy);
  assertEquals(counter, 0); // Not realized yet

  assertEquals(first(result!), 1);
  assertEquals(counter, 1); // Only first element realized
});

// =============================================================================
// empty(coll) - 10 tests
// =============================================================================

Deno.test("empty: array returns fresh empty array", () => {
  const orig = [1, 2, 3];
  const result = empty(orig);
  assertEquals(result, []);
  assertEquals(result !== orig, true); // Fresh instance
});

Deno.test("empty: string returns empty string", () => {
  const result = empty("abc");
  assertEquals(result, "");
});

Deno.test("empty: Set returns new empty Set", () => {
  const orig = new Set([1, 2, 3]);
  const result = empty(orig);
  assertEquals(result instanceof Set, true);
  assertEquals(result.size, 0);
  assertEquals(result !== orig, true); // Fresh instance
});

Deno.test("empty: Map returns new empty Map", () => {
  const orig = new Map([[1, 2]]);
  const result = empty(orig);
  assertEquals(result instanceof Map, true);
  assertEquals(result.size, 0);
  assertEquals(result !== orig, true); // Fresh instance
});

Deno.test("empty: object returns fresh empty object", () => {
  const orig = { a: 1, b: 2 };
  const result = empty(orig);
  assertEquals(result, {});
  assertEquals(result !== orig, true); // Fresh instance
});

Deno.test("empty: LazySeq returns EMPTY_LAZY_SEQ", () => {
  const lazy = new LazySeq(function* () {
    yield 1;
    yield 2;
  });
  const result = empty(lazy);
  assertEquals(result instanceof LazySeq, true);
  assertEquals(doall(result), []);
});

Deno.test("empty: null returns null", () => {
  const result = empty(null);
  assertEquals(result, null);
});

Deno.test("empty: preserves collection type", () => {
  assertEquals(Array.isArray(empty([1, 2])), true);
  assertEquals(typeof empty("abc"), "string");
  assertEquals(empty(new Set([1])) instanceof Set, true);
  assertEquals(empty(new Map([[1, 2]])) instanceof Map, true);
});

Deno.test("empty: returns fresh instances", () => {
  const arr = [1, 2];
  const obj = { a: 1 };
  const set = new Set([1]);

  assertEquals(empty(arr) !== arr, true);
  assertEquals(empty(obj) !== obj, true);
  assertEquals(empty(set) !== set, true);
});

Deno.test("empty: non-collection throws TypeError", () => {
  assertThrows(
    () => empty(123 as unknown as Iterable<unknown>),
    TypeError,
    "Cannot create empty collection",
  );
});

// =============================================================================
// conj(coll, ...items) - 14 tests
// =============================================================================

Deno.test("conj: array with single item", () => {
  const result = conj([1, 2], 3);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("conj: array with multiple items", () => {
  const result = conj([1, 2], 3, 4, 5);
  assertEquals(result, [1, 2, 3, 4, 5]);
});

Deno.test("conj: empty array", () => {
  const result = conj([], 1);
  assertEquals(result, [1]);
});

Deno.test("conj: Set adds unique items", () => {
  const result = conj(new Set([1, 2]), 3);
  assertEquals(result instanceof Set, true);
  assertEquals(Array.from(result), [1, 2, 3]);
});

Deno.test("conj: Set with duplicates ignored", () => {
  const result = conj(new Set([1, 2]), 2, 3);
  assertEquals(result instanceof Set, true);
  assertEquals(Array.from(result), [1, 2, 3]);
});

Deno.test("conj: Map with [key, value] pair", () => {
  const result = conj(new Map([[1, 2]]), [3, 4]);
  assertEquals(result instanceof Map, true);
  assertEquals(Array.from(result), [[1, 2], [3, 4]]);
});

Deno.test("conj: Map with multiple entries", () => {
  const result = conj(new Map(), [1, 2], [3, 4]);
  assertEquals(result instanceof Map, true);
  assertEquals(Array.from(result), [[1, 2], [3, 4]]);
});

Deno.test("conj: Map with non-pair throws", () => {
  assertThrows(
    () => conj(new Map(), 123 as unknown as [number, number]),
    TypeError,
    "Map entries must be [key, value] pairs",
  );
});

Deno.test("conj: object with [key, value] pair", () => {
  const result = conj({ a: 1 }, ["b", 2]);
  assertEquals(result, { a: 1, b: 2 });
});

Deno.test("conj: object with non-pair throws", () => {
  assertThrows(
    () => conj({}, 123 as unknown as [string, unknown]),
    TypeError,
    "Object entries must be [key, value] pairs",
  );
});

Deno.test("conj: string concatenation", () => {
  const result = conj("ab", "c", "d");
  assertEquals(result, "abcd");
});

Deno.test("conj: null creates array", () => {
  const result = conj(null, 1, 2);
  assertEquals(result, [1, 2]);
});

Deno.test("conj: immutability - array not mutated", () => {
  const orig = [1, 2];
  const result = conj(orig, 3);
  assertEquals(orig, [1, 2]); // Original unchanged
  assertEquals(result, [1, 2, 3]);
  assertEquals(result !== orig, true);
});

Deno.test("conj: no items returns unchanged", () => {
  const arr = [1, 2];
  const result = conj(arr);
  assertEquals(result, [1, 2]);
});

// =============================================================================
// into(to, from) - 12 tests
// =============================================================================

Deno.test("into: array into array", () => {
  const result = into([1, 2], [3, 4]);
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("into: array into Set deduplicates", () => {
  const result = into(new Set(), [1, 2, 2, 3]);
  assertEquals(result instanceof Set, true);
  assertEquals(Array.from(result), [1, 2, 3]);
});

Deno.test("into: entries into Map", () => {
  const result = into(new Map(), [[1, 2], [3, 4]]);
  assertEquals(result instanceof Map, true);
  assertEquals(Array.from(result), [[1, 2], [3, 4]]);
});

Deno.test("into: Set into array", () => {
  const result = into([], new Set([1, 2, 3]));
  assertEquals(result, [1, 2, 3]);
});

Deno.test("into: Map into object", () => {
  const result = into({}, new Map([["a", 1], ["b", 2]]));
  assertEquals(result, { a: 1, b: 2 });
});

Deno.test("into: empty into empty", () => {
  const result = into([], []);
  assertEquals(result, []);
});

Deno.test("into: empty from", () => {
  const result = into([1, 2], []);
  assertEquals(result, [1, 2]);
});

Deno.test("into: null to creates array", () => {
  const result = into(null, [1, 2, 3]);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("into: null from", () => {
  const result = into([1, 2], null);
  assertEquals(result, [1, 2]);
});

Deno.test("into: LazySeq from realizes fully", () => {
  let counter = 0;
  const lazy = new LazySeq(function* () {
    counter++;
    yield 1;
    counter++;
    yield 2;
  });

  const result = into([], lazy);
  assertEquals(result, [1, 2]);
  assertEquals(counter, 2); // Fully realized
});

Deno.test("into: type preservation", () => {
  assertEquals(Array.isArray(into([], [1, 2])), true);
  assertEquals(into(new Set(), [1]) instanceof Set, true);
  assertEquals(into(new Map(), [[1, 2]]) instanceof Map, true);
  assertEquals(typeof into({}, [["a", 1]]), "object");
});

Deno.test("into: immutability - original unchanged", () => {
  const orig = [1, 2];
  const result = into(orig, [3, 4]);
  assertEquals(orig, [1, 2]); // Original unchanged
  assertEquals(result, [1, 2, 3, 4]);
});
