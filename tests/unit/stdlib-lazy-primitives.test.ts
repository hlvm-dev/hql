/**
 * Tests for Phase 1 lazy sequence primitives
 *
 * Tests: takeWhile, dropWhile, splitWith, splitAt, reductions, interleave, interpose
 */

import { assertEquals, assertThrows } from "jsr:@std/assert@1";

const stdlibPath = new URL("../../src/hql/lib/stdlib/js/stdlib.js", import.meta.url).pathname;
const {
  takeWhile,
  dropWhile,
  splitWith,
  splitAt,
  reductions,
  interleave,
  interpose,
  partition,
  partitionAll,
  partitionBy,
  take,
  doall,
  lazySeq,
  isSeq,
  rangeGenerator,
  range,
  count,
  nth,
  delay,
  force,
  isDelay,
  realized,
  NumericRange,
  // Transducers
  transduce,
  intoXform,
  reduced,
  isReduced,
  mapT,
  filterT,
  takeT,
  dropT,
  takeWhileT,
  dropWhileT,
  distinctT,
  partitionAllT,
  composeTransducers,
  TRANSDUCER_INIT,
  TRANSDUCER_STEP,
  TRANSDUCER_RESULT,
  // Chunking infrastructure
  CHUNK_SIZE,
  ChunkBuffer,
  isChunked,
  chunkFirst,
  toChunkedSeq,
  chunkedMap,
  chunkedFilter,
  chunkedReduce,
  arrayChunk,
  chunkCons,
} = await import(stdlibPath);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAKE-WHILE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("takeWhile: basic - takes while predicate is true", () => {
  const result = doall(takeWhile((x: number) => x < 5, [1, 2, 3, 4, 5, 6, 7]));
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("takeWhile: all match", () => {
  const result = doall(takeWhile((x: number) => x < 10, [1, 2, 3]));
  assertEquals(result, [1, 2, 3]);
});

Deno.test("takeWhile: none match", () => {
  const result = doall(takeWhile((x: number) => x < 0, [1, 2, 3]));
  assertEquals(result, []);
});

Deno.test("takeWhile: empty input", () => {
  const result = doall(takeWhile(() => true, []));
  assertEquals(result, []);
});

Deno.test("takeWhile: null input", () => {
  const result = doall(takeWhile(() => true, null));
  assertEquals(result, []);
});

Deno.test("takeWhile: is lazy (works with infinite seq)", () => {
  const infinite = rangeGenerator(); // 0, 1, 2, 3, ...
  const result = doall(takeWhile((x: number) => x < 5, infinite));
  assertEquals(result, [0, 1, 2, 3, 4]);
});

Deno.test("takeWhile: is lazy (side-effect proof)", () => {
  let count = 0;
  const input = lazySeq(function* () {
    for (let i = 0; i < 1000000; i++) {
      count++;
      yield i;
    }
  });

  const result = takeWhile((x: number) => x < 5, input);
  assertEquals(count, 0, "No computation before consumption");

  doall(result);
  assertEquals(count <= 6, true, "Only computes until predicate fails");
});

Deno.test("takeWhile: returns SEQ protocol", () => {
  const result = takeWhile((x: number) => x < 5, [1, 2, 3]);
  assertEquals(isSeq(result), true);
});

Deno.test("takeWhile: throws on non-function predicate", () => {
  assertThrows(
    () => takeWhile("not a function" as any, [1, 2, 3]),
    TypeError,
    "predicate must be a function"
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DROP-WHILE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("dropWhile: basic - drops while predicate is true", () => {
  const result = doall(dropWhile((x: number) => x < 5, [1, 2, 3, 4, 5, 6, 7]));
  assertEquals(result, [5, 6, 7]);
});

Deno.test("dropWhile: all match - drops everything", () => {
  const result = doall(dropWhile((x: number) => x < 10, [1, 2, 3]));
  assertEquals(result, []);
});

Deno.test("dropWhile: none match - keeps everything", () => {
  const result = doall(dropWhile((x: number) => x < 0, [1, 2, 3]));
  assertEquals(result, [1, 2, 3]);
});

Deno.test("dropWhile: empty input", () => {
  const result = doall(dropWhile(() => true, []));
  assertEquals(result, []);
});

Deno.test("dropWhile: null input", () => {
  const result = doall(dropWhile(() => true, null));
  assertEquals(result, []);
});

Deno.test("dropWhile: is lazy", () => {
  let count = 0;
  const input = lazySeq(function* () {
    for (let i = 0; i < 1000000; i++) {
      count++;
      yield i;
    }
  });

  const result = dropWhile((x: number) => x < 5, input);
  assertEquals(count, 0, "No computation before consumption");

  doall(take(3, result));
  assertEquals(count <= 10, true, "Only computes needed items");
});

Deno.test("dropWhile: returns SEQ protocol", () => {
  const result = dropWhile((x: number) => x < 5, [1, 2, 3]);
  assertEquals(isSeq(result), true);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SPLIT-WITH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("splitWith: basic", () => {
  const [taken, dropped] = splitWith((x: number) => x < 5, [1, 2, 3, 4, 5, 6, 7]);
  assertEquals(taken, [1, 2, 3, 4]);
  assertEquals(dropped, [5, 6, 7]);
});

Deno.test("splitWith: all match", () => {
  const [taken, dropped] = splitWith((x: number) => x < 10, [1, 2, 3]);
  assertEquals(taken, [1, 2, 3]);
  assertEquals(dropped, []);
});

Deno.test("splitWith: none match", () => {
  const [taken, dropped] = splitWith((x: number) => x < 0, [1, 2, 3]);
  assertEquals(taken, []);
  assertEquals(dropped, [1, 2, 3]);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SPLIT-AT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("splitAt: basic", () => {
  const [taken, dropped] = splitAt(3, [1, 2, 3, 4, 5]);
  assertEquals(taken, [1, 2, 3]);
  assertEquals(dropped, [4, 5]);
});

Deno.test("splitAt: at zero", () => {
  const [taken, dropped] = splitAt(0, [1, 2, 3]);
  assertEquals(taken, []);
  assertEquals(dropped, [1, 2, 3]);
});

Deno.test("splitAt: beyond length", () => {
  const [taken, dropped] = splitAt(10, [1, 2, 3]);
  assertEquals(taken, [1, 2, 3]);
  assertEquals(dropped, []);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REDUCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("reductions: 3-arity with init", () => {
  const result = doall(reductions((a: number, b: number) => a + b, 0, [1, 2, 3, 4]));
  assertEquals(result, [0, 1, 3, 6, 10]);
});

Deno.test("reductions: 2-arity without init", () => {
  const result = doall(reductions((a: number, b: number) => a + b, [1, 2, 3, 4]));
  assertEquals(result, [1, 3, 6, 10]);
});

Deno.test("reductions: empty with init", () => {
  const result = doall(reductions((a: number, b: number) => a + b, 100, []));
  assertEquals(result, [100]);
});

Deno.test("reductions: empty without init", () => {
  const result = doall(reductions((a: number, b: number) => a + b, []));
  assertEquals(result, []);
});

Deno.test("reductions: single element without init", () => {
  const result = doall(reductions((a: number, b: number) => a + b, [42]));
  assertEquals(result, [42]);
});

Deno.test("reductions: is lazy", () => {
  let count = 0;
  const input = lazySeq(function* () {
    for (let i = 1; i <= 1000000; i++) {
      count++;
      yield i;
    }
  });

  const result = reductions((a: number, b: number) => a + b, 0, input);
  assertEquals(count, 0, "No computation before consumption");

  doall(take(5, result));
  assertEquals(count <= 5, true, "Only computes needed items");
});

Deno.test("reductions: returns SEQ protocol", () => {
  const result = reductions((a: number, b: number) => a + b, 0, [1, 2, 3]);
  assertEquals(isSeq(result), true);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INTERLEAVE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("interleave: two sequences", () => {
  const result = doall(interleave([1, 2, 3], ["a", "b", "c"]));
  assertEquals(result, [1, "a", 2, "b", 3, "c"]);
});

Deno.test("interleave: three sequences", () => {
  const result = doall(interleave([1, 2], ["a", "b"], ["x", "y"]));
  assertEquals(result, [1, "a", "x", 2, "b", "y"]);
});

Deno.test("interleave: unequal lengths - stops at shortest", () => {
  const result = doall(interleave([1, 2, 3, 4, 5], ["a", "b"]));
  assertEquals(result, [1, "a", 2, "b"]);
});

Deno.test("interleave: empty sequence", () => {
  const result = doall(interleave([1, 2, 3], []));
  assertEquals(result, []);
});

Deno.test("interleave: no arguments", () => {
  const result = doall(interleave());
  assertEquals(result, []);
});

Deno.test("interleave: single argument", () => {
  const result = doall(interleave([1, 2, 3]));
  assertEquals(result, [1, 2, 3]);
});

Deno.test("interleave: is lazy", () => {
  let count = 0;
  const input = lazySeq(function* () {
    for (let i = 0; i < 1000000; i++) {
      count++;
      yield i;
    }
  });

  const result = interleave(input, ["a", "b", "c"]);
  assertEquals(count, 0, "No computation before consumption");

  doall(result);
  assertEquals(count <= 4, true, "Only computes up to shortest sequence");
});

Deno.test("interleave: returns SEQ protocol", () => {
  const result = interleave([1, 2], ["a", "b"]);
  assertEquals(isSeq(result), true);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INTERPOSE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("interpose: basic", () => {
  const result = doall(interpose(",", [1, 2, 3]));
  assertEquals(result, [1, ",", 2, ",", 3]);
});

Deno.test("interpose: single element", () => {
  const result = doall(interpose(",", [1]));
  assertEquals(result, [1]);
});

Deno.test("interpose: empty", () => {
  const result = doall(interpose(",", []));
  assertEquals(result, []);
});

Deno.test("interpose: null input", () => {
  const result = doall(interpose(",", null));
  assertEquals(result, []);
});

Deno.test("interpose: is lazy", () => {
  let count = 0;
  const input = lazySeq(function* () {
    for (let i = 0; i < 1000000; i++) {
      count++;
      yield i;
    }
  });

  const result = interpose(",", input);
  assertEquals(count, 0, "No computation before consumption");

  doall(take(5, result)); // Takes 0, ",", 1, ",", 2
  assertEquals(count <= 5, true, "Only computes needed items");
});

Deno.test("interpose: returns SEQ protocol", () => {
  const result = interpose(",", [1, 2, 3]);
  assertEquals(isSeq(result), true);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INTEGRATION TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("integration: takeWhile + dropWhile cover entire sequence", () => {
  const coll = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const pred = (x: number) => x <= 5;
  const taken = doall(takeWhile(pred, coll));
  const dropped = doall(dropWhile(pred, coll));
  assertEquals([...taken, ...dropped], coll);
});

Deno.test("integration: reductions last element equals reduce", () => {
  const add = (a: number, b: number) => a + b;
  const coll = [1, 2, 3, 4, 5];
  const reds = doall(reductions(add, 0, coll));
  const reduced = coll.reduce(add, 0);
  assertEquals(reds[reds.length - 1], reduced);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PARTITION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("partition: basic 2-arity", () => {
  const result = doall(partition(3, [1, 2, 3, 4, 5, 6, 7]));
  assertEquals(result.length, 2);
  assertEquals(result[0], [1, 2, 3]);
  assertEquals(result[1], [4, 5, 6]);
  // 7 is dropped (incomplete group)
});

Deno.test("partition: exact match", () => {
  const result = doall(partition(3, [1, 2, 3, 4, 5, 6]));
  assertEquals(result.length, 2);
  assertEquals(result[0], [1, 2, 3]);
  assertEquals(result[1], [4, 5, 6]);
});

Deno.test("partition: 3-arity with step", () => {
  const result = doall(partition(3, 1, [1, 2, 3, 4, 5]));
  assertEquals(result.length, 3);
  assertEquals(result[0], [1, 2, 3]);
  assertEquals(result[1], [2, 3, 4]);
  assertEquals(result[2], [3, 4, 5]);
});

Deno.test("partition: step larger than n", () => {
  const result = doall(partition(2, 4, [1, 2, 3, 4, 5, 6, 7, 8]));
  assertEquals(result.length, 2);
  assertEquals(result[0], [1, 2]);
  assertEquals(result[1], [5, 6]);
});

Deno.test("partition: empty input", () => {
  const result = doall(partition(3, []));
  assertEquals(result, []);
});

Deno.test("partition: too few elements", () => {
  const result = doall(partition(5, [1, 2, 3]));
  assertEquals(result, []);
});

Deno.test("partition: is lazy", () => {
  let count = 0;
  const input = lazySeq(function* () {
    for (let i = 0; i < 1000000; i++) {
      count++;
      yield i;
    }
  });

  const result = partition(3, input);
  assertEquals(count, 0, "No computation before consumption");

  doall(take(2, result)); // Takes first 2 partitions (6 elements)
  assertEquals(count <= 10, true, "Only computes needed items");
});

Deno.test("partition: returns SEQ protocol", () => {
  const result = partition(3, [1, 2, 3, 4, 5, 6]);
  assertEquals(isSeq(result), true);
});

Deno.test("partition: throws on invalid n", () => {
  assertThrows(
    () => partition(0, [1, 2, 3]),
    TypeError,
    "n must be a positive number"
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PARTITION-ALL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("partitionAll: basic 2-arity (includes incomplete)", () => {
  const result = doall(partitionAll(3, [1, 2, 3, 4, 5, 6, 7]));
  assertEquals(result.length, 3);
  assertEquals(result[0], [1, 2, 3]);
  assertEquals(result[1], [4, 5, 6]);
  assertEquals(result[2], [7]); // Incomplete group included
});

Deno.test("partitionAll: exact match", () => {
  const result = doall(partitionAll(3, [1, 2, 3, 4, 5, 6]));
  assertEquals(result.length, 2);
  assertEquals(result[0], [1, 2, 3]);
  assertEquals(result[1], [4, 5, 6]);
});

Deno.test("partitionAll: 3-arity with step", () => {
  // partitionAll(3, 2, [1,2,3,4,5]):
  // [1,2,3] -> drop 2 -> [3,4,5] -> drop 2 -> [5]
  const result = doall(partitionAll(3, 2, [1, 2, 3, 4, 5]));
  assertEquals(result.length, 3);
  assertEquals(result[0], [1, 2, 3]);
  assertEquals(result[1], [3, 4, 5]);
  assertEquals(result[2], [5]); // Incomplete group included
});

Deno.test("partitionAll: empty input", () => {
  const result = doall(partitionAll(3, []));
  assertEquals(result, []);
});

Deno.test("partitionAll: fewer than n elements", () => {
  const result = doall(partitionAll(5, [1, 2, 3]));
  assertEquals(result.length, 1);
  assertEquals(result[0], [1, 2, 3]);
});

Deno.test("partitionAll: is lazy", () => {
  let count = 0;
  const input = lazySeq(function* () {
    for (let i = 0; i < 1000000; i++) {
      count++;
      yield i;
    }
  });

  const result = partitionAll(3, input);
  assertEquals(count, 0, "No computation before consumption");

  doall(take(2, result));
  assertEquals(count <= 10, true, "Only computes needed items");
});

Deno.test("partitionAll: returns SEQ protocol", () => {
  const result = partitionAll(3, [1, 2, 3, 4, 5]);
  assertEquals(isSeq(result), true);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PARTITION-BY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("partitionBy: basic - by odd/even", () => {
  const result = doall(partitionBy((x: number) => x % 2, [1, 1, 2, 2, 3, 3]));
  assertEquals(result.length, 3);
  assertEquals(result[0], [1, 1]);
  assertEquals(result[1], [2, 2]);
  assertEquals(result[2], [3, 3]);
});

Deno.test("partitionBy: all same", () => {
  const result = doall(partitionBy((x: number) => x % 2, [1, 3, 5, 7]));
  assertEquals(result.length, 1);
  assertEquals(result[0], [1, 3, 5, 7]);
});

Deno.test("partitionBy: all different", () => {
  const result = doall(partitionBy((x: number) => x, [1, 2, 3, 4]));
  assertEquals(result.length, 4);
  assertEquals(result[0], [1]);
  assertEquals(result[1], [2]);
  assertEquals(result[2], [3]);
  assertEquals(result[3], [4]);
});

Deno.test("partitionBy: empty input", () => {
  const result = doall(partitionBy(() => true, []));
  assertEquals(result, []);
});

Deno.test("partitionBy: string identity", () => {
  const result = doall(partitionBy((s: string) => s, ["a", "a", "b", "c", "c"]));
  assertEquals(result.length, 3);
  assertEquals(result[0], ["a", "a"]);
  assertEquals(result[1], ["b"]);
  assertEquals(result[2], ["c", "c"]);
});

Deno.test("partitionBy: is lazy", () => {
  let count = 0;
  const input = lazySeq(function* () {
    for (let i = 0; i < 1000000; i++) {
      count++;
      yield Math.floor(i / 3); // Groups of 3
    }
  });

  const result = partitionBy((x: number) => x, input);
  assertEquals(count, 0, "No computation before consumption");

  doall(take(2, result)); // Takes first 2 partitions
  assertEquals(count <= 10, true, "Only computes needed items");
});

Deno.test("partitionBy: returns SEQ protocol", () => {
  const result = partitionBy((x: number) => x % 2, [1, 2, 3]);
  assertEquals(isSeq(result), true);
});

Deno.test("partitionBy: throws on non-function", () => {
  assertThrows(
    () => partitionBy("not a function" as any, [1, 2, 3]),
    TypeError,
    "f must be a function"
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PARTITION INTEGRATION TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("integration: partition + partitionAll cover same data differently", () => {
  const coll = [1, 2, 3, 4, 5, 6, 7];
  const p = doall(partition(3, coll));
  const pa = doall(partitionAll(3, coll));

  assertEquals(p.length, 2, "partition drops incomplete");
  assertEquals(pa.length, 3, "partitionAll keeps incomplete");
  assertEquals(pa[2], [7], "incomplete group preserved");
});

Deno.test("integration: sliding window with partition", () => {
  // Classic sliding window pattern
  const coll = [1, 2, 3, 4, 5];
  const windows = doall(partition(3, 1, coll));
  assertEquals(windows, [[1, 2, 3], [2, 3, 4], [3, 4, 5]]);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NUMERICRANGE (Phase 3 - JS Optimization)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("NumericRange: range returns NumericRange for finite ranges", () => {
  const r = range(10);
  assertEquals(r instanceof NumericRange, true);
});

Deno.test("NumericRange: O(1) count", () => {
  const r = range(1000000);
  assertEquals(count(r), 1000000);
});

Deno.test("NumericRange: O(1) nth", () => {
  const r = range(1000000);
  assertEquals(nth(r, 0), 0);
  assertEquals(nth(r, 999999), 999999);
  assertEquals(nth(r, 500000), 500000);
});

Deno.test("NumericRange: iteration works", () => {
  const r = range(5);
  const result = doall(r);
  assertEquals(result, [0, 1, 2, 3, 4]);
});

Deno.test("NumericRange: with start and end", () => {
  const r = range(5, 10);
  assertEquals(doall(r), [5, 6, 7, 8, 9]);
  assertEquals(count(r), 5);
});

Deno.test("NumericRange: with step", () => {
  const r = range(0, 10, 2);
  assertEquals(doall(r), [0, 2, 4, 6, 8]);
  assertEquals(count(r), 5);
});

Deno.test("NumericRange: negative step", () => {
  const r = range(10, 0, -1);
  assertEquals(doall(r), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assertEquals(count(r), 10);
});

Deno.test("NumericRange: first/rest work correctly", () => {
  const r = range(5);
  assertEquals(r.first(), 0);
  const rest = r.rest();
  assertEquals(rest.first(), 1);
  assertEquals(count(rest), 4);
});

Deno.test("NumericRange: empty range", () => {
  const r = range(0);
  assertEquals(count(r), 0);
  assertEquals(doall(r), []);
});

Deno.test("NumericRange: implements SEQ protocol", () => {
  const r = range(5);
  assertEquals(isSeq(r), true);
});

Deno.test("NumericRange: works with lazy functions", () => {
  const r = range(100);
  const result = doall(take(5, r));
  assertEquals(result, [0, 1, 2, 3, 4]);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELAY/FORCE (Phase 3 - Explicit Laziness)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("delay: creates unrealized Delay", () => {
  let computed = false;
  const d = delay(() => {
    computed = true;
    return 42;
  });

  assertEquals(isDelay(d), true);
  assertEquals(realized(d), false);
  assertEquals(computed, false, "Thunk not called yet");
});

Deno.test("delay: force realizes the value", () => {
  let callCount = 0;
  const d = delay(() => {
    callCount++;
    return "hello";
  });

  const result = force(d);
  assertEquals(result, "hello");
  assertEquals(realized(d), true);
  assertEquals(callCount, 1);
});

Deno.test("delay: memoizes - thunk called only once", () => {
  let callCount = 0;
  const d = delay(() => {
    callCount++;
    return Math.random();
  });

  const first = force(d);
  const second = force(d);
  const third = force(d);

  assertEquals(first, second);
  assertEquals(second, third);
  assertEquals(callCount, 1, "Thunk called exactly once");
});

Deno.test("force: on non-Delay returns value unchanged", () => {
  assertEquals(force(42), 42);
  assertEquals(force("hello"), "hello");
  assertEquals(force(null), null);
  assertEquals(force(undefined), undefined);
});

Deno.test("isDelay: identifies Delays correctly", () => {
  const d = delay(() => 42);
  assertEquals(isDelay(d), true);
  assertEquals(isDelay(42), false);
  assertEquals(isDelay({}), false);
  assertEquals(isDelay(null), false);
});

Deno.test("realized: checks realization state", () => {
  const d = delay(() => 42);
  assertEquals(realized(d), false);
  force(d);
  assertEquals(realized(d), true);
});

Deno.test("realized: non-lazy values are always realized", () => {
  assertEquals(realized(42), true);
  assertEquals(realized("hello"), true);
  assertEquals(realized([1, 2, 3]), true);
  assertEquals(realized(null), true);
});

Deno.test("delay: can hold any value type", () => {
  const d1 = delay(() => [1, 2, 3]);
  const d2 = delay(() => ({ a: 1 }));
  const d3 = delay(() => null);
  const d4 = delay(() => undefined);

  assertEquals(force(d1), [1, 2, 3]);
  assertEquals(force(d2), { a: 1 });
  assertEquals(force(d3), null);
  assertEquals(force(d4), undefined);
});

Deno.test("delay: expensive computation deferred", () => {
  // Simulate expensive computation
  const d = delay(() => {
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += i;
    return sum;
  });

  assertEquals(realized(d), false);
  const result = force(d);
  assertEquals(result, 499500);
  assertEquals(realized(d), true);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TRANSDUCERS (Phase 4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Helper: array conj reducer
const arrayConj = {
  [TRANSDUCER_INIT]: () => [],
  [TRANSDUCER_STEP]: (acc: any[], x: any) => { acc.push(x); return acc; },
  [TRANSDUCER_RESULT]: (acc: any[]) => acc,
};

// Helper: sum reducer
const sum = {
  [TRANSDUCER_INIT]: () => 0,
  [TRANSDUCER_STEP]: (acc: number, x: number) => acc + x,
  [TRANSDUCER_RESULT]: (acc: number) => acc,
};

Deno.test("reduced: wraps value for early termination", () => {
  const r = reduced(42);
  assertEquals(isReduced(r), true);
  assertEquals(r.deref(), 42);
});

Deno.test("isReduced: identifies Reduced values", () => {
  assertEquals(isReduced(reduced(1)), true);
  assertEquals(isReduced(1), false);
  assertEquals(isReduced(null), false);
});

Deno.test("transduce: basic with mapT", () => {
  const inc = (x: number) => x + 1;
  const result = transduce(mapT(inc), arrayConj, [], [1, 2, 3]);
  assertEquals(result, [2, 3, 4]);
});

Deno.test("transduce: with sum reducer", () => {
  const inc = (x: number) => x + 1;
  const result = transduce(mapT(inc), sum, 0, [1, 2, 3]);
  assertEquals(result, 9); // (1+1) + (2+1) + (3+1) = 9
});

Deno.test("filterT: filters elements", () => {
  const isEven = (x: number) => x % 2 === 0;
  const result = transduce(filterT(isEven), arrayConj, [], [1, 2, 3, 4, 5]);
  assertEquals(result, [2, 4]);
});

Deno.test("takeT: takes first n elements", () => {
  const result = transduce(takeT(3), arrayConj, [], [1, 2, 3, 4, 5]);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("takeT: early termination with many elements", () => {
  // Should not iterate through all million elements
  const result = transduce(takeT(5), arrayConj, [], range(1000000));
  assertEquals(result, [0, 1, 2, 3, 4]);
});

Deno.test("dropT: drops first n elements", () => {
  const result = transduce(dropT(2), arrayConj, [], [1, 2, 3, 4, 5]);
  assertEquals(result, [3, 4, 5]);
});

Deno.test("takeWhileT: takes while predicate is true", () => {
  const result = transduce(
    takeWhileT((x: number) => x < 5),
    arrayConj,
    [],
    [1, 2, 3, 4, 5, 6, 7]
  );
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("dropWhileT: drops while predicate is true", () => {
  const result = transduce(
    dropWhileT((x: number) => x < 3),
    arrayConj,
    [],
    [1, 2, 3, 4, 5]
  );
  assertEquals(result, [3, 4, 5]);
});

Deno.test("distinctT: removes duplicates", () => {
  const result = transduce(distinctT(), arrayConj, [], [1, 2, 1, 3, 2, 4]);
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("partitionAllT: partitions into groups", () => {
  const result = transduce(partitionAllT(2), arrayConj, [], [1, 2, 3, 4, 5]);
  assertEquals(result, [[1, 2], [3, 4], [5]]);
});

Deno.test("composeTransducers: composes multiple transducers", () => {
  const inc = (x: number) => x + 1;
  const isEven = (x: number) => x % 2 === 0;

  // (map inc) then (filter even?)
  // [1,2,3,4,5] -> [2,3,4,5,6] -> [2,4,6]
  const xform = composeTransducers(mapT(inc), filterT(isEven));
  const result = transduce(xform, arrayConj, [], [1, 2, 3, 4, 5]);
  assertEquals(result, [2, 4, 6]);
});

Deno.test("composeTransducers: three transducers", () => {
  // (map inc) -> (filter even?) -> (take 2)
  // [1,2,3,4,5,6] -> [2,3,4,5,6,7] -> [2,4,6] -> [2,4]
  const xform = composeTransducers(
    mapT((x: number) => x + 1),
    filterT((x: number) => x % 2 === 0),
    takeT(2)
  );
  const result = transduce(xform, arrayConj, [], [1, 2, 3, 4, 5, 6]);
  assertEquals(result, [2, 4]);
});

Deno.test("intoXform: 2-arity without transducer", () => {
  const result = intoXform([], [1, 2, 3]);
  assertEquals(result, [1, 2, 3]);
});

Deno.test("intoXform: 3-arity with transducer", () => {
  const result = intoXform(
    [],
    mapT((x: number) => x * 2),
    [1, 2, 3]
  );
  assertEquals(result, [2, 4, 6]);
});

Deno.test("intoXform: into Set", () => {
  const result = intoXform(new Set(), [1, 2, 2, 3, 3, 3]);
  assertEquals(result, new Set([1, 2, 3]));
});

Deno.test("intoXform: into Set with transducer", () => {
  const result = intoXform(
    new Set<number>(),
    mapT((x: number) => x * 2),
    [1, 2, 3]
  );
  assertEquals(result, new Set([2, 4, 6]));
});

Deno.test("transducers: work with range", () => {
  const result = transduce(
    composeTransducers(
      mapT((x: number) => x * x),
      takeT(5)
    ),
    arrayConj,
    [],
    range(100)
  );
  assertEquals(result, [0, 1, 4, 9, 16]);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 5: MULTI-ARITY CLOJURE COMPATIBILITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Import map and reduce for testing
const { map, reduce } = await import(stdlibPath);

// Multi-collection map tests
Deno.test("map: multi-collection - two collections", () => {
  const add = (a: number, b: number) => a + b;
  const result = doall(map(add, [1, 2, 3], [10, 20, 30]));
  assertEquals(result, [11, 22, 33]);
});

Deno.test("map: multi-collection - three collections", () => {
  const sum3 = (a: number, b: number, c: number) => a + b + c;
  const result = doall(map(sum3, [1, 2], [10, 20], [100, 200]));
  assertEquals(result, [111, 222]);
});

Deno.test("map: multi-collection - unequal lengths (stops at shortest)", () => {
  const add = (a: number, b: number) => a + b;
  const result = doall(map(add, [1, 2, 3, 4, 5], [10, 20, 30]));
  assertEquals(result, [11, 22, 33]);
});

Deno.test("map: multi-collection - with vector-like result", () => {
  const pair = (a: number, b: string) => [a, b];
  const result = doall(map(pair, [1, 2, 3], ["a", "b", "c"]));
  assertEquals(result, [[1, "a"], [2, "b"], [3, "c"]]);
});

Deno.test("map: multi-collection - is lazy", () => {
  let count = 0;
  const coll1 = lazySeq(function* () {
    for (let i = 0; i < 1000000; i++) { count++; yield i; }
  });
  const coll2 = [10, 20, 30];

  const result = map((a: number, b: number) => a + b, coll1, coll2);
  assertEquals(count, 0, "No computation before consumption");

  doall(result);
  assertEquals(count <= 5, true, "Only computes needed items");
});

Deno.test("map: multi-collection - empty collection returns empty", () => {
  const add = (a: number, b: number) => a + b;
  const result = doall(map(add, [], [1, 2, 3]));
  assertEquals(result, []);
});

// 2-arity reduce tests
Deno.test("reduce: 2-arity - uses first as init", () => {
  const add = (a: number, b: number) => a + b;
  const result = reduce(add, [1, 2, 3, 4]);
  assertEquals(result, 10); // 1+2+3+4
});

Deno.test("reduce: 2-arity - single element", () => {
  const add = (a: number, b: number) => a + b;
  const result = reduce(add, [42]);
  assertEquals(result, 42);
});

Deno.test("reduce: 2-arity - empty collection calls f()", () => {
  // + with no args returns 0 in Clojure
  const add = (...args: number[]) => args.length === 0 ? 0 : args.reduce((a, b) => a + b);
  const result = reduce(add, []);
  assertEquals(result, 0);
});

Deno.test("reduce: 3-arity - explicit init", () => {
  const add = (a: number, b: number) => a + b;
  const result = reduce(add, 100, [1, 2, 3]);
  assertEquals(result, 106);
});

Deno.test("reduce: 3-arity - empty collection returns init", () => {
  const add = (a: number, b: number) => a + b;
  const result = reduce(add, 42, []);
  assertEquals(result, 42);
});

Deno.test("reduce: early termination with Reduced", () => {
  // Stop when sum exceeds 5 and return that sum
  const sumUntilExceeds5 = (acc: number, x: number) => {
    const newAcc = acc + x;
    return newAcc > 5 ? reduced(newAcc) : newAcc;
  };
  const result = reduce(sumUntilExceeds5, 0, [1, 2, 3, 4, 5]);
  // 0+1=1, 1+2=3, 3+3=6 > 5 → reduced(6)
  assertEquals(result, 6);
});

Deno.test("reduce: early termination - doesn't process rest", () => {
  let processed = 0;
  const countAndStop = (acc: number, _x: number) => {
    processed++;
    return processed >= 3 ? reduced(acc + 1) : acc + 1;
  };
  const result = reduce(countAndStop, 0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assertEquals(processed, 3);
  assertEquals(result, 3);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 6: 32-ELEMENT CHUNKING (like Clojure)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("CHUNK_SIZE: is 32 (Clojure standard)", () => {
  assertEquals(CHUNK_SIZE, 32);
});

Deno.test("ArrayChunk: basic creation and access", () => {
  const chunk = arrayChunk([1, 2, 3, 4, 5]);
  assertEquals(chunk.count(), 5);
  assertEquals(chunk.nth(0), 1);
  assertEquals(chunk.nth(4), 5);
  assertEquals(chunk.first(), 1);
});

Deno.test("ArrayChunk: slicing with offset/end", () => {
  const chunk = arrayChunk([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 2, 7);
  assertEquals(chunk.count(), 5);
  assertEquals(chunk.nth(0), 2);
  assertEquals(chunk.nth(4), 6);
  assertEquals(chunk.toArray(), [2, 3, 4, 5, 6]);
});

Deno.test("ArrayChunk: dropFirst", () => {
  const chunk = arrayChunk([1, 2, 3]);
  const dropped = chunk.dropFirst();
  assertEquals(dropped!.count(), 2);
  assertEquals(dropped!.first(), 2);
  assertEquals(dropped!.toArray(), [2, 3]);
});

Deno.test("ArrayChunk: dropFirst on single element returns null", () => {
  const chunk = arrayChunk([1]);
  assertEquals(chunk.dropFirst(), null);
});

Deno.test("ArrayChunk: reduce", () => {
  const chunk = arrayChunk([1, 2, 3, 4]);
  const sum = chunk.reduce((acc: number, x: number) => acc + x, 0);
  assertEquals(sum, 10);
});

Deno.test("ArrayChunk: iteration", () => {
  const chunk = arrayChunk([1, 2, 3]);
  const items = [...chunk];
  assertEquals(items, [1, 2, 3]);
});

Deno.test("ChunkBuffer: building chunks", () => {
  const buf = new ChunkBuffer(4);
  buf.add(1);
  buf.add(2);
  buf.add(3);
  assertEquals(buf.count(), 3);
  assertEquals(buf.isFull(), false);

  buf.add(4);
  assertEquals(buf.isFull(), true);

  const chunk = buf.chunk();
  assertEquals(chunk.toArray(), [1, 2, 3, 4]);
});

Deno.test("ChunkedCons: basic structure", () => {
  const chunk = arrayChunk([1, 2, 3]);
  const rest = arrayChunk([4, 5, 6]);
  const chunked = chunkCons(chunk, chunkCons(rest, null));

  assertEquals(chunked.first(), 1);
  assertEquals(isChunked(chunked), true);
  assertEquals(chunked.chunkFirst().toArray(), [1, 2, 3]);
});

Deno.test("ChunkedCons: iteration", () => {
  const chunk1 = arrayChunk([1, 2, 3]);
  const chunk2 = arrayChunk([4, 5]);
  const chunked = chunkCons(chunk1, chunkCons(chunk2, null));

  const items = [...chunked];
  assertEquals(items, [1, 2, 3, 4, 5]);
});

Deno.test("ChunkedCons: rest within chunk", () => {
  const chunk = arrayChunk([1, 2, 3]);
  const chunked = chunkCons(chunk, null);

  const r1 = chunked.rest();
  assertEquals(r1.first(), 2);

  const r2 = r1.rest();
  assertEquals(r2.first(), 3);
});

Deno.test("toChunkedSeq: arrays are chunked", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const chunked = toChunkedSeq(arr);

  assertEquals(isChunked(chunked), true);

  // First chunk should be 32 elements
  const firstChunk = chunkFirst(chunked);
  assertEquals(firstChunk.count(), 32);
  assertEquals(firstChunk.nth(0), 0);
  assertEquals(firstChunk.nth(31), 31);
});

Deno.test("toChunkedSeq: NumericRange is chunked", () => {
  const r = range(100); // 0..99
  const chunked = toChunkedSeq(r);

  assertEquals(isChunked(chunked), true);

  const firstChunk = chunkFirst(chunked);
  assertEquals(firstChunk.count(), 32);
});

Deno.test("toChunkedSeq: small array is still chunked", () => {
  const chunked = toChunkedSeq([1, 2, 3]);
  assertEquals(isChunked(chunked), true);
  assertEquals(chunkFirst(chunked).toArray(), [1, 2, 3]);
});

Deno.test("chunkedMap: preserves chunk boundaries", () => {
  const arr = Array.from({ length: 64 }, (_, i) => i);
  const doubled = chunkedMap((x: number) => x * 2, arr);

  // Result should be chunked
  const realized = doall(doubled);
  assertEquals(realized.length, 64);
  assertEquals(realized[0], 0);
  assertEquals(realized[31], 62);
  assertEquals(realized[32], 64);
  assertEquals(realized[63], 126);
});

Deno.test("chunkedMap: is lazy", () => {
  let count = 0;
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const mapped = chunkedMap((x: number) => { count++; return x * 2; }, arr);

  assertEquals(count, 0, "No computation before consumption");

  // Take only first few
  const first5 = doall(take(5, mapped));
  assertEquals(first5, [0, 2, 4, 6, 8]);

  // First chunk (32 elements) computed due to chunk-at-a-time processing
  assertEquals(count <= 32, true, "At most one chunk computed");
});

Deno.test("chunkedFilter: filters across chunks", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const evens = chunkedFilter((x: number) => x % 2 === 0, arr);

  const realized = doall(evens);
  assertEquals(realized.length, 50);
  assertEquals(realized[0], 0);
  assertEquals(realized[49], 98);
});

Deno.test("chunkedFilter: is lazy", () => {
  let count = 0;
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const filtered = chunkedFilter((x: number) => { count++; return x % 2 === 0; }, arr);

  assertEquals(count, 0, "No computation before consumption");

  doall(take(5, filtered));
  // At most first chunk or two computed
  assertEquals(count <= 64, true);
});

Deno.test("chunkedReduce: sums efficiently", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const sum = chunkedReduce((acc: number, x: number) => acc + x, 0, arr);
  assertEquals(sum, 4950); // Sum 0..99
});

Deno.test("chunkedReduce: early termination with Reduced", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  let processed = 0;

  const result = chunkedReduce((acc: number, x: number) => {
    processed++;
    const newAcc = acc + x;
    return newAcc > 50 ? reduced(newAcc) : newAcc;
  }, 0, arr);

  // Should stop early (0+1+2+3+4+5+6+7+8+9+10 = 55 > 50)
  assertEquals(result > 50, true);
  assertEquals(processed < 100, true, "Didn't process all elements");
});

Deno.test("chunkedReduce: with NumericRange", () => {
  const r = range(1, 101); // 1..100
  const sum = chunkedReduce((acc: number, x: number) => acc + x, 0, r);
  assertEquals(sum, 5050); // Famous formula n(n+1)/2
});

Deno.test("integration: chunkedMap + chunkedFilter", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const doubled = chunkedMap((x: number) => x * 2, arr);
  const evens = chunkedFilter((x: number) => x % 4 === 0, doubled);

  const realized = doall(evens);
  assertEquals(realized.length, 50);
  assertEquals(realized[0], 0);
  assertEquals(realized[1], 4);
  assertEquals(realized[49], 196);
});

Deno.test("integration: regular seq operations still work", () => {
  // ChunkedCons implements ISeq, so regular take/map should work
  const chunked = toChunkedSeq([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const taken = doall(take(3, chunked));
  assertEquals(taken, [1, 2, 3]);
});
