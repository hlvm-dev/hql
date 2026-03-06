import { assertEquals, assertThrows } from "jsr:@std/assert@1";

const stdlibPath =
  new URL("../../src/hql/lib/stdlib/js/stdlib.js", import.meta.url).pathname;
const {
  first,
  rest,
  cons,
  isEmpty,
  some,
  comp,
  partial,
  apply,
  iterate,
  take,
  doall,
  filter,
} = await import(stdlibPath);

Deno.test("stdlib fundamentals: first, rest, and cons satisfy the Lisp sequence contract", () => {
  const list = cons(1, cons(2, cons(3, [])));

  assertEquals(first([1, 2, 3]), 1);
  assertEquals(first("hello"), "h");
  assertEquals(first([]), undefined);
  assertEquals(first(null), undefined);
  assertEquals(doall(rest([1, 2, 3])), [2, 3]);
  assertEquals(doall(rest(null)), []);
  assertEquals(doall(list), [1, 2, 3]);
  assertEquals(first(rest(list)), 2);
});

Deno.test("stdlib fundamentals: rest and cons stay lazy until consumed", () => {
  const tail = rest([1, 2, 3, 4]);
  const prepended = cons(0, [1, 2, 3]);

  assertEquals(typeof tail.toArray, "function");
  assertEquals(typeof prepended.toArray, "function");
  assertEquals(doall(tail), [2, 3, 4]);
  assertEquals(doall(prepended), [0, 1, 2, 3]);
});

Deno.test("stdlib fundamentals: isEmpty and some honor nullish input and short-circuit behavior", () => {
  let calls = 0;
  const found = some((x: number) => {
    calls++;
    return x > 2 ? x * 10 : null;
  }, [1, 2, 3, 4]);

  assertEquals(isEmpty([]), true);
  assertEquals(isEmpty(null), true);
  assertEquals(isEmpty(""), true);
  assertEquals(isEmpty([1]), false);
  assertEquals(found, 30);
  assertEquals(calls, 3);
  assertEquals(some(() => true, null), null);
});

Deno.test("stdlib fundamentals: comp composes right-to-left and provides identity for zero functions", () => {
  const add1 = (x: number) => x + 1;
  const double = (x: number) => x * 2;
  const stringify = (x: number) => `v=${x}`;

  assertEquals(comp(stringify, double, add1)(3), "v=8");
  assertEquals(comp()(42), 42);
  assertEquals(comp(add1)(5), 6);
  assertThrows(() => comp(add1, null as unknown as (x: number) => number), TypeError, "must be a function");
});

Deno.test("stdlib fundamentals: partial and apply work with specialized and iterable inputs", () => {
  const add = (a: number, b: number, c: number) => a + b + c;
  const add10 = partial(add, 10);
  const variadic = (...values: number[]) => values.reduce((sum, value) => sum + value, 0);
  const lazyArgs = take(3, iterate((x: number) => x + 1, 1));

  assertEquals(add10(20, 30), 60);
  assertEquals(partial(variadic, 1, 2)(3, 4), 10);
  assertEquals(doall(filter(partial((threshold: number, x: number) => x > threshold, 5), [1, 3, 6, 8, 2, 9])), [6, 8, 9]);
  assertEquals(apply(Math.max, lazyArgs), 3);
  assertEquals(apply(variadic, new Set([1, 2, 3])), 6);
  assertThrows(() => apply(variadic, null), TypeError, "must be iterable");
  assertThrows(() => partial(null as unknown as (...args: number[]) => number), TypeError, "must be a function");
});

Deno.test("stdlib fundamentals: iterate is lazy and supports infinite sequences", () => {
  const powersOfTwo = take(5, iterate((x: number) => x * 2, 1));
  const naturals = take(4, iterate((x: number) => x + 1, 0));

  assertEquals(doall(powersOfTwo), [1, 2, 4, 8, 16]);
  assertEquals(doall(naturals), [0, 1, 2, 3]);
  assertThrows(() => iterate(null as unknown as (x: number) => number, 0), TypeError, "must be a function");
});
