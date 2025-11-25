/**
 * Tests for lazy sequence implementation in stdlib
 *
 * Tests:
 * - LazySeq class behavior (single iterator, memoization)
 * - take returns LazySeq and works lazily
 * - REPL printing is safe (infinite sequences don't hang)
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";

// Import LazySeq and stdlib functions from compiled JS
const stdlibPath =
  new URL("../../src/lib/stdlib/js/stdlib.js", import.meta.url).pathname;
const {
  LazySeq,
  lazySeq,
  take,
  map,
  filter,
  reduce,
  drop,
  concat,
  flatten,
  distinct,
  doall,
  realized,
  rangeGenerator,
} = await import(stdlibPath);

Deno.test("LazySeq: iterator created only once", () => {
  let iteratorCreateCount = 0;
  const seq = new LazySeq(function* () {
    iteratorCreateCount++;
    yield 10;
    yield 20;
    yield 30;
  });

  seq.get(0);
  assertEquals(iteratorCreateCount, 1, "Iterator created on first access");

  seq.get(1);
  seq.get(2);
  assertEquals(
    iteratorCreateCount,
    1,
    "Iterator NOT re-created on subsequent access",
  );
});

Deno.test("LazySeq: memoization works", () => {
  let computeCount = 0;
  const seq = new LazySeq(function* () {
    for (let i = 0; i < 5; i++) {
      computeCount++;
      yield i * 2;
    }
  });

  seq.get(2); // Computes [0, 2, 4]
  assertEquals(computeCount, 3);

  seq.get(1); // Uses cache, no new computation
  assertEquals(computeCount, 3);

  seq.get(4); // Computes [6, 8]
  assertEquals(computeCount, 5);
});

Deno.test("take: returns LazySeq", () => {
  const result = take(3, [1, 2, 3, 4, 5]);
  assertExists(result);
  assertEquals(
    result instanceof LazySeq,
    true,
    "take must return LazySeq instance",
  );
});

Deno.test("take: is lazy (side-effect proof)", () => {
  let iterationCount = 0;
  const lazyInput = lazySeq(function* () {
    for (let i = 0; i < 1000000; i++) {
      iterationCount++;
      yield i;
    }
  });

  const result = take(5, lazyInput);
  assertEquals(iterationCount, 0, "No computation before consumption");

  Array.from(result);
  assertEquals(
    iterationCount <= 6,
    true,
    "Only computes needed items (≤6 for 5 items + done check)",
  );
});

Deno.test("take: early termination works", () => {
  let iterationCount = 0;
  const lazyInput = lazySeq(function* () {
    for (let i = 0; i < 1000000; i++) {
      iterationCount++;
      yield i;
    }
  });

  const result = take(5, lazyInput);
  const arr = Array.from(result);

  assertEquals(arr.length, 5);
  assertEquals(iterationCount <= 6, true, "Stops after getting 5 items");
});

Deno.test("take: works with arrays", () => {
  const result = take(3, [10, 20, 30, 40, 50]);
  const arr = Array.from(result);

  assertEquals(arr, [10, 20, 30]);
});

Deno.test("take: empty/null input", () => {
  const result = take(5, null);
  const arr = Array.from(result);

  assertEquals(arr, []);
});

Deno.test("REPL: toString() shows preview (max 20 items)", () => {
  const seq = lazySeq(function* () {
    for (let i = 0; i < 100; i++) {
      yield i;
    }
  });

  const str = seq.toString();
  assertEquals(seq._realized.length, 20, "Only realizes 20 items");
  assertEquals(
    str.includes("..."),
    true,
    "Shows '...' for truncated sequences",
  );
});

Deno.test("REPL: toString() shows full content for small sequences", () => {
  const seq = lazySeq(function* () {
    yield 1;
    yield 2;
    yield 3;
  });

  const str = seq.toString();
  assertEquals(str, "[1,2,3]");
  assertEquals(str.includes("..."), false, "No '...' for small sequences");
});

Deno.test("REPL: infinite sequences don't hang", () => {
  const infiniteSeq = rangeGenerator(0, Infinity);

  const start = Date.now();
  const str = infiniteSeq.toString();
  const end = Date.now();

  assertEquals(infiniteSeq._realized.length, 20, "Limits to 20 items");
  assertEquals((end - start) < 1000, true, "Completes quickly (< 1 second)");
  assertEquals(str.includes("..."), true, "Shows '...' for infinite sequences");
});

Deno.test("REPL: inspect() returns array with '...' for large sequences", () => {
  const seq = lazySeq(function* () {
    for (let i = 0; i < 50; i++) {
      yield i * 2;
    }
  });

  const inspected = seq.inspect();
  assertEquals(inspected.length, 21, "20 items + '...'");
  assertEquals(inspected[20], "...");
});

Deno.test("REPL: inspect() shows full content for small sequences", () => {
  const seq = lazySeq(function* () {
    yield 10;
    yield 20;
  });

  const inspected = seq.inspect();
  assertEquals(inspected, [10, 20]);
});

Deno.test("REPL: no computation until toString() called", () => {
  let computeCount = 0;
  const seq = lazySeq(function* () {
    for (let i = 0; i < 100; i++) {
      computeCount++;
      yield i;
    }
  });

  assertEquals(computeCount, 0, "No computation before toString()");

  seq.toString();
  assertEquals(computeCount, 20, "Only computes 20 items for preview");
});

Deno.test("map: returns LazySeq", () => {
  const result = map((x: number) => x * 2, [1, 2, 3]);
  assertEquals(
    result instanceof LazySeq,
    true,
    "map must return LazySeq instance",
  );
});

Deno.test("map: is lazy (side-effect proof)", () => {
  let mapCount = 0;
  const lazyInput = lazySeq(function* () {
    for (let i = 0; i < 1000000; i++) {
      yield i;
    }
  });

  const result = map((x: number) => {
    mapCount++;
    return x * 2;
  }, lazyInput);

  assertEquals(mapCount, 0, "No computation before consumption");

  Array.from(take(5, result));
  assertEquals(
    mapCount <= 6,
    true,
    "Only computes ≤6 items (5 items + 1 for done check)",
  );
});

Deno.test("map: works with arrays", () => {
  const result = map((x: number) => x * 2, [1, 2, 3]);
  const arr = Array.from(result);

  assertEquals(arr, [2, 4, 6]);
});

Deno.test("map: empty/null input", () => {
  const result = map((x: number) => x * 2, null);
  const arr = Array.from(result);

  assertEquals(arr, []);
});

Deno.test("filter: returns LazySeq", () => {
  const result = filter((x: number) => x % 2 === 0, [1, 2, 3, 4]);
  assertEquals(
    result instanceof LazySeq,
    true,
    "filter must return LazySeq instance",
  );
});

Deno.test("filter: is lazy (side-effect proof)", () => {
  let filterCount = 0;
  const lazyInput = lazySeq(function* () {
    for (let i = 0; i < 1000000; i++) {
      yield i;
    }
  });

  const result = filter((x: number) => {
    filterCount++;
    return x % 2 === 0;
  }, lazyInput);

  assertEquals(filterCount, 0, "No computation before consumption");

  Array.from(take(3, result));
  // filter needs to check more items to find 3 even numbers
  // (checks 0, 1, 2, 3, 4, 5 = 6 items to get [0, 2, 4])
  assertEquals(
    filterCount <= 10,
    true,
    "Only computes items until 3 pass filter",
  );
});

Deno.test("filter: works with arrays", () => {
  const result = filter((x: number) => x % 2 === 0, [1, 2, 3, 4, 5, 6]);
  const arr = Array.from(result);

  assertEquals(arr, [2, 4, 6]);
});

Deno.test("filter: empty/null input", () => {
  const result = filter((x: number) => x % 2 === 0, null);
  const arr = Array.from(result);

  assertEquals(arr, []);
});

Deno.test("reduce: is EAGER (forces full evaluation)", () => {
  let computeCount = 0;
  const lazyInput = lazySeq(function* () {
    for (let i = 0; i < 10; i++) {
      computeCount++;
      yield i;
    }
  });

  assertEquals(computeCount, 0, "No computation before reduce");

  // reduce is EAGER - should compute ALL items immediately
  const result = reduce((acc: number, x: number) => acc + x, 0, lazyInput);

  assertEquals(result, 45, "Correct sum: 0+1+2+...+9 = 45");
  assertEquals(computeCount, 10, "Reduces ALL items eagerly (not lazy)");
});

Deno.test("reduce: works with arrays", () => {
  const result = reduce((acc: number, x: number) => acc + x, 0, [
    1,
    2,
    3,
    4,
    5,
  ]);
  assertEquals(result, 15);
});

Deno.test("reduce: empty/null input", () => {
  const result = reduce((acc: number, x: number) => acc + x, 100, null);
  assertEquals(result, 100, "Returns init value for null input");
});

Deno.test("drop: is lazy", () => {
  let computeCount = 0;
  const lazyInput = lazySeq(function* () {
    for (let i = 0; i < 100; i++) {
      computeCount++;
      yield i;
    }
  });

  const result = drop(5, lazyInput);
  assertEquals(computeCount, 0, "No computation before consumption");

  const arr = Array.from(take(3, result));
  assertEquals(arr, [5, 6, 7]);
  assertEquals(computeCount <= 10, true, "Only computes needed items");
});

Deno.test("concat: is lazy", () => {
  const result = concat([1, 2], [3, 4], [5, 6]);
  assertEquals(result instanceof LazySeq, true);

  const arr = Array.from(result);
  assertEquals(arr, [1, 2, 3, 4, 5, 6]);
});

Deno.test("flatten: is lazy and flattens one level", () => {
  const result = flatten([[1, 2], [3, 4], 5, [6]]);
  assertEquals(result instanceof LazySeq, true);

  const arr = Array.from(result);
  assertEquals(arr, [1, 2, 3, 4, 5, 6]);
});

Deno.test("distinct: is lazy and removes duplicates", () => {
  let computeCount = 0;
  const lazyInput = lazySeq(function* () {
    const values = [1, 2, 2, 3, 3, 3, 4, 4, 4, 4];
    for (const val of values) {
      computeCount++;
      yield val;
    }
  });

  const result = distinct(lazyInput);
  assertEquals(computeCount, 0, "No computation before consumption");

  const arr = Array.from(result);
  assertEquals(arr, [1, 2, 3, 4]);
  assertEquals(computeCount, 10, "Processes all items to check for duplicates");
});

Deno.test("doall: forces full evaluation", () => {
  let computeCount = 0;
  const lazyInput = lazySeq(function* () {
    for (let i = 0; i < 5; i++) {
      computeCount++;
      yield i;
    }
  });

  assertEquals(computeCount, 0, "No computation before doall");

  const result = doall(lazyInput);
  assertEquals(Array.isArray(result), true, "doall returns array");
  assertEquals(result, [0, 1, 2, 3, 4]);
  assertEquals(computeCount, 5, "doall forces full evaluation");
});

Deno.test("realized: checks if LazySeq is exhausted", () => {
  const seq = lazySeq(function* () {
    yield 1;
    yield 2;
  });

  assertEquals(realized(seq), false, "Not realized before consumption");

  Array.from(seq); // Consume entire sequence
  assertEquals(realized(seq), true, "Realized after full consumption");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// rangeGenerator() - Clojure-Style Infinite Sequences
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("rangeGenerator: no args → infinite sequence from 0", () => {
  const infinite = rangeGenerator();
  const result = doall(take(10, infinite));

  assertEquals(result, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

Deno.test("rangeGenerator: no args is lazy (side-effect proof)", () => {
  const infinite = rangeGenerator();

  // Just creating the sequence shouldn't compute anything
  // (can't use side effects to prove this since generator hasn't started)

  // But taking 5 should only compute 5 items
  const result = doall(take(5, infinite));
  assertEquals(result, [0, 1, 2, 3, 4]);

  // Since LazySeq memoizes, taking again from same sequence returns cached values
  const result2 = doall(take(3, infinite));
  assertEquals(result2, [0, 1, 2]); // Returns first 3 memoized values

  // Taking more than what's cached will realize more values
  const result3 = doall(take(10, infinite));
  assertEquals(result3, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // Realizes up to 10
});

Deno.test("rangeGenerator: no args with toString (REPL safety)", () => {
  const infinite = rangeGenerator();

  // toString should NOT hang on infinite sequence
  const str = infinite.toString();

  // Should show preview of ~20 items max
  const hasEllipsis = str.includes("...");
  assertEquals(hasEllipsis, true, "Infinite sequence shows ellipsis");

  // Should not have computed millions of items
  // (if it did, this test would timeout/hang)
});

Deno.test("rangeGenerator: no args with custom step", () => {
  const evenNumbers = rangeGenerator(undefined, undefined, 2);
  const result = doall(take(5, evenNumbers));

  assertEquals(result, [0, 2, 4, 6, 8]);
});

Deno.test("rangeGenerator: no args with negative step", () => {
  const countdown = rangeGenerator(undefined, undefined, -1);
  const result = doall(take(5, countdown));

  assertEquals(result, [0, -1, -2, -3, -4]);
});

Deno.test("rangeGenerator: Clojure compatibility - all signatures", () => {
  // (range)          → 0, 1, 2, 3... ∞
  const infinite = rangeGenerator();
  assertEquals(doall(take(3, infinite)), [0, 1, 2]);

  // (range end)      → 0, 1, 2... end-1
  const toFive = rangeGenerator(5);
  assertEquals(doall(toFive), [0, 1, 2, 3, 4]);

  // (range start end) → start... end-1
  const fiveToTen = rangeGenerator(5, 10);
  assertEquals(doall(fiveToTen), [5, 6, 7, 8, 9]);

  // (range start end step) → start... end-1 by step
  const evens = rangeGenerator(0, 10, 2);
  assertEquals(doall(evens), [0, 2, 4, 6, 8]);
});

Deno.test("rangeGenerator: explicit Infinity still works", () => {
  const infinite = rangeGenerator(0, Infinity);
  const result = doall(take(10, infinite));

  assertEquals(result, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

Deno.test("rangeGenerator: infinite from specific start", () => {
  const from100 = rangeGenerator(100, Infinity);
  const result = doall(take(5, from100));

  assertEquals(result, [100, 101, 102, 103, 104]);
});

// Note: _lazySeq alias removed - just use lazySeq directly
