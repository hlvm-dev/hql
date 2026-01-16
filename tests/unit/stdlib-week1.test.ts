/**
 * Week 1: Indexed Access & Counting Functions
 * Tests for nth, count, second, last
 */

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  count,
  iterate,
  last,
  map,
  nth,
  second,
  take,
} from "../../src/hql/lib/stdlib/js/index.js";

// =============================================================================
// nth(coll, index, notFound) - 15 tests
// =============================================================================

Deno.test("nth: array in bounds", () => {
  assertEquals(nth([1, 2, 3], 1), 2);
  assertEquals(nth([10, 20, 30], 0), 10);
  assertEquals(nth([10, 20, 30], 2), 30);
});

Deno.test("nth: array out of bounds without notFound throws", () => {
  assertThrows(
    () => nth([1, 2, 3], 5),
    Error,
    "out of bounds",
  );
});

Deno.test("nth: array out of bounds with notFound returns fallback", () => {
  assertEquals(nth([1, 2, 3], 5, 99), 99);
  assertEquals(nth([1, 2, 3], 10, "nope"), "nope");
});

Deno.test("nth: null without notFound throws", () => {
  assertThrows(
    () => nth(null, 0),
    Error,
    "out of bounds",
  );
});

Deno.test("nth: null with notFound returns fallback", () => {
  assertEquals(nth(null, 0, 99), 99);
  assertEquals(nth(undefined, 5, "default"), "default");
});

Deno.test("nth: negative index throws TypeError", () => {
  assertThrows(
    () => nth([1, 2, 3], -1),
    TypeError,
    "non-negative integer",
  );
});

Deno.test("nth: non-integer index throws TypeError", () => {
  assertThrows(
    () => nth([1, 2, 3], 1.5),
    TypeError,
    "non-negative integer",
  );
  assertThrows(
    () => nth([1, 2, 3], "1" as unknown as number),
    TypeError,
    "non-negative integer",
  );
});

Deno.test("nth: zero index returns first element", () => {
  assertEquals(nth([10, 20, 30], 0), 10);
  assertEquals(nth("hello", 0), "h");
});

Deno.test("nth: last valid index", () => {
  assertEquals(nth([10, 20, 30], 2), 30);
  assertEquals(nth("abc", 2), "c");
});

Deno.test("nth: string access", () => {
  assertEquals(nth("hello", 1), "e");
  assertEquals(nth("hello", 4), "o");
  assertEquals(nth("a", 0), "a");
});

Deno.test("nth: string out of bounds", () => {
  assertThrows(
    () => nth("hello", 10),
    Error,
    "out of bounds",
  );
  assertEquals(nth("hello", 10, null), null);
});

Deno.test("nth: LazySeq in bounds", () => {
  const lazy = map((x: number) => x * 2, [1, 2, 3]);
  assertEquals(nth(lazy, 0), 2);
  assertEquals(nth(lazy, 1), 4);
  assertEquals(nth(lazy, 2), 6);
});

Deno.test("nth: LazySeq out of bounds with notFound", () => {
  const lazy = map((x: number) => x * 2, [1, 2]);
  assertEquals(nth(lazy, 5, "not-found"), "not-found");
});

Deno.test("nth: Set iteration", () => {
  const s = new Set([10, 20, 30]);
  assertEquals(nth(s, 0), 10);
  assertEquals(nth(s, 1), 20);
  assertEquals(nth(s, 2), 30);
});

Deno.test("nth: empty collection with notFound", () => {
  assertEquals(nth([], 0, 99), 99);
  assertEquals(nth("", 0, "empty"), "empty");
});

Deno.test("nth: notFound can be null or undefined", () => {
  assertEquals(nth([1, 2], 5, null), null);
  assertEquals(nth([1, 2], 5, undefined), undefined);
  assertEquals(nth([1, 2], 5, 0), 0); // Falsy but valid
  assertEquals(nth([1, 2], 5, false), false); // Falsy but valid
});

// =============================================================================
// count(coll) - 12 tests
// =============================================================================

Deno.test("count: array", () => {
  assertEquals(count([1, 2, 3]), 3);
  assertEquals(count([42]), 1);
});

Deno.test("count: empty array", () => {
  assertEquals(count([]), 0);
});

Deno.test("count: string", () => {
  assertEquals(count("hello"), 5);
  assertEquals(count("a"), 1);
});

Deno.test("count: empty string", () => {
  assertEquals(count(""), 0);
});

Deno.test("count: null and undefined", () => {
  assertEquals(count(null), 0);
  assertEquals(count(undefined), 0);
});

Deno.test("count: Set", () => {
  assertEquals(count(new Set([1, 2, 2, 3])), 3);
  assertEquals(count(new Set([42])), 1);
});

Deno.test("count: empty Set", () => {
  assertEquals(count(new Set()), 0);
});

Deno.test("count: Map", () => {
  const m = new Map([[1, "a"], [2, "b"], [3, "c"]]);
  assertEquals(count(m), 3);
});

Deno.test("count: empty Map", () => {
  assertEquals(count(new Map()), 0);
});

Deno.test("count: LazySeq", () => {
  const lazy = map((x: number) => x * 2, [1, 2, 3]);
  assertEquals(count(lazy), 3);
});

Deno.test("count: forces eager realization with side effects", () => {
  let counter = 0;
  const lazy = map((x: number) => {
    counter++;
    return x * 2;
  }, [1, 2, 3]);

  // Before count, no elements realized
  assertEquals(counter, 0);

  // count forces full realization
  const result = count(lazy);
  assertEquals(result, 3);
  assertEquals(counter, 3); // All elements realized
});

Deno.test("count: finite portion of infinite sequence", () => {
  const finite = take(5, iterate((x: number) => x + 1, 0));
  assertEquals(count(finite), 5);
});

// =============================================================================
// second(coll) - 7 tests
// =============================================================================

Deno.test("second: multiple elements", () => {
  assertEquals(second([1, 2, 3]), 2);
  assertEquals(second([10, 20, 30, 40]), 20);
});

Deno.test("second: single element returns null", () => {
  assertEquals(second([1]), null);
});

Deno.test("second: empty returns null", () => {
  assertEquals(second([]), null);
});

Deno.test("second: null returns null", () => {
  assertEquals(second(null), null);
  assertEquals(second(undefined), null);
});

Deno.test("second: string", () => {
  assertEquals(second("hello"), "e");
  assertEquals(second("ab"), "b");
});

Deno.test("second: single character string returns null", () => {
  assertEquals(second("a"), null);
  assertEquals(second(""), null);
});

Deno.test("second: LazySeq", () => {
  const lazy = map((x: number) => x * 2, [1, 2, 3]);
  assertEquals(second(lazy), 4);
});

// =============================================================================
// last(coll) - 10 tests
// =============================================================================

Deno.test("last: multiple elements", () => {
  assertEquals(last([1, 2, 3]), 3);
  assertEquals(last([10, 20, 30, 40]), 40);
});

Deno.test("last: single element", () => {
  assertEquals(last([42]), 42);
});

Deno.test("last: empty array returns null", () => {
  assertEquals(last([]), null);
});

Deno.test("last: null returns null", () => {
  assertEquals(last(null), null);
  assertEquals(last(undefined), null);
});

Deno.test("last: string", () => {
  assertEquals(last("hello"), "o");
  assertEquals(last("abc"), "c");
});

Deno.test("last: single character string", () => {
  assertEquals(last("x"), "x");
});

Deno.test("last: empty string returns null", () => {
  assertEquals(last(""), null);
});

Deno.test("last: LazySeq forces full realization", () => {
  let counter = 0;
  const lazy = map((x: number) => {
    counter++;
    return x * 2;
  }, [1, 2, 3]);

  // Before last, no elements realized
  assertEquals(counter, 0);

  // last forces full realization
  const result = last(lazy);
  assertEquals(result, 6);
  assertEquals(counter, 3); // All elements realized
});

Deno.test("last: finite portion of infinite sequence", () => {
  const finite = take(5, iterate((x: number) => x + 1, 0));
  assertEquals(last(finite), 4);
});

Deno.test("last: Set returns last in iteration order", () => {
  const s = new Set([1, 2, 3]);
  const result = last(s);
  assertEquals(result, 3); // Sets maintain insertion order in JS
});
