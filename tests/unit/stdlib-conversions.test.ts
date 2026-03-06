import { assert, assertEquals } from "jsr:@std/assert";
import { set, vec } from "../../src/hql/lib/stdlib/js/index.js";

Deno.test("stdlib conversions: vec copies arrays without aliasing the source", () => {
  const original = [1, 2, 3];
  const result = vec(original);

  assertEquals(result, [1, 2, 3]);
  assert(result !== original);

  result.push(4);
  assertEquals(original, [1, 2, 3]);
});

Deno.test("stdlib conversions: vec materializes representative iterable inputs", () => {
  const iterable = {
    *[Symbol.iterator]() {
      yield "a";
      yield "b";
      yield "c";
    },
  };

  assertEquals(vec(new Set([1, 2, 3])), [1, 2, 3]);
  assertEquals(vec(new Map([["a", 1], ["b", 2]])), [["a", 1], ["b", 2]]);
  assertEquals(vec("hello"), ["h", "e", "l", "l", "o"]);
  assertEquals(vec(iterable), ["a", "b", "c"]);
});

Deno.test("stdlib conversions: vec handles lazy sequences and nil inputs", async () => {
  const { LazySeq } = await import(
    "../../src/hql/lib/stdlib/js/internal/seq-protocol.js"
  );
  const lazy = new LazySeq(function* () {
    yield 1;
    yield 2;
    yield 3;
  });

  assertEquals(vec(lazy), [1, 2, 3]);
  assertEquals(vec(null), []);
  assertEquals(vec(undefined), []);
});

Deno.test("stdlib conversions: set deduplicates arrays and copies existing sets", () => {
  const original = new Set([1, 2, 3]);
  const deduped = set([1, 2, 2, 3, 3]);
  const copied = set(original);

  assertEquals([...deduped], [1, 2, 3]);
  assertEquals([...copied], [1, 2, 3]);
  assert(copied !== original);

  copied.add(4);
  assertEquals([...original], [1, 2, 3]);
});

Deno.test("stdlib conversions: set supports strings, iterables, object identity, and nil", () => {
  const iterable = {
    *[Symbol.iterator]() {
      yield "a";
      yield "b";
      yield "a";
    },
  };
  const obj = { id: 1 };

  assertEquals([...set("hello")], ["h", "e", "l", "o"]);
  assertEquals([...set(iterable)], ["a", "b"]);
  assertEquals(set([obj, obj]).size, 1);
  assert(set([obj, obj]).has(obj));
  assertEquals(set(null).size, 0);
  assertEquals(set(undefined).size, 0);
});
