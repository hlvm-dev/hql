import { assertEquals, assertThrows } from "jsr:@std/assert@1";

const seqProtocol = await import("../../../src/hql/lib/stdlib/js/internal/seq-protocol.js");
const {
  lazySeq,
  cons,
  EMPTY,
  SEQ,
  toSeq,
  toChunkedSeq,
  isCons,
  isArraySeq,
  isChunked,
  isCounted,
  isIndexed,
  count: foundationCount,
  nth: foundationNth,
} = seqProtocol;

const {
  map,
  filter,
  reduce,
  take,
} = await import("../../../src/hql/lib/stdlib/js/self-hosted.js");

const seqTag = SEQ as symbol;

function first(coll: unknown): unknown {
  if (coll == null) return undefined;
  if ((coll as Record<PropertyKey, unknown>)[seqTag]) return (coll as { first(): unknown }).first();
  if (Array.isArray(coll)) return coll[0];
  for (const item of coll as Iterable<unknown>) return item;
  return undefined;
}

function rest(coll: unknown): Iterable<unknown> {
  if (coll == null) return EMPTY;
  if ((coll as Record<PropertyKey, unknown>)[seqTag]) return (coll as { rest(): Iterable<unknown> }).rest();
  const seq = toSeq(coll);
  return seq ? seq.rest() : EMPTY;
}

function next(coll: unknown): Iterable<unknown> | null {
  if (coll == null) return null;
  const seq = (coll as Record<PropertyKey, unknown>)[seqTag]
    ? coll as { rest(): { seq(): Iterable<unknown> | null } }
    : toSeq(coll);
  if (seq == null) return null;
  return seq.rest().seq();
}

function seq(coll: unknown): Iterable<unknown> | null {
  if (coll == null) return null;
  return (coll as Record<PropertyKey, unknown>)[seqTag]
    ? (coll as { seq(): Iterable<unknown> | null }).seq()
    : toSeq(coll);
}

Deno.test("foundation lazy-seq: LazySeq memoizes realization and preserves undefined values", () => {
  let realized = 0;
  const s = lazySeq(() => {
    realized++;
    return cons(1, lazySeq(() => {
      realized++;
      return cons(undefined, lazySeq(() => cons(3, null)));
    }));
  });

  assertEquals(realized, 0);
  assertEquals(s.first(), 1);
  assertEquals(realized, 1);
  assertEquals(s.first(), 1);
  assertEquals(realized, 1);
  assertEquals(s.rest().first(), undefined);
  assertEquals(realized, 2);
  assertEquals([...s], [1, undefined, 3]);
  assertEquals(realized, 2);
});

Deno.test("foundation lazy-seq: empty lazy sequences collapse to null/EMPTY semantics", () => {
  const empty = lazySeq(() => null);

  assertEquals(empty.seq(), null);
  assertEquals(empty.first(), undefined);
  assertEquals([...empty], []);
  assertEquals([...rest(empty)], []);
  assertEquals(next(empty), null);
  assertEquals([...EMPTY], []);
  assertEquals(EMPTY.rest(), EMPTY);
});

Deno.test("foundation lazy-seq: cons builds stable seq-compatible lists", () => {
  const cell = cons(1, cons(2, cons(3, null)));

  assertEquals(isCons(cell), true);
  assertEquals(first(cell), 1);
  assertEquals([...cell], [1, 2, 3]);
  assertEquals([...rest(cell)], [2, 3]);
});

Deno.test("foundation lazy-seq: first/rest/next/seq handle arrays, null, and undefined elements", () => {
  const withUndefined = [undefined, 1, 2];
  const lazyUndefined = lazySeq(() => cons(undefined, lazySeq(() => cons(1, null))));

  assertEquals(first([1, 2, 3]), 1);
  assertEquals(first([]), undefined);
  assertEquals(first(null), undefined);
  assertEquals(first(withUndefined), undefined);
  assertEquals([...rest([1, 2, 3])], [2, 3]);
  assertEquals([...rest(null)], []);
  assertEquals([...rest([1, undefined, 3])], [undefined, 3]);
  assertEquals([...next([1, 2, 3])!], [2, 3]);
  assertEquals(next([1]), null);
  assertEquals(seq([]), null);
  assertEquals(first(seq(withUndefined)!), undefined);
  assertEquals(first(seq(lazyUndefined)!), undefined);
});

Deno.test("foundation lazy-seq: foundation count and nth cover counted/indexed and boundary behavior", () => {
  const arraySeq = toSeq([1, undefined, 3, 4]);

  assertEquals(foundationCount(null), 0);
  assertEquals(foundationCount([1, 2, 3]), 3);
  assertEquals(foundationCount("hello"), 5);
  assertEquals(foundationCount(arraySeq), 4);
  assertEquals(foundationNth([10, 20, 30], 2), 30);
  assertEquals(foundationNth(arraySeq, 1), undefined);
  assertEquals(foundationNth(arraySeq, 99, "missing"), "missing");
  assertEquals(foundationNth([1, 2, 3], -1, "missing"), "missing");
  assertThrows(() => foundationNth([1, 2, 3], 99));
  assertThrows(() => foundationNth(null, 0));
});

Deno.test("foundation lazy-seq: ArraySeq keeps counted/indexed O(1) behavior after rest", () => {
  let current = toSeq(Array.from({ length: 1000 }, (_, i) => i));

  assertEquals(isArraySeq(current), true);
  assertEquals(isCounted(current), true);
  assertEquals(isIndexed(current), true);

  for (let i = 0; i < 500; i++) {
    current = current.rest();
  }

  assertEquals(isArraySeq(current), true);
  assertEquals(current.first(), 500);
  assertEquals(current.count(), 500);
  assertEquals(current.nth(0), 500);
  assertEquals(current.nth(499), 999);
});

Deno.test("foundation lazy-seq: lazy sequences realize only demanded elements", () => {
  let realized = 0;
  const counting = (n: number): Iterable<number> =>
    lazySeq(() => {
      realized++;
      return cons(n, counting(n + 1));
    });

  assertEquals([...take(5, counting(1))], [1, 2, 3, 4, 5]);
  assertEquals(realized, 5);
});

Deno.test("foundation lazy-seq: first forces exactly one lazy element", () => {
  let realized = 0;
  const counting = (n: number): Iterable<number> =>
    lazySeq(() => {
      realized++;
      return cons(n, counting(n + 1));
    });

  assertEquals(first(counting(1)), 1);
  assertEquals(realized, 1);
});

Deno.test("foundation lazy-seq: trampolining handles deep lazy recursion", () => {
  const naturalNumbers = (n: number): Iterable<number> =>
    lazySeq(() => cons(n, naturalNumbers(n + 1)));

  assertEquals(reduce((acc: number, value: number) => acc + value, 0, take(10000, naturalNumbers(1))), 50005000);
});

Deno.test("foundation lazy-seq: repeated rest chains do not blow the stack", () => {
  let current = toSeq(Array.from({ length: 2000 }, (_, i) => i));

  for (let i = 0; i < 1000; i++) {
    current = current.rest();
  }

  assertEquals(current.first(), 1000);
});

Deno.test("foundation lazy-seq: chunked conversion marks large arrays as chunked", () => {
  const chunked = toChunkedSeq(Array.from({ length: 100 }, (_, i) => i));

  assertEquals(isChunked(chunked), true);
  assertEquals(chunked.chunkFirst().count() > 0, true);
  assertEquals(chunked.chunkFirst().nth(0), 0);
});

Deno.test("foundation lazy-seq: representative chunked pipelines stay chunked and compute correctly", () => {
  const source = Array.from({ length: 100 }, (_, i) => i);
  const mapped = map((x: number) => x * 2, source);
  const filtered = filter((x: number) => x % 4 === 0, mapped);

  assertEquals(isChunked(mapped), true);
  assertEquals(isChunked(filtered), true);
  assertEquals(reduce((acc: number, x: number) => acc + x, 0, filtered), 4900);
  assertEquals([...take(5, filtered)], [0, 4, 8, 12, 16]);
});

Deno.test("foundation lazy-seq: generator-based LazySeq stays unchunked and lazy", () => {
  let realized = 0;
  const generatorSeq = lazySeq(function* () {
    while (true) {
      realized++;
      yield realized;
    }
  });

  assertEquals(isChunked(generatorSeq), false);
  assertEquals(realized, 0);
  assertEquals([...take(5, generatorSeq)], [1, 2, 3, 4, 5]);
  assertEquals(realized, 5);
});
