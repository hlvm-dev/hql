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
  range,
  count,
  nth,
  delay,
  force,
  isDelay,
  realized,
  NumericRange,
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
  map,
  reduce,
} = await import(stdlibPath);

const arrayConj = {
  [TRANSDUCER_INIT]: () => [],
  [TRANSDUCER_STEP]: (acc: unknown[], value: unknown) => {
    acc.push(value);
    return acc;
  },
  [TRANSDUCER_RESULT]: (acc: unknown[]) => acc,
};

function countingLazy(limit: number, onYield: () => void) {
  return lazySeq(function* () {
    for (let i = 0; i < limit; i++) {
      onYield();
      yield i;
    }
  });
}

Deno.test("stdlib lazy primitives: takeWhile keeps prefix, stays lazy, and validates predicates", () => {
  let seen = 0;
  const input = countingLazy(100, () => seen++);
  const result = takeWhile((x: number) => x < 5, input);

  assertEquals(doall(takeWhile((x: number) => x < 4, [1, 2, 3, 4, 5])), [1, 2, 3]);
  assertEquals(doall(takeWhile(() => true, null)), []);
  assertEquals(isSeq(result), true);
  assertEquals(seen, 0);
  assertEquals(doall(result), [0, 1, 2, 3, 4]);
  assertEquals(seen <= 6, true);
  assertThrows(() => takeWhile(null as unknown as (x: number) => boolean, [1, 2]), TypeError);
});

Deno.test("stdlib lazy primitives: dropWhile skips the prefix lazily", () => {
  let seen = 0;
  const input = countingLazy(100, () => seen++);
  const result = dropWhile((x: number) => x < 3, input);

  assertEquals(doall(dropWhile((x: number) => x < 3, [1, 2, 3, 4, 5])), [3, 4, 5]);
  assertEquals(doall(dropWhile(() => true, [])), []);
  assertEquals(isSeq(result), true);
  assertEquals(seen, 0);
  assertEquals(doall(take(3, result)), [3, 4, 5]);
  assertEquals(seen <= 6, true);
});

Deno.test("stdlib lazy primitives: splitWith and splitAt partition data without loss", () => {
  assertEquals(splitWith((x: number) => x < 4, [1, 2, 3, 4, 5]), [[1, 2, 3], [4, 5]]);
  assertEquals(splitWith((x: number) => x < 0, [1, 2]), [[], [1, 2]]);
  assertEquals(splitAt(2, [1, 2, 3, 4]), [[1, 2], [3, 4]]);
  assertEquals(splitAt(10, [1, 2, 3]), [[1, 2, 3], []]);
});

Deno.test("stdlib lazy primitives: reductions supports both arities and remains lazy", () => {
  let seen = 0;
  const input = countingLazy(100, () => seen++);
  const result = reductions((acc: number, x: number) => acc + x, 0, input);

  assertEquals(doall(reductions((acc: number, x: number) => acc + x, 0, [1, 2, 3])), [0, 1, 3, 6]);
  assertEquals(doall(reductions((acc: number, x: number) => acc + x, [1, 2, 3])), [1, 3, 6]);
  assertEquals(doall(reductions((acc: number, x: number) => acc + x, 0, [])), [0]);
  assertEquals(isSeq(result), true);
  assertEquals(seen, 0);
  assertEquals(doall(take(3, result)), [0, 0, 1]);
  assertEquals(seen <= 2, true);
});

Deno.test("stdlib lazy primitives: interleave stops at the shortest input and stays lazy", () => {
  let seen = 0;
  const input = countingLazy(100, () => seen++);
  const result = interleave(input, ["a", "b", "c"]);

  assertEquals(doall(interleave([1, 2, 3], ["a", "b", "c"])), [1, "a", 2, "b", 3, "c"]);
  assertEquals(doall(interleave([1, 2, 3], ["a"])), [1, "a"]);
  assertEquals(doall(interleave()), []);
  assertEquals(doall(take(4, result)), [0, "a", 1, "b"]);
  assertEquals(seen <= 2, true);
});

Deno.test("stdlib lazy primitives: interpose inserts separators lazily", () => {
  let seen = 0;
  const input = countingLazy(100, () => seen++);
  const result = interpose("x", input);

  assertEquals(doall(interpose("x", [1, 2, 3])), [1, "x", 2, "x", 3]);
  assertEquals(doall(interpose("x", [])), []);
  assertEquals(doall(take(5, result)), [0, "x", 1, "x", 2]);
  assertEquals(seen <= 3, true);
});

Deno.test("stdlib lazy primitives: partition groups by size and validates n", () => {
  let seen = 0;
  const input = countingLazy(100, () => seen++);
  const result = partition(3, input);

  assertEquals(doall(partition(3, [1, 2, 3, 4, 5, 6, 7])), [[1, 2, 3], [4, 5, 6]]);
  assertEquals(doall(partition(3, 1, [1, 2, 3, 4])), [[1, 2, 3], [2, 3, 4]]);
  assertEquals(doall(take(2, result)), [[0, 1, 2], [3, 4, 5]]);
  assertEquals(seen <= 6, true);
  assertThrows(() => partition(0, [1, 2, 3]), TypeError);
});

Deno.test("stdlib lazy primitives: partitionAll and partitionBy cover incomplete and run-based grouping", () => {
  assertEquals(doall(partitionAll(3, [1, 2, 3, 4, 5, 6, 7])), [[1, 2, 3], [4, 5, 6], [7]]);
  assertEquals(doall(partitionAll(2, 1, [1, 2, 3])), [[1, 2], [2, 3], [3]]);
  assertEquals(doall(partitionBy((x: number) => x % 2 === 0, [1, 3, 2, 4, 5])), [[1, 3], [2, 4], [5]]);
  assertEquals(doall(partitionBy((x: string) => x, ["a", "a", "b"])), [["a", "a"], ["b"]]);
  assertThrows(() => partitionBy(null as unknown as (x: number) => boolean, [1]), TypeError);
});

Deno.test("stdlib lazy primitives: NumericRange provides O(1) count/nth and normal sequence iteration", () => {
  const finite = range(0, 10, 2);
  const descending = range(5, 0, -1);

  assertEquals(finite instanceof NumericRange, true);
  assertEquals(count(finite), 5);
  assertEquals(nth(finite, 3), 6);
  assertEquals(doall(finite), [0, 2, 4, 6, 8]);
  assertEquals(doall(descending), [5, 4, 3, 2, 1]);
  assertEquals(isSeq(range(5)), true);
  assertEquals(doall(take(4, range(100))), [0, 1, 2, 3]);
});

Deno.test("stdlib lazy primitives: delay, force, isDelay, and realized implement memoized explicit laziness", () => {
  let calls = 0;
  const deferred = delay(() => {
    calls++;
    return { value: 42 };
  });

  assertEquals(isDelay(deferred), true);
  assertEquals(realized(deferred), false);
  assertEquals(calls, 0);
  assertEquals(force(7), 7);
  assertEquals(force(deferred), { value: 42 });
  assertEquals(force(deferred), { value: 42 });
  assertEquals(calls, 1);
  assertEquals(realized(deferred), true);
  assertEquals(isDelay(null), false);
  assertEquals(realized([1, 2, 3]), true);
});

Deno.test("stdlib lazy primitives: reduced and isReduced model early termination markers", () => {
  const marker = reduced(42);

  assertEquals(isReduced(marker), true);
  assertEquals(marker.deref(), 42);
  assertEquals(isReduced(42), false);
});

Deno.test("stdlib lazy primitives: transduce composes map/filter/take correctly", () => {
  const xform = composeTransducers(
    mapT((x: number) => x + 1),
    filterT((x: number) => x % 2 === 0),
    takeT(2),
  );

  assertEquals(transduce(xform, arrayConj, [], [1, 2, 3, 4, 5]), [2, 4]);
  assertEquals(transduce(takeT(5), arrayConj, [], range(1_000_000)), [0, 1, 2, 3, 4]);
});

Deno.test("stdlib lazy primitives: remaining transducers cover drop/while/distinct/partition behavior", () => {
  assertEquals(transduce(dropT(2), arrayConj, [], [1, 2, 3, 4, 5]), [3, 4, 5]);
  assertEquals(transduce(takeWhileT((x: number) => x < 4), arrayConj, [], [1, 2, 3, 4, 5]), [1, 2, 3]);
  assertEquals(transduce(dropWhileT((x: number) => x < 3), arrayConj, [], [1, 2, 3, 4]), [3, 4]);
  assertEquals(transduce(distinctT(), arrayConj, [], [1, 2, 1, 3, 2, 4]), [1, 2, 3, 4]);
  assertEquals(transduce(partitionAllT(2), arrayConj, [], [1, 2, 3, 4, 5]), [[1, 2], [3, 4], [5]]);
});

Deno.test("stdlib lazy primitives: intoXform supports plain collection pours and transformed Set output", () => {
  assertEquals(intoXform([], [1, 2, 3]), [1, 2, 3]);
  assertEquals(
    intoXform(new Set<number>(), mapT((x: number) => x * 2), [1, 2, 3]),
    new Set([2, 4, 6]),
  );
});

Deno.test("stdlib lazy primitives: multi-collection map zips inputs lazily", () => {
  let seen = 0;
  const input = countingLazy(100, () => seen++);
  const result = map((a: number, b: number) => a + b, input, [10, 20, 30]);

  assertEquals(doall(map((a: number, b: number) => a + b, [1, 2, 3], [10, 20, 30])), [11, 22, 33]);
  assertEquals(doall(take(2, result)), [10, 21]);
  assertEquals(seen <= 2, true);
  assertEquals(doall(map((a: number, b: number) => a + b, [], [1, 2])), []);
});

Deno.test("stdlib lazy primitives: reduce supports both arities and honors Reduced early exit", () => {
  let processed = 0;
  let emptyArity = -1;
  const total = reduce((acc: number, x: number) => acc + x, [1, 2, 3, 4]);
  const withInit = reduce((acc: number, x: number) => acc + x, 10, [1, 2, 3]);
  const empty = reduce((...args: number[]) => {
    emptyArity = args.length;
    return 0;
  }, []);
  const early = reduce((acc: number, x: number) => {
    processed++;
    const next = acc + x;
    return next > 10 ? reduced(next) : next;
  }, 0, [1, 2, 3, 4, 5, 6]);

  assertEquals(total, 10);
  assertEquals(withInit, 16);
  assertEquals(empty, 0);
  assertEquals(emptyArity, 0);
  assertEquals(early > 10, true);
  assertEquals(processed < 6, true);
});

Deno.test("stdlib lazy primitives: ArrayChunk, ChunkBuffer, and ChunkedCons provide the chunk substrate", () => {
  const chunk = arrayChunk([1, 2, 3, 4, 5], 1, 4);
  const buffer = new ChunkBuffer(3);
  buffer.add(7);
  buffer.add(8);
  buffer.add(9);
  const chunked = chunkCons(arrayChunk([1, 2, 3]), chunkCons(arrayChunk([4, 5]), null));

  assertEquals(CHUNK_SIZE, 32);
  assertEquals(chunk.count(), 3);
  assertEquals(chunk.nth(0), 2);
  assertEquals(chunk.first(), 2);
  assertEquals(chunk.dropFirst()!.toArray(), [3, 4]);
  assertEquals(buffer.isFull(), true);
  assertEquals(buffer.chunk().toArray(), [7, 8, 9]);
  assertEquals(isChunked(chunked), true);
  assertEquals([...chunked], [1, 2, 3, 4, 5]);
  assertEquals(chunked.rest().first(), 2);
});

Deno.test("stdlib lazy primitives: toChunkedSeq and chunkFirst expose chunk boundaries for arrays and ranges", () => {
  const arrayChunked = toChunkedSeq(Array.from({ length: 100 }, (_, i) => i));
  const rangeChunked = toChunkedSeq(range(100));

  assertEquals(isChunked(arrayChunked), true);
  assertEquals(chunkFirst(arrayChunked).count(), 32);
  assertEquals(chunkFirst(arrayChunked).nth(31), 31);
  assertEquals(isChunked(rangeChunked), true);
  assertEquals(chunkFirst(rangeChunked).count(), 32);
  assertEquals(chunkFirst(toChunkedSeq([1, 2, 3])).toArray(), [1, 2, 3]);
});

Deno.test("stdlib lazy primitives: chunkedMap and chunkedFilter preserve laziness at chunk granularity", () => {
  let mapped = 0;
  let filtered = 0;
  const source = Array.from({ length: 100 }, (_, i) => i);
  const doubled = chunkedMap((x: number) => {
    mapped++;
    return x * 2;
  }, source);
  const evens = chunkedFilter((x: number) => {
    filtered++;
    return x % 2 === 0;
  }, source);

  assertEquals(mapped, 0);
  assertEquals(filtered, 0);
  assertEquals(doall(take(5, doubled)), [0, 2, 4, 6, 8]);
  assertEquals(doall(take(5, evens)), [0, 2, 4, 6, 8]);
  assertEquals(mapped <= 32, true);
  assertEquals(filtered <= 64, true);
});

Deno.test("stdlib lazy primitives: chunkedReduce works on arrays and NumericRange and can stop early", () => {
  let processed = 0;
  const early = chunkedReduce((acc: number, x: number) => {
    processed++;
    const next = acc + x;
    return next > 50 ? reduced(next) : next;
  }, 0, Array.from({ length: 100 }, (_, i) => i));

  assertEquals(chunkedReduce((acc: number, x: number) => acc + x, 0, Array.from({ length: 100 }, (_, i) => i)), 4950);
  assertEquals(chunkedReduce((acc: number, x: number) => acc + x, 0, range(1, 101)), 5050);
  assertEquals(early > 50, true);
  assertEquals(processed < 100, true);
});

Deno.test("stdlib lazy primitives: chunked sequences still behave like regular seqs", () => {
  const chunked = toChunkedSeq([1, 2, 3, 4, 5, 6]);
  const transformed = chunkedFilter((x: number) => x % 4 === 0, chunkedMap((x: number) => x * 2, [1, 2, 3, 4, 5, 6]));

  assertEquals(doall(take(3, chunked)), [1, 2, 3]);
  assertEquals(doall(transformed), [4, 8, 12]);
});
