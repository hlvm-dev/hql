import { assertEquals } from "jsr:@std/assert";
import { evalHql, transpile } from "./helpers.ts";

Deno.test("ThreadingMacros: -> threads values through symbol and list forms as the first argument", async () => {
  const result = await evalHql(`
    (fn bump [x] (+ x 1))
    (-> 5 bump (- 2) bump)
  `);

  assertEquals(result, 5);
});

Deno.test("ThreadingMacros: ->> threads values as the last argument and differs from -> when order matters", async () => {
  const threadFirst = await evalHql(`(-> 10 (- 3))`);
  const threadLast = await evalHql(`(->> 10 (- 3))`);
  const division = await evalHql(`(->> 100 (/ 10) (/ 2))`);

  assertEquals(threadFirst, 7);
  assertEquals(threadLast, -7);
  assertEquals(division, 20);
});

Deno.test("ThreadingMacros: as-> supports arbitrary placement and shadows outer bindings correctly", async () => {
  const result = await evalHql(`
    (let [x 100]
      (as-> 5 x (+ x 1) (- 10 x) (* x 2)))
  `);

  assertEquals(result, 8);
});

Deno.test("ThreadingMacros: nested threading macros compose predictably", async () => {
  const result = await evalHql(`
    (->> 5
      (+ (-> 2 (* 3)))
      (* 2))
  `);

  assertEquals(result, 22);
});

Deno.test("ThreadingMacros: transpilation erases macro syntax and preserves thread-first nesting", async () => {
  const js = await transpile(`(-> 1 (+ 2) (* 3))`);

  assertEquals(js.includes("->"), false);
  assertEquals(js.includes("(1 + 2) * 3"), true, `Expected nested structure, got: ${js}`);
});

Deno.test("ThreadingMacros: transpilation erases macro syntax and preserves thread-last nesting", async () => {
  const js = await transpile(`(->> 1 (+ 2) (* 3))`);

  assertEquals(js.includes("->>"), false);
  assertEquals(js.includes("3 * (2 + 1)"), true, `Expected nested structure, got: ${js}`);
});
