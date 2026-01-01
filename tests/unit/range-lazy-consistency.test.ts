/**
 * Range Lazy Consistency Tests
 *
 * Verifies that __hql_range (used by transpiler) returns lazy sequences
 * and behaves consistently with stdlib range.
 */

import { assertEquals } from "jsr:@std/assert";
import hql from "../../mod.ts";

Deno.test("Range Lazy Consistency", async (t) => {
  await t.step("(range 5) returns LazySeq (verified from JS)", async () => {
    const result = await hql.run(`(range 5)`);

    // Verify from JavaScript side (HQL's js-get doesn't expose constructor.name)
    // NumericRange is a specialized lazy sequence for numeric ranges
    const name = result?.constructor?.name;
    const isLazyType = name === "LazySeq" || name === "NumericRange";
    assertEquals(isLazyType, true, `Direct range should return LazySeq or NumericRange, got ${name}`);
    assertEquals(Array.isArray(result), false, "Should not be an Array");
  });

  await t.step("(range 5) produces correct values when forced", async () => {
    const result = await hql.run(`(doall (range 5))`) as any;
    assertEquals(result, [0, 1, 2, 3, 4]);
  });

  await t.step("Indirect call returns LazySeq (verified from JS)", async () => {
    const result = await hql.run(`(do (var f range) (f 5))`);

    // NumericRange is a specialized lazy sequence for numeric ranges
    const name = result?.constructor?.name;
    const isLazyType = name === "LazySeq" || name === "NumericRange";
    assertEquals(isLazyType, true, `Indirect range should return LazySeq or NumericRange, got ${name}`);
    assertEquals(Array.isArray(result), false, "Should not be an Array");
  });

  await t.step("__hql_range returns LazySeq (verified from JS)", async () => {
    const result = await hql.run(`(__hql_range 5)`);

    // NumericRange is a specialized lazy sequence for numeric ranges
    const name = result?.constructor?.name;
    const isLazyType = name === "LazySeq" || name === "NumericRange";
    assertEquals(isLazyType, true, `__hql_range should return LazySeq or NumericRange, got ${name}`);
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
    // Use generous threshold (1 second) to avoid flaky tests on slow CI
    // If range were eager, 10M elements would take 10+ seconds, not < 1 second
    assertEquals(
      elapsed < 1000,
      true,
      `Creating 10M range should be fast if lazy, took ${elapsed.toFixed(2)}ms`,
    );
  });

  await t.step("Transpiled code uses range stdlib function", async () => {
    // Use 2-arg form to get proper function call syntax
    const transpiled = await hql.transpile("(range 0 5)");
    const code = typeof transpiled === "string" ? transpiled : transpiled.code;

    // range is now a stdlib function, not a special form
    // Should compile to range(0, 5) function call
    assertEquals(
      code.includes("range(0, 5)") || code.includes("range(0,5)"),
      true,
      "Transpiler should call range as a stdlib function",
    );

    // __hql_range should NOT appear (no longer a special form)
    assertEquals(
      code.includes("__hql_range"),
      false,
      "Transpiled output should NOT include __hql_range special form",
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
