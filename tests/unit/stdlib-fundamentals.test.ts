// @ts-nocheck: stdlib JS exports lack TypeScript types; this suite exercises dynamic runtime behaviour.
// Tests for the 9 new fundamental functions
// Testing: first, rest, cons, isEmpty, some, comp, partial, apply, iterate

import { assertEquals, assertThrows } from "jsr:@std/assert@1";

const stdlibPath =
  new URL("../../src/lib/stdlib/js/stdlib.js", import.meta.url).pathname;
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
  drop,
  doall,
  map,
  filter,
  reduce,
  concat,
  flatten,
  distinct,
  range,
  groupBy,
  keys,
  realized,
} = await import(stdlibPath);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEQUENCE PRIMITIVES (Lisp Trinity)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("first: returns first element of array", () => {
  assertEquals(first([1, 2, 3]), 1);
  assertEquals(first([42]), 42);
});

Deno.test("first: returns undefined for empty array", () => {
  assertEquals(first([]), undefined);
});

Deno.test("first: returns undefined for null", () => {
  assertEquals(first(null), undefined);
  assertEquals(first(undefined), undefined);
});

Deno.test("first: works with strings", () => {
  assertEquals(first("hello"), "h");
  assertEquals(first(""), undefined);
});

Deno.test("first: works with lazy sequences", () => {
  const seq = take(5, iterate((x) => x + 1, 0));
  assertEquals(first(seq), 0);
});

Deno.test("rest: returns all but first element", () => {
  const result = doall(rest([1, 2, 3]));
  assertEquals(result, [2, 3]);
});

Deno.test("rest: returns empty for single element", () => {
  const result = doall(rest([1]));
  assertEquals(result, []);
});

Deno.test("rest: returns empty for empty array", () => {
  const result = doall(rest([]));
  assertEquals(result, []);
});

Deno.test("rest: returns empty for null", () => {
  const result = doall(rest(null));
  assertEquals(result, []);
});

Deno.test("rest: is lazy", () => {
  const result = rest([1, 2, 3, 4, 5]);
  // Should be LazySeq, not evaluated yet
  assertEquals(typeof result.toArray, "function");
  // Force evaluation
  assertEquals(doall(result), [2, 3, 4, 5]);
});

Deno.test("cons: prepends element to array", () => {
  const result = doall(cons(0, [1, 2, 3]));
  assertEquals(result, [0, 1, 2, 3]);
});

Deno.test("cons: prepends to empty array", () => {
  const result = doall(cons(1, []));
  assertEquals(result, [1]);
});

Deno.test("cons: prepends to null", () => {
  const result = doall(cons(1, null));
  assertEquals(result, [1]);
});

Deno.test("cons: is lazy", () => {
  const result = cons(0, [1, 2, 3]);
  // Should be LazySeq
  assertEquals(typeof result.toArray, "function");
  assertEquals(doall(result), [0, 1, 2, 3]);
});

Deno.test("cons + first + rest: Lisp trinity works together", () => {
  const list = cons(1, cons(2, cons(3, [])));
  assertEquals(first(list), 1);
  assertEquals(first(rest(list)), 2);
  assertEquals(first(rest(rest(list))), 3);
  assertEquals(doall(rest(rest(rest(list)))), []);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEQUENCE PREDICATES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("isEmpty: returns true for empty array", () => {
  assertEquals(isEmpty([]), true);
});

Deno.test("isEmpty: returns false for non-empty array", () => {
  assertEquals(isEmpty([1, 2, 3]), false);
  assertEquals(isEmpty([0]), false);
});

Deno.test("isEmpty: returns true for null/undefined", () => {
  assertEquals(isEmpty(null), true);
  assertEquals(isEmpty(undefined), true);
});

Deno.test("isEmpty: works with strings", () => {
  assertEquals(isEmpty(""), true);
  assertEquals(isEmpty("hello"), false);
});

Deno.test("isEmpty: works with lazy sequences", () => {
  const emptySeq = take(0, [1, 2, 3]);
  assertEquals(isEmpty(emptySeq), true);

  const nonEmptySeq = take(2, [1, 2, 3]);
  assertEquals(isEmpty(nonEmptySeq), false);
});

Deno.test("some: finds first truthy value", () => {
  const result = some((x) => x > 5, [1, 2, 6, 3]);
  assertEquals(result, 6);
});

Deno.test("some: returns null when no match", () => {
  const result = some((x) => x > 10, [1, 2, 3]);
  assertEquals(result, null);
});

Deno.test("some: returns first match", () => {
  const result = some((x) => x % 2 === 0, [1, 3, 4, 6, 8]);
  assertEquals(result, 4); // First even number
});

Deno.test("some: works with identity check", () => {
  const result = some((x) => x === 5, [1, 2, 5, 6, 5]);
  assertEquals(result, 5);
});

Deno.test("some: returns null for null collection", () => {
  const result = some((x) => x > 0, null);
  assertEquals(result, null);
});

Deno.test("some: short-circuits (doesn't evaluate all)", () => {
  let count = 0;
  const result = some((x) => {
    count++;
    return x > 2;
  }, [1, 2, 3, 4, 5]);

  assertEquals(result, 3);
  assertEquals(count, 3); // Should stop at third element
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FUNCTION OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("comp: composes two functions", () => {
  const f = comp((x) => x * 2, (x) => x + 1);
  assertEquals(f(5), 12); // (5+1)*2 = 12
});

Deno.test("comp: composes three functions", () => {
  const f = comp(
    (x) => x * 2,
    (x) => x + 1,
    (x) => x * 3,
  );
  assertEquals(f(2), 14); // (2*3)+1)*2 = 14
});

Deno.test("comp: applies right-to-left", () => {
  const f = comp(
    (x) => x + " world",
    (x) => "hello " + x,
  );
  assertEquals(f("there"), "hello there world");
});

Deno.test("comp: with no functions returns identity", () => {
  const f = comp();
  assertEquals(f(5), 5);
  assertEquals(f("hello"), "hello");
});

Deno.test("comp: with one function returns that function", () => {
  const double = (x) => x * 2;
  const f = comp(double);
  assertEquals(f, double);
  assertEquals(f(5), 10);
});

Deno.test("comp: real-world example (data pipeline)", () => {
  const processData = comp(
    (arr) => arr.join(","),
    (arr) => arr.map((x) => x.toUpperCase()),
    (arr) => arr.filter((x) => x.length > 2),
  );

  assertEquals(processData(["a", "bb", "ccc", "dd", "eee"]), "CCC,EEE");
});

Deno.test("partial: partially applies first argument", () => {
  const add = (a, b) => a + b;
  const add5 = partial(add, 5);
  assertEquals(add5(10), 15);
  assertEquals(add5(3), 8);
});

Deno.test("partial: partially applies multiple arguments", () => {
  const sum = (a, b, c) => a + b + c;
  const addTo10 = partial(sum, 5, 5);
  assertEquals(addTo10(3), 13);
});

Deno.test("partial: can create specialized functions", () => {
  const greaterThan = (threshold, x) => x > threshold;
  const greaterThan5 = partial(greaterThan, 5);

  assertEquals(greaterThan5(3), false);
  assertEquals(greaterThan5(7), true);
});

Deno.test("partial: works with filter", () => {
  const greaterThan = (threshold, x) => x > threshold;
  const greaterThan5 = partial(greaterThan, 5);

  const result = doall(filter(greaterThan5, [1, 3, 6, 8, 2, 9]));
  assertEquals(result, [6, 8, 9]);
});

Deno.test("apply: calls function with array args", () => {
  const sum = (a, b, c) => a + b + c;
  const result = apply(sum, [1, 2, 3]);
  assertEquals(result, 6);
});

Deno.test("apply: works with Math.max", () => {
  const result = apply(Math.max, [1, 5, 3, 9, 2]);
  assertEquals(result, 9);
});

Deno.test("apply: works with variadic functions", () => {
  const sum = (...nums) => nums.reduce((a, b) => a + b, 0);
  const result = apply(sum, [1, 2, 3, 4, 5]);
  assertEquals(result, 15);
});

Deno.test("apply: works with LazySeq", () => {
  const seq = take(3, iterate((x) => x + 1, 1));
  const result = apply(Math.max, seq);
  assertEquals(result, 3);
});

Deno.test("apply: works with Set", () => {
  const result = apply(Math.max, new Set([1, 5, 3, 9, 2]));
  assertEquals(result, 9);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEQUENCE GENERATORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("iterate: generates sequence by iteration", () => {
  const result = doall(take(5, iterate((x) => x * 2, 1)));
  assertEquals(result, [1, 2, 4, 8, 16]);
});

Deno.test("iterate: increment sequence", () => {
  const result = doall(take(5, iterate((x) => x + 1, 0)));
  assertEquals(result, [0, 1, 2, 3, 4]);
});

Deno.test("iterate: is lazy (infinite)", () => {
  const infiniteSeq = iterate((x) => x + 1, 0);
  // Should be iterable (LazySeq)
  assertEquals(typeof infiniteSeq[Symbol.iterator], "function");
  // Can take finite amount
  assertEquals(doall(take(3, infiniteSeq)), [0, 1, 2]);
});

Deno.test("iterate: Fibonacci sequence", () => {
  const fibs = iterate(
    ([a, b]) => [b, a + b],
    [0, 1],
  );
  const result = doall(take(10, map(([a]) => a, fibs)));
  assertEquals(result, [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);
});

Deno.test("iterate: powers of 2", () => {
  const powers = iterate((x) => x * 2, 1);
  const result = doall(take(8, powers));
  assertEquals(result, [1, 2, 4, 8, 16, 32, 64, 128]);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INTEGRATION TESTS (Combining Functions)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("Integration: comp + partial + map", () => {
  const process = comp(
    (arr) => arr.join(","),
    (arr) => doall(map((x) => x.toUpperCase(), arr)),
  );

  assertEquals(process(["hello", "world"]), "HELLO,WORLD");
});

Deno.test("Integration: iterate + first + rest", () => {
  const naturals = iterate((x) => x + 1, 0);
  assertEquals(first(naturals), 0);
  assertEquals(first(rest(naturals)), 1);
  assertEquals(first(rest(rest(naturals))), 2);
});

Deno.test("Integration: cons + some + comp", () => {
  const hasEven = partial(some, (x) => x % 2 === 0);
  const list = cons(1, cons(3, cons(5, [])));
  assertEquals(hasEven(list), null); // No evens

  const list2 = cons(2, list);
  assertEquals(hasEven(list2), 2); // Has even
});

Deno.test("Integration: Real-world data pipeline", () => {
  // Process infinite stream, take first 10 evens, double them, sum
  const result = comp(
    (arr) => arr.reduce((a, b) => a + b, 0),
    (arr) => doall(map((x) => x * 2, arr)),
    (stream) => take(10, stream),
    (stream) => filter((x) => x % 2 === 0, stream),
  )(iterate((x) => x + 1, 0));

  // First 10 evens: 0,2,4,6,8,10,12,14,16,18
  // Doubled: 0,4,8,12,16,20,24,28,32,36
  // Sum: 180
  assertEquals(result, 180);
});

Deno.test("Integration: isEmpty + rest recursion pattern", () => {
  function sumList(list) {
    if (isEmpty(list)) return 0;
    return first(list) + sumList(rest(list));
  }

  const list = cons(1, cons(2, cons(3, cons(4, []))));
  assertEquals(sumList(list), 10);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ERROR HANDLING TESTS (Test robustness)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("map: throws TypeError for non-function", () => {
  assertThrows(
    () => map(123, [1, 2, 3]),
    TypeError,
    "map: first argument must be a function",
  );
});

Deno.test("filter: throws TypeError for non-function", () => {
  assertThrows(
    () => filter("not a function", [1, 2, 3]),
    TypeError,
    "filter: predicate must be a function",
  );
});

Deno.test("some: throws TypeError for non-function", () => {
  assertThrows(
    () => some(null, [1, 2, 3]),
    TypeError,
    "some: predicate must be a function",
  );
});

Deno.test("comp: throws TypeError for non-function argument", () => {
  assertThrows(
    () => comp((x) => x + 1, "not a function"),
    TypeError,
    "argument 2",
  );
});

Deno.test("partial: throws TypeError for non-function", () => {
  assertThrows(
    () => partial("not a function", 1, 2),
    TypeError,
    "partial: function must be a function",
  );
});

Deno.test("apply: throws TypeError for non-iterable", () => {
  assertThrows(
    () => apply(Math.max, 123),
    TypeError,
    "must be iterable",
  );
});

Deno.test("apply: throws TypeError for null", () => {
  assertThrows(
    () => apply(Math.max, null),
    TypeError,
    "must be iterable",
  );
});

Deno.test("take: returns empty for negative n (Clojure behavior)", () => {
  // Clojure's take returns empty for negative n, doesn't throw
  const result = doall(take(-5, [1, 2, 3]));
  assertEquals(result, []);
});

Deno.test("drop: returns all elements for negative n (Clojure behavior)", () => {
  // Clojure's drop returns all elements for negative n, doesn't throw
  const result = doall(drop(-5, [1, 2, 3]));
  assertEquals(result, [1, 2, 3]);
});

Deno.test("range: throws TypeError for zero step", () => {
  assertThrows(
    () => doall(take(5, range(0, 10, 0))),
    TypeError,
    "step",
  );
});

Deno.test("iterate: throws TypeError for non-function", () => {
  assertThrows(
    () => iterate("not a function", 0),
    TypeError,
    "iterate: iterator function must be a function",
  );
});

Deno.test("groupBy: throws TypeError for non-function", () => {
  assertThrows(
    () => groupBy(123, [1, 2, 3]),
    TypeError,
    "groupBy: key function must be a function",
  );
});

Deno.test("reduce: throws TypeError for non-function", () => {
  assertThrows(
    () => reduce("not a function", 0, [1, 2, 3]),
    TypeError,
    "reduce: reducer must be a function",
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EDGE CASE TESTS (Test corner cases)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("concat: handles all null arguments", () => {
  const result = doall(concat(null, null, null));
  assertEquals(result, []);
});

Deno.test("concat: mixes arrays and nulls", () => {
  const result = doall(concat([1, 2], null, [3, 4], null));
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("flatten: handles already-flat arrays", () => {
  const result = doall(flatten([1, 2, 3]));
  assertEquals(result, [1, 2, 3]);
});

Deno.test("flatten: handles mixed nested and flat", () => {
  const result = doall(flatten([1, [2, 3], 4, [5]]));
  assertEquals(result, [1, 2, 3, 4, 5]);
});

Deno.test("distinct: handles empty collection", () => {
  const result = doall(distinct([]));
  assertEquals(result, []);
});

Deno.test("distinct: handles single element", () => {
  const result = doall(distinct([42]));
  assertEquals(result, [42]);
});

Deno.test("distinct: uses identity for objects", () => {
  const obj = { x: 1 };
  const result = doall(distinct([obj, obj, { x: 1 }]));
  assertEquals(result.length, 2); // obj deduplicated, but new object kept
});

Deno.test("reduce: returns init for empty collection", () => {
  const result = reduce((a, b) => a + b, 10, []);
  assertEquals(result, 10);
});

Deno.test("reduce: handles single element", () => {
  const result = reduce((a, b) => a + b, 0, [42]);
  assertEquals(result, 42);
});

Deno.test("reduce: works with null collection", () => {
  const result = reduce((a, b) => a + b, 100, null);
  assertEquals(result, 100);
});

Deno.test("comp: propagates errors from composed functions", () => {
  const f = comp(
    (x) => x * 2,
    (_x) => {
      throw new Error("test error");
    },
  );
  assertThrows(() => f(5), Error, "test error");
});

Deno.test("partial: works with variadic functions", () => {
  const sum = (...args) => args.reduce((a, b) => a + b, 0);
  const add10 = partial(sum, 1, 2, 3, 4);
  assertEquals(add10(5, 6), 21); // 1+2+3+4+5+6
});

Deno.test("groupBy: handles key collisions correctly", () => {
  const result = groupBy(
    (x) => x % 3,
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assertEquals(result.get(0), [3, 6, 9]);
  assertEquals(result.get(1), [1, 4, 7]);
  assertEquals(result.get(2), [2, 5, 8]);
});

Deno.test("groupBy: handles empty collection", () => {
  const result = groupBy((x) => x, []);
  assertEquals(result, new Map());
});

Deno.test("groupBy: handles null collection", () => {
  const result = groupBy((x) => x, null);
  assertEquals(result, new Map());
});

Deno.test("keys: returns empty array for null", () => {
  assertEquals(keys(null), []);
  assertEquals(keys(undefined), []);
});

Deno.test("keys: returns keys from object", () => {
  const result = keys({ a: 1, b: 2, c: 3 });
  assertEquals(result.sort(), ["a", "b", "c"]);
});

Deno.test("realized: returns true for arrays", () => {
  assertEquals(realized([1, 2, 3]), true);
});

Deno.test("realized: returns true for null", () => {
  assertEquals(realized(null), true);
});

Deno.test("realized: returns false for non-exhausted LazySeq", () => {
  const seq = take(10, iterate((x) => x + 1, 0));
  assertEquals(realized(seq), false);
});

Deno.test("realized: returns true after full realization", () => {
  const seq = take(5, iterate((x) => x + 1, 0));
  doall(seq); // Force full realization
  assertEquals(realized(seq), true);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADDITIONAL INTEGRATION TESTS (Complex scenarios)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("Integration: null handling in complex chains", () => {
  const result = first(filter((x) => x > 5, null));
  assertEquals(result, undefined);
});

Deno.test("Integration: chaining lazy operations", () => {
  const result = doall(
    take(5, filter((x) => x % 2 === 0, map((x) => x * 2, range(0, 10)))),
  );
  // range(0,10) → [0,1,2,3,4,5,6,7,8,9]
  // map *2 → [0,2,4,6,8,10,12,14,16,18]
  // filter even → [0,2,4,6,8,10,12,14,16,18]
  // take 5 → [0,2,4,6,8]
  assertEquals(result, [0, 2, 4, 6, 8]);
});
