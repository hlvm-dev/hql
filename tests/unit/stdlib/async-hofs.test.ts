import { assertEquals } from "jsr:@std/assert@1";
import {
  asyncFilter,
  asyncFlatMap,
  asyncMap,
  asyncReduce,
  concurrentMap,
} from "../../../src/hql/lib/stdlib/js/core.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// asyncMap
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("asyncMap: maps async function over array", async () => {
  const result = await asyncMap(async (x: number) => x * 2, [1, 2, 3]);
  assertEquals(result, [2, 4, 6]);
});

Deno.test("asyncMap: returns empty array for null input", async () => {
  assertEquals(await asyncMap(async (x: number) => x, null as any), []);
});

Deno.test("asyncMap: processes elements sequentially", async () => {
  const order: number[] = [];
  await asyncMap(async (x: number) => {
    await new Promise((r) => setTimeout(r, (3 - x) * 10));
    order.push(x);
    return x;
  }, [1, 2, 3]);
  // Sequential: 1 finishes before 2 starts, etc.
  assertEquals(order, [1, 2, 3]);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// concurrentMap
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("concurrentMap: maps async function over array", async () => {
  const result = await concurrentMap(async (x: number) => x * 2, [1, 2, 3]);
  assertEquals(result, [2, 4, 6]);
});

Deno.test("concurrentMap: returns empty array for null input", async () => {
  assertEquals(await concurrentMap(async (x: number) => x, null as any), []);
});

Deno.test("concurrentMap: processes elements concurrently", async () => {
  const order: number[] = [];
  await concurrentMap(async (x: number) => {
    await new Promise((r) => setTimeout(r, (3 - x) * 10));
    order.push(x);
    return x;
  }, [1, 2, 3]);
  // Concurrent: 3 finishes first (shortest delay), then 2, then 1
  assertEquals(order, [3, 2, 1]);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// asyncFilter
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("asyncFilter: keeps elements matching async predicate", async () => {
  const result = await asyncFilter(
    async (x: number) => x % 2 === 0,
    [1, 2, 3, 4, 5],
  );
  assertEquals(result, [2, 4]);
});

Deno.test("asyncFilter: returns empty array for null input", async () => {
  assertEquals(await asyncFilter(async (x: number) => true, null as any), []);
});

Deno.test("asyncFilter: removes all when predicate always false", async () => {
  assertEquals(
    await asyncFilter(async () => false, [1, 2, 3]),
    [],
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// asyncReduce
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("asyncReduce: accumulates with async reducer", async () => {
  const result = await asyncReduce(
    async (acc: number, x: number) => acc + x,
    0,
    [1, 2, 3, 4],
  );
  assertEquals(result, 10);
});

Deno.test("asyncReduce: returns init for null input", async () => {
  assertEquals(
    await asyncReduce(async (acc: number, x: number) => acc + x, 42, null as any),
    42,
  );
});

Deno.test("asyncReduce: handles string concatenation", async () => {
  const result = await asyncReduce(
    async (acc: string, x: string) => acc + x,
    "",
    ["a", "b", "c"],
  );
  assertEquals(result, "abc");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// asyncFlatMap
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("asyncFlatMap: maps and flattens one level", async () => {
  const result = await asyncFlatMap(
    async (x: number) => [x, x * 10],
    [1, 2, 3],
  );
  assertEquals(result, [1, 10, 2, 20, 3, 30]);
});

Deno.test("asyncFlatMap: returns empty array for null input", async () => {
  assertEquals(await asyncFlatMap(async (x: number) => [x], null as any), []);
});

Deno.test("asyncFlatMap: handles non-array return values", async () => {
  const result = await asyncFlatMap(async (x: number) => x * 2, [1, 2, 3]);
  assertEquals(result, [2, 4, 6]);
});
