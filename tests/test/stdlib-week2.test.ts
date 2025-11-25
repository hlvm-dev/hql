/**
 * Week 2: Map Operations
 * Tests for mapIndexed, keepIndexed, mapcat, keep, distinct
 */

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  distinct,
  doall,
  keep,
  keepIndexed,
  mapcat,
  mapIndexed,
  take,
} from "../../src/lib/stdlib/js/index.js";

// =============================================================================
// mapIndexed(f, coll) - 10 tests
// =============================================================================

Deno.test("mapIndexed: array with index", () => {
  const result = doall(
    mapIndexed((i: number, x: number) => [i, x], [10, 20, 30]),
  );
  assertEquals(result, [[0, 10], [1, 20], [2, 30]]);
});

Deno.test("mapIndexed: use index in arithmetic", () => {
  const result = doall(
    mapIndexed((i: number, x: number) => x * i, [10, 20, 30]),
  );
  assertEquals(result, [0, 20, 60]);
});

Deno.test("mapIndexed: empty array", () => {
  const result = doall(mapIndexed((i: number, x: number) => [i, x], []));
  assertEquals(result, []);
});

Deno.test("mapIndexed: nil collection", () => {
  const result = doall(mapIndexed((i: number, x: number) => [i, x], null));
  assertEquals(result, []);
});

Deno.test("mapIndexed: single element", () => {
  const result = doall(mapIndexed((i: number, x: number) => [i, x], [42]));
  assertEquals(result, [[0, 42]]);
});

Deno.test("mapIndexed: string iteration", () => {
  const result = doall(
    mapIndexed((i: number, c: string) => c.repeat(i + 1), "abc"),
  );
  assertEquals(result, ["a", "bb", "ccc"]);
});

Deno.test("mapIndexed: LazySeq preserves laziness", () => {
  let counter = 0;
  const lazy = mapIndexed((i: number, x: number) => {
    counter++;
    return [i, x];
  }, [1, 2, 3, 4, 5]);

  // Before realization, counter should be 0
  assertEquals(counter, 0);

  // Take only 2 elements
  const result = doall(take(2, lazy));
  assertEquals(result, [[0, 1], [1, 2]]);

  // Should have realized exactly 2 elements (no peek-ahead)
  // This matches Clojure's behavior and prevents unnecessary side effects
  assertEquals(counter, 2);
});

Deno.test("mapIndexed: Set iteration order", () => {
  const s = new Set([10, 20, 30]);
  const result = doall(mapIndexed((i: number, x: number) => [i, x], s));
  assertEquals(result, [[0, 10], [1, 20], [2, 30]]);
});

Deno.test("mapIndexed: invalid function throws TypeError", () => {
  assertThrows(
    () =>
      mapIndexed(
        null as unknown as (index: number, value: number) => number,
        [1, 2, 3],
      ),
    TypeError,
    "must be a function",
  );
});

Deno.test("mapIndexed: index starts at 0 and increments", () => {
  const indices: number[] = [];
  doall(mapIndexed((i: number, x: number) => {
    indices.push(i);
    return x;
  }, [10, 20, 30, 40]));

  assertEquals(indices, [0, 1, 2, 3]);
});

// =============================================================================
// keepIndexed(f, coll) - 12 tests
// =============================================================================

Deno.test("keepIndexed: keep even indices", () => {
  const result = doall(keepIndexed(
    (i: number, x: string) => i % 2 === 0 ? x : null,
    ["a", "b", "c", "d"],
  ));
  assertEquals(result, ["a", "c"]);
});

Deno.test("keepIndexed: return indices where value > 5", () => {
  const result = doall(keepIndexed(
    (i: number, x: number) => x > 5 ? i : null,
    [1, 8, 3, 9],
  ));
  assertEquals(result, [1, 3]);
});

Deno.test("keepIndexed: all nil results", () => {
  const result = doall(keepIndexed(() => null, [1, 2, 3]));
  assertEquals(result, []);
});

Deno.test("keepIndexed: none nil results", () => {
  const result = doall(keepIndexed((_i: number, x: number) => x, [1, 2, 3]));
  assertEquals(result, [1, 2, 3]);
});

Deno.test("keepIndexed: nil collection", () => {
  const result = doall(keepIndexed((_i: number, x: number) => x, null));
  assertEquals(result, []);
});

Deno.test("keepIndexed: empty collection", () => {
  const result = doall(keepIndexed((_i: number, x: number) => x, []));
  assertEquals(result, []);
});

Deno.test("keepIndexed: undefined is filtered", () => {
  const result = doall(keepIndexed(() => undefined, [1, 2]));
  assertEquals(result, []);
});

Deno.test("keepIndexed: 0 is kept (falsy but not nil)", () => {
  const result = doall(keepIndexed(() => 0, [1, 2, 3]));
  assertEquals(result, [0, 0, 0]);
});

Deno.test("keepIndexed: false is kept (falsy but not nil)", () => {
  const result = doall(keepIndexed(() => false, [1, 2, 3]));
  assertEquals(result, [false, false, false]);
});

Deno.test("keepIndexed: empty string is kept (falsy but not nil)", () => {
  const result = doall(keepIndexed(() => "", [1, 2, 3]));
  assertEquals(result, ["", "", ""]);
});

Deno.test("keepIndexed: LazySeq preserves laziness", () => {
  let counter = 0;
  const lazy = keepIndexed((_i: number, x: number) => {
    counter++;
    return x > 2 ? x : null;
  }, [1, 2, 3, 4, 5]);

  assertEquals(counter, 0);
  const result = doall(take(2, lazy));
  // Will process until 2 non-nil results found
  assertEquals(result, [3, 4]);
});

Deno.test("keepIndexed: invalid function throws", () => {
  assertThrows(
    () =>
      keepIndexed(
        null as unknown as (index: number, value: number) => number,
        [1, 2, 3],
      ),
    TypeError,
    "must be a function",
  );
});

// =============================================================================
// mapcat(f, coll) - 10 tests
// =============================================================================

Deno.test("mapcat: basic expansion", () => {
  const result = doall(mapcat((x: number) => [x, x * 2], [1, 2, 3]));
  assertEquals(result, [1, 2, 2, 4, 3, 6]);
});

Deno.test("mapcat: variable length results", () => {
  const result = doall(mapcat((x: number) => Array(x).fill(x), [1, 2, 3]));
  assertEquals(result, [1, 2, 2, 3, 3, 3]);
});

Deno.test("mapcat: some empty results", () => {
  const result = doall(mapcat((x: number) => x > 2 ? [x] : [], [1, 2, 3, 4]));
  assertEquals(result, [3, 4]);
});

Deno.test("mapcat: all empty results", () => {
  const result = doall(mapcat(() => [], [1, 2, 3]));
  assertEquals(result, []);
});

Deno.test("mapcat: reverse nested arrays", () => {
  const result = doall(mapcat(
    (arr: number[]) => arr.reverse(),
    [[3, 2, 1], [6, 5, 4]],
  ));
  assertEquals(result, [1, 2, 3, 4, 5, 6]);
});

Deno.test("mapcat: nil collection", () => {
  const result = doall(mapcat((x: number) => [x, x], null));
  assertEquals(result, []);
});

Deno.test("mapcat: empty collection", () => {
  const result = doall(mapcat((x: number) => [x, x], []));
  assertEquals(result, []);
});

Deno.test("mapcat: function returns string (iterable)", () => {
  const result = doall(mapcat((_x: number) => "ab", [1, 2]));
  assertEquals(result, ["a", "b", "a", "b"]);
});

Deno.test("mapcat: function returns non-iterable throws", () => {
  assertThrows(
    () =>
      doall(
        mapcat(
          (_x: number) => 42 as unknown as Iterable<number>,
          [1],
        ),
      ),
    TypeError,
  );
});

Deno.test("mapcat: LazySeq preserves laziness", () => {
  let counter = 0;
  const lazy = mapcat((x: number) => {
    counter++;
    return [x, x * 2];
  }, [1, 2, 3, 4, 5]);

  assertEquals(counter, 0);
  const result = doall(take(3, lazy));
  // Should process elements until we get 3 flattened results
  // [1,2] from first element, [2,4] from second - total 4 > 3, so processes 2 elements
  assertEquals(result, [1, 2, 2]);
  assertEquals(counter, 2);
});

// =============================================================================
// keep(f, coll) - 10 tests
// =============================================================================

Deno.test("keep: keep even numbers", () => {
  const result = doall(
    keep((x: number) => x % 2 === 0 ? x : null, [1, 2, 3, 4]),
  );
  assertEquals(result, [2, 4]);
});

Deno.test("keep: transform and filter", () => {
  const result = doall(keep((x: number) => x > 2 ? x * 2 : null, [1, 2, 3, 4]));
  assertEquals(result, [6, 8]);
});

Deno.test("keep: all nil", () => {
  const result = doall(keep(() => null, [1, 2, 3]));
  assertEquals(result, []);
});

Deno.test("keep: none nil", () => {
  const result = doall(keep((x: number) => x, [1, 2, 3]));
  assertEquals(result, [1, 2, 3]);
});

Deno.test("keep: nil collection", () => {
  const result = doall(keep((x: number) => x, null));
  assertEquals(result, []);
});

Deno.test("keep: empty", () => {
  const result = doall(keep((x: number) => x, []));
  assertEquals(result, []);
});

Deno.test("keep: identity filters nil and undefined", () => {
  const result = doall(keep((x: unknown) => x, [1, null, 2, undefined, 3]));
  assertEquals(result, [1, 2, 3]);
});

Deno.test("keep: 0 is kept (falsy but not nil)", () => {
  const result = doall(keep(() => 0, [1, 2, 3]));
  assertEquals(result, [0, 0, 0]);
});

Deno.test("keep: false is kept (falsy but not nil)", () => {
  const result = doall(keep(() => false, [1, 2, 3]));
  assertEquals(result, [false, false, false]);
});

Deno.test("keep: LazySeq preserves laziness", () => {
  let counter = 0;
  const lazy = keep((x: number) => {
    counter++;
    return x > 2 ? x : null;
  }, [1, 2, 3, 4, 5]);

  assertEquals(counter, 0);
  const result = doall(take(2, lazy));
  assertEquals(result, [3, 4]);
  // Should process until 2 non-nil results found
});

// =============================================================================
// distinct(coll) - 12 tests
// =============================================================================

Deno.test("distinct: duplicate numbers", () => {
  const result = doall(distinct([1, 2, 1, 3, 2, 4]));
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("distinct: duplicate strings", () => {
  const result = doall(distinct(["a", "b", "a", "c"]));
  assertEquals(result, ["a", "b", "c"]);
});

Deno.test("distinct: no duplicates", () => {
  const result = doall(distinct([1, 2, 3]));
  assertEquals(result, [1, 2, 3]);
});

Deno.test("distinct: all duplicates", () => {
  const result = doall(distinct([1, 1, 1, 1]));
  assertEquals(result, [1]);
});

Deno.test("distinct: empty", () => {
  const result = doall(distinct([]));
  assertEquals(result, []);
});

Deno.test("distinct: nil", () => {
  const result = doall(distinct(null));
  assertEquals(result, []);
});

Deno.test("distinct: single element", () => {
  const result = doall(distinct([42]));
  assertEquals(result, [42]);
});

Deno.test("distinct: objects by reference - different objects both kept", () => {
  const result = doall(distinct([{ a: 1 }, { a: 1 }]));
  assertEquals(result.length, 2);
  assertEquals(result[0], { a: 1 });
  assertEquals(result[1], { a: 1 });
});

Deno.test("distinct: same object reference deduped", () => {
  const o = { a: 1 };
  const result = doall(distinct([o, o, o]));
  assertEquals(result.length, 1);
  assertEquals(result[0], { a: 1 });
});

Deno.test("distinct: NaN handled correctly", () => {
  const result = doall(distinct([NaN, NaN, NaN]));
  assertEquals(result.length, 1);
  assertEquals(Number.isNaN(result[0]), true);
});

Deno.test("distinct: mixed types are distinct", () => {
  const result = doall(distinct([1, "1", 1, "1"]));
  assertEquals(result, [1, "1"]);
});

Deno.test("distinct: null vs undefined are distinct", () => {
  const result = doall(distinct([null, undefined, null, undefined]));
  assertEquals(result, [null, undefined]);
});
