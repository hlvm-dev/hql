import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  conj,
  doall,
  empty,
  first,
  into,
  isSeq,
  LazySeq,
  seq,
} from "../../src/hql/lib/stdlib/js/index.js";

Deno.test("stdlib week3: seq handles nil, arrays, strings, and maps", () => {
  assertEquals(seq(null), null);
  assertEquals(seq([]), null);
  assertEquals(doall(seq([1, 2, 3])!), [1, 2, 3]);
  assertEquals(doall(seq("ab")!), ["a", "b"]);
  assertEquals(doall(seq(new Map([[1, 2], [3, 4]]))!), [[1, 2], [3, 4]]);
  assertEquals(isSeq(seq(new Set([1, 2]))), true);
});

Deno.test("stdlib week3: seq only realizes the first lazy element to test emptiness", () => {
  let realized = 0;
  const lazy = new LazySeq(function* () {
    realized++;
    yield 1;
    realized++;
    yield 2;
  });

  const result = seq(lazy);

  assertEquals(first(result!), 1);
  assertEquals(realized, 1);
});

Deno.test("stdlib week3: empty preserves collection shape", () => {
  assertEquals(empty([1, 2, 3]), []);
  assertEquals(empty("abc"), "");
  assertEquals(empty(new Set([1, 2])), new Set());
  assertEquals(empty(new Map([[1, 2]])), new Map());
  assertEquals(empty({ a: 1 }), {});
  assertEquals(empty(null), null);
  assertThrows(() => empty(42 as unknown as object), TypeError, "Cannot create empty collection");
});

Deno.test("stdlib week3: conj preserves target type and immutability", () => {
  const array = [1, 2];
  const set = new Set([1, 2]);
  const map = new Map([[1, 2]]);
  const object = { a: 1 };

  assertEquals(conj(array, 3), [1, 2, 3]);
  assertEquals(array, [1, 2]);
  assertEquals(conj(set, 2, 3), new Set([1, 2, 3]));
  assertEquals(conj(map, [3, 4]), new Map([[1, 2], [3, 4]]));
  assertEquals(conj(object, ["b", 2]), { a: 1, b: 2 });
  assertEquals(conj("ab", "c", "d"), "abcd");
  assertEquals(conj(null, 1, 2), [1, 2]);
});

Deno.test("stdlib week3: into pours values into collection-specific targets", () => {
  assertEquals(into([1], [2, 3]), [1, 2, 3]);
  assertEquals(into(new Set([1]), [1, 2, 2, 3]), new Set([1, 2, 3]));
  assertEquals(into(new Map(), [[1, 2], [3, 4]]), new Map([[1, 2], [3, 4]]));
  assertEquals(into({}, new Map([["a", 1], ["b", 2]])), { a: 1, b: 2 });
  assertEquals(into(null, [1, 2, 3]), [1, 2, 3]);
});
