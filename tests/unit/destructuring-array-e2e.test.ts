import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

async function runLoose(code: string): Promise<unknown> {
  return await run(code, { typeCheck: false });
}

Deno.test("array destructuring e2e: flat patterns handle exact, extra, missing, and empty bindings", async () => {
  const result = await runLoose(`
(let [a b] [1 2])
(let [c d e] [10 20 30])
(let [extra-a extra-b] [1 2 3 4 5])
(let [missing-a missing-b missing-c] [1 2])
(let [] [1 2 3])
[(+ a b) (+ c (+ d e)) (+ extra-a extra-b) (if (=== missing-c undefined) "ok" "fail") 42]
`);

  assertEquals(result, [3, 60, 3, "ok", 42]);
});

Deno.test("array destructuring e2e: skip patterns ignore selected positions", async () => {
  const result = await runLoose(`
(let [_ keep-last] [1 2])
(let [left _ right] [1 2 3])
(let [_ _ picked] [1 2 3])
(let [_ _] [1 2])
[keep-last (+ left right) picked "ok"]
`);

  assertEquals(result, [2, 4, 3, "ok"]);
});

Deno.test("array destructuring e2e: rest patterns collect remaining values", async () => {
  const result = await runLoose(`
(let [first & rest1] [1 2 3 4])
(let [& all] [1 2 3])
(let [x y & rest2] [1 2 3 4 5])
(let [m n & rest3] [1 2])
(let [head & _] [1 2 3])
[rest1 all rest2 rest3 head]
`);

  assertEquals(result, [[2, 3, 4], [1, 2, 3], [3, 4, 5], [], 1]);
});

Deno.test("array destructuring e2e: nested patterns support depth, skips, and rest", async () => {
  const result = await runLoose(`
(let [[x y]] [[1 2]])
(let [[a b] [c d]] [[1 2] [3 4]])
(let [p [q r]] [1 [2 3]])
(let [i [j [k]]] [1 [2 [3]]])
(let [[_ keep-x] [keep-y _]] [[1 2] [3 4]])
(let [[head-x & xs] [head-y & ys]] [[1 2 3] [4 5 6]])
[(+ x y) (+ a (+ b (+ c d))) (+ p (+ q r)) (+ i (+ j k)) (+ keep-x keep-y) (+ head-x head-y)]
`);

  assertEquals(result, [3, 10, 6, 6, 5, 5]);
});

Deno.test("array destructuring e2e: var destructuring remains mutable", async () => {
  const result = await runLoose(`
(var [x y] [1 2])
(= x 10)
(var [head & rest] [1 2 3])
(= head 100)
[(+ x y) head rest]
`);

  assertEquals(result, [12, 100, [2, 3]]);
});

Deno.test("array destructuring e2e: complex expressions can supply the right-hand side", async () => {
  const result = await runLoose(`
(fn make-pair [a b]
  [a b])
(let [x y] (make-pair 10 20))
(let [sum-x sum-y] [(+ 1 2) (* 3 4)])
(let [if-x if-y] (if true [1 2] [3 4]))
[(+ x y) (+ sum-x sum-y) (+ if-x if-y)]
`);

  assertEquals(result, [30, 15, 3]);
});

Deno.test("array destructuring e2e: strings and mixed values bind without coercion", async () => {
  const result = await runLoose(`
(let [greeting target] ["hello" "world"])
(let [num str bool] [42 "test" true])
[greeting (if bool num str)]
`);

  assertEquals(result, ["hello", 42]);
});
