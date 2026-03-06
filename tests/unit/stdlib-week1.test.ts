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

Deno.test("stdlib week1: nth covers indexed collections and fallback", () => {
  assertEquals(nth([10, 20, 30], 1), 20);
  assertEquals(nth("hello", 4), "o");
  assertEquals(nth([], 0, "missing"), "missing");
  assertEquals(nth(null, 0, 99), 99);
});

Deno.test("stdlib week1: nth validates index and handles iterable collections", () => {
  const lazy = map((x: number) => x * 2, [1, 2, 3]);

  assertEquals(nth(lazy, 2), 6);
  assertEquals(nth(new Set([10, 20, 30]), 1), 20);
  assertThrows(() => nth([1, 2, 3], -1), TypeError, "non-negative integer");
  assertThrows(() => nth([1, 2, 3], 9), Error, "out of bounds");
});

Deno.test("stdlib week1: count handles nil, eager, and lazy collections", () => {
  const seq = take(5, iterate((x: number) => x + 1, 0));

  assertEquals(count(null), 0);
  assertEquals(count("abc"), 3);
  assertEquals(count([1, 2, 3]), 3);
  assertEquals(count(seq), 5);
});

Deno.test("stdlib week1: second and last follow nil-safe collection semantics", () => {
  assertEquals(second([1, 2, 3]), 2);
  assertEquals(second("ab"), "b");
  assertEquals(second([]), null);
  assertEquals(second(null), null);

  assertEquals(last([1, 2, 3]), 3);
  assertEquals(last("hello"), "o");
  assertEquals(last([]), null);
  assertEquals(last(undefined), null);
});

Deno.test("stdlib week1: last fully realizes lazy sequences", () => {
  let realized = 0;
  const lazy = map((x: number) => {
    realized++;
    return x * 2;
  }, [1, 2, 3]);

  assertEquals(last(lazy), 6);
  assertEquals(realized, 3);
});
