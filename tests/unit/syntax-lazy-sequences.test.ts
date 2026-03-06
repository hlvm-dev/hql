import { assertEquals, assertExists } from "jsr:@std/assert@1";

const stdlibPath =
  new URL("../../src/hql/lib/stdlib/js/stdlib.js", import.meta.url).pathname;
const {
  LazySeq,
  concat,
  distinct,
  doall,
  drop,
  filter,
  flatten,
  isSeq,
  lazySeq,
  map,
  rangeGenerator,
  realized,
  reduce,
  take,
} = await import(stdlibPath);

const corePath =
  new URL("../../src/hql/lib/stdlib/js/core.js", import.meta.url).pathname;
const { first, rest } = await import(corePath);

const selfHostedPath =
  new URL("../../src/hql/lib/stdlib/js/self-hosted.js", import.meta.url).pathname;
const { nth } = await import(selfHostedPath);

Deno.test("lazy sequences: LazySeq memoizes thunk execution and random access", () => {
  let computeCount = 0;
  const seq = new LazySeq(function* () {
    for (let i = 0; i < 5; i++) {
      computeCount++;
      yield i * 2;
    }
  });

  first(seq);
  assertEquals(computeCount, 1);
  first(rest(seq));
  assertEquals(computeCount, 2);
  nth(seq, 2);
  assertEquals(computeCount, 3);
  nth(seq, 1);
  assertEquals(computeCount, 3);
});

Deno.test("lazy sequences: take is lazy, seq-like, and works on arrays and null", () => {
  let iterations = 0;
  const input = lazySeq(function* () {
    for (let i = 0; i < 1_000_000; i++) {
      iterations++;
      yield i;
    }
  });

  const taken = take(5, input);
  assertExists(taken);
  assertEquals(isSeq(taken) || taken instanceof LazySeq, true);
  assertEquals(iterations, 0);
  assertEquals(Array.from(taken), [0, 1, 2, 3, 4]);
  assertEquals(iterations <= 6, true);
  assertEquals(Array.from(take(3, [10, 20, 30, 40])), [10, 20, 30]);
  assertEquals(Array.from(take(5, null)), []);
});

Deno.test("lazy sequences: map, filter, and drop stay lazy until consumed", () => {
  let mapCount = 0;
  let filterCount = 0;
  let dropCount = 0;

  const mapInput = lazySeq(function* () {
    for (let i = 0; i < 100; i++) yield i;
  });
  const mapped = map((x: number) => {
    mapCount++;
    return x * 2;
  }, mapInput);
  assertEquals(isSeq(mapped), true);
  assertEquals(mapCount, 0);
  assertEquals(Array.from(take(3, mapped)), [0, 2, 4]);
  assertEquals(mapCount <= 4, true);

  const filterInput = lazySeq(function* () {
    for (let i = 0; i < 100; i++) yield i;
  });
  const filtered = filter((x: number) => {
    filterCount++;
    return x % 2 === 0;
  }, filterInput);
  assertEquals(isSeq(filtered), true);
  assertEquals(Array.from(take(3, filtered)), [0, 2, 4]);
  assertEquals(filterCount <= 10, true);

  const dropInput = lazySeq(function* () {
    for (let i = 0; i < 100; i++) {
      dropCount++;
      yield i;
    }
  });
  const dropped = drop(5, dropInput);
  assertEquals(Array.from(take(3, dropped)), [5, 6, 7]);
  assertEquals(dropCount <= 10, true);
});

Deno.test("lazy sequences: reduce and doall eagerly realize their entire input", () => {
  let reduceCount = 0;
  const reduceInput = lazySeq(function* () {
    for (let i = 0; i < 10; i++) {
      reduceCount++;
      yield i;
    }
  });

  assertEquals(reduce((acc: number, x: number) => acc + x, 0, reduceInput), 45);
  assertEquals(reduceCount, 10);

  let doallCount = 0;
  const doallInput = lazySeq(function* () {
    for (let i = 0; i < 5; i++) {
      doallCount++;
      yield i;
    }
  });

  assertEquals(doall(doallInput), [0, 1, 2, 3, 4]);
  assertEquals(doallCount, 5);
  assertEquals(reduce((acc: number, x: number) => acc + x, 100, null), 100);
});

Deno.test("lazy sequences: concat, flatten, and distinct return seqs with expected realized content", () => {
  const concatenated = concat([1, 2], [3, 4], [5, 6]);
  const flattened = flatten([[1, 2], [3, 4], 5, [6]]);
  const deduped = distinct(lazySeq(function* () {
    yield* [1, 2, 2, 3, 3, 4];
  }));

  assertEquals(isSeq(concatenated), true);
  assertEquals(isSeq(flattened), true);
  assertEquals(Array.from(concatenated), [1, 2, 3, 4, 5, 6]);
  assertEquals(Array.from(flattened), [1, 2, 3, 4, 5, 6]);
  assertEquals(Array.from(deduped), [1, 2, 3, 4]);
});

Deno.test("lazy sequences: toString previews large or infinite sequences and realized tracks exhaustion", () => {
  const finite = lazySeq(function* () {
    yield 1;
    yield 2;
    yield 3;
  });
  assertEquals(realized(finite), false);
  assertEquals(finite.toString(), "(1 2 3)");
  Array.from(finite);
  assertEquals(realized(finite), true);

  let previewCount = 0;
  const preview = lazySeq(function* () {
    for (let i = 0; i < 100; i++) {
      previewCount++;
      yield i;
    }
  });
  const previewText = preview.toString();
  assertEquals(previewText.includes("..."), true);
  assertEquals(previewCount >= 20, true);
  assertEquals(previewCount <= 22, true);

  const infinite = rangeGenerator(0, Infinity);
  const start = Date.now();
  const infiniteText = infinite.toString();
  assertEquals(Date.now() - start < 1000, true);
  assertEquals(infiniteText.includes("..."), true);
});

Deno.test("lazy sequences: rangeGenerator supports finite, infinite, and stepped signatures", () => {
  assertEquals(doall(take(5, rangeGenerator())), [0, 1, 2, 3, 4]);
  assertEquals(doall(rangeGenerator(5)), [0, 1, 2, 3, 4]);
  assertEquals(doall(rangeGenerator(5, 10)), [5, 6, 7, 8, 9]);
  assertEquals(doall(rangeGenerator(0, 10, 2)), [0, 2, 4, 6, 8]);
  assertEquals(doall(take(5, rangeGenerator(undefined, undefined, -1))), [0, -1, -2, -3, -4]);
  assertEquals(doall(take(5, rangeGenerator(100, Infinity))), [100, 101, 102, 103, 104]);
});
