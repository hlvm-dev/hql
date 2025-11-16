/**
 * Range Lazy Consistency Tests
 *
 * Verifies that __hql_range (used by transpiler) returns lazy sequences
 * and behaves consistently with stdlib range.
 */

import { assertEquals } from "jsr:@std/assert";
import hql from "../mod.ts";

Deno.test("Range Lazy Consistency", async (t) => {
  await t.step("(range 5) returns LazySeq (verified from JS)", async () => {
    const result = await hql.run(`(range 5)`);

    // Verify from JavaScript side (HQL's js-get doesn't expose constructor.name)
    assertEquals(result?.constructor?.name, "LazySeq", "Direct range should return LazySeq");
    assertEquals(Array.isArray(result), false, "Should not be an Array");
  });

  await t.step("(range 5) produces correct values when forced", async () => {
    const result = await hql.run(`(doall (range 5))`) as any;
    assertEquals(result, [0, 1, 2, 3, 4]);
  });

  await t.step("Indirect call returns LazySeq (verified from JS)", async () => {
    const result = await hql.run(`(do (var f range) (f 5))`);

    assertEquals(result?.constructor?.name, "LazySeq", "Indirect range should return LazySeq");
    assertEquals(Array.isArray(result), false, "Should not be an Array");
  });

  await t.step("__hql_range returns LazySeq (verified from JS)", async () => {
    const result = await hql.run(`(__hql_range 5)`);

    assertEquals(result?.constructor?.name, "LazySeq", "__hql_range should return LazySeq");
    assertEquals(Array.isArray(result), false, "Should not be an Array");
  });

  await t.step("All implementations produce identical results", async () => {
    const direct = await hql.run(`(doall (range 10))`) as any;
    const indirect = await hql.run(`(doall (do (var f range) (f 10)))`) as any;
    const helper = await hql.run(`(doall (__hql_range 10))`) as any;
    const stdlib = await hql.run(`(doall (js-call globalThis "range" 10))`) as any;

    const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    assertEquals(direct, expected, "Direct (range 10) should match");
    assertEquals(indirect, expected, "Indirect call should match");
    assertEquals(helper, expected, "__hql_range should match");
    assertEquals(stdlib, expected, "Stdlib range should match");
  });

  await t.step("Range with start and end", async () => {
    const result = await hql.run(`(doall (range 5 10))`) as any;
    assertEquals(result, [5, 6, 7, 8, 9]);
  });

  await t.step("Range with start, end, and step", async () => {
    const result = await hql.run(`(doall (range 0 10 2))`) as any;
    assertEquals(result, [0, 2, 4, 6, 8]);
  });

  await t.step("Range with negative step", async () => {
    const result = await hql.run(`(doall (range 10 0 -2))`) as any;
    assertEquals(result, [10, 8, 6, 4, 2]);
  });

  await t.step("Infinite range - take first 10", async () => {
    const result = await hql.run(`(doall (take 10 (range)))`) as any;
    assertEquals(result, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  await t.step("Laziness verified - only compute what's needed", async () => {
    const result = await hql.run(`
      (do
        (var sideEffects [])
        (var r (map
          (=> (do
            (js-call sideEffects "push" $0)
            (* $0 2)))
          (range 1000000)))
        (var first3 (doall (take 3 r)))
        (hash-map
          "first3" first3
          "sideEffectsCount" (js-get sideEffects "length")))
    `) as any;

    assertEquals(result.first3, [0, 2, 4]);
    assertEquals(
      result.sideEffectsCount,
      3,
      "Should only execute 3 times, not 1000000",
    );
  });

  await t.step("Large range is fast (lazy)", async () => {
    const startTime = performance.now();
    const result = await hql.run(`(doall (take 5 (range 10000000)))`) as any;
    const elapsed = performance.now() - startTime;

    assertEquals(result, [0, 1, 2, 3, 4]);
    assertEquals(
      elapsed < 100,
      true,
      `Creating 10M range should be instant, took ${elapsed.toFixed(2)}ms`,
    );
  });

  await t.step("Transpiled code uses lazy range", async () => {
    const transpiled = await hql.transpile("(range 5)");
    const code = typeof transpiled === "string" ? transpiled : transpiled.code;

    // Verify transpiler still uses __hql_range
    assertEquals(
      code.includes("__hql_range"),
      true,
      "Transpiler should use __hql_range",
    );

    // Verify __hql_range function is included in output
    assertEquals(
      code.includes("function __hql_range"),
      true,
      "Transpiled output should include __hql_range function",
    );
  });

  await t.step("Range composition with map/filter/take", async () => {
    const result = await hql.run(`
      (doall
        (take 5
          (filter (=> (=== (% $0 2) 0))
            (map (=> (* $0 3))
              (range 20)))))
    `) as any;

    assertEquals(result, [0, 6, 12, 18, 24]);
  });

  await t.step("Nested range usage", async () => {
    const result = await hql.run(`
      (doall
        (map (=> (doall (range $0)))
          (range 1 4)))
    `) as any;

    assertEquals(result, [[0], [0, 1], [0, 1, 2]]);
  });
});
