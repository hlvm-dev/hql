// @ts-nocheck: Testing HQL package integration
import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("math interop: absolute and rounding functions preserve JS Math semantics", async () => {
  const result = await run(`
    [
      (js/Math.abs 5)
      (js/Math.abs -42)
      (js/Math.floor 3.7)
      (js/Math.floor -2.3)
      (js/Math.ceil 3.2)
      (js/Math.ceil -2.7)
      (js/Math.round 3.7)
      (js/Math.round 3.2)
    ]
  `);
  assertEquals(result, [5, 42, 3, -3, 4, -2, 4, 3]);
});

Deno.test("math interop: min and max handle mixed positive and negative inputs", async () => {
  const result = await run(`
    [
      (js/Math.min 5 2 8 1 9)
      (js/Math.min -3 0 5 2)
      (js/Math.max 5 2 8 1 9)
      (js/Math.max -5 -2 -8 -1)
    ]
  `);
  assertEquals(result, [1, -3, 9, -1]);
});

Deno.test("math interop: multiple operations compose in normal HQL programs", async () => {
  const result = await run(`
    (var a (js/Math.abs -5))
    (var b (js/Math.floor 3.7))
    (var c (js/Math.ceil 2.1))
    [a b c]
  `);
  assertEquals(result, [5, 3, 3]);
});
