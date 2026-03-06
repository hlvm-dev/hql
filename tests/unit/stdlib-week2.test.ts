import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  distinct,
  doall,
  keep,
  keepIndexed,
  mapcat,
  mapIndexed,
  take,
} from "../../src/hql/lib/stdlib/js/index.js";

Deno.test("stdlib week2: mapIndexed adds indices lazily", () => {
  let seen = 0;
  const lazy = mapIndexed((i: number, x: number) => {
    seen++;
    return [i, x * 2];
  }, [1, 2, 3, 4]);

  assertEquals(seen, 0);
  assertEquals(doall(take(2, lazy)), [[0, 2], [1, 4]]);
  assertEquals(seen, 2);
});

Deno.test("stdlib week2: keepIndexed filters nil but keeps falsy values", () => {
  const result = doall(keepIndexed((i: number, x: number) => {
    if (i === 0) return 0;
    if (i === 1) return false;
    if (x === 3) return null;
    return "";
  }, [1, 2, 3, 4]));

  assertEquals(result, [0, false, ""]);
});

Deno.test("stdlib week2: mapcat flattens one level and rejects non-iterables", () => {
  assertEquals(doall(mapcat((x: number) => [x, x * 10], [1, 2, 3])), [1, 10, 2, 20, 3, 30]);
  assertThrows(
    () => doall(mapcat(() => 42 as unknown as Iterable<number>, [1])),
    TypeError,
  );
});

Deno.test("stdlib week2: keep removes only nilish results", () => {
  const result = doall(keep((x: number) => {
    if (x === 1) return 0;
    if (x === 2) return false;
    if (x === 3) return null;
    return x * 2;
  }, [1, 2, 3, 4]));

  assertEquals(result, [0, false, 8]);
});

Deno.test("stdlib week2: distinct preserves order while deduplicating", () => {
  assertEquals(doall(distinct([1, 2, 2, 3, 1, 4])), [1, 2, 3, 4]);
});
