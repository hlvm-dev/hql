import { assertEquals } from "jsr:@std/assert";
import { run } from "../../../helpers.ts";

const runRuntime = (code: string) => run(code, { typeCheck: false });

Deno.test("LoopSyntax: loop/recur supports accumulator-style recursion inside functions", async () => {
  const result = await run(`
(fn sum-to [n]
  (loop [i 1 acc 0]
    (if (<= i n)
      (recur (+ i 1) (+ acc i))
      acc)))
(sum-to 100)
`);

  assertEquals(result, 5050);
});

Deno.test("LoopSyntax: loop/recur handles nested conditionals with value and recur branches", async () => {
  const result = await run(`
(var nums [1, 3, 5, 8, 9, 12])
(loop [i 0]
  (if (< i nums.length)
    (if (=== (% (get nums i) 2) 0)
      (get nums i)
      (recur (+ i 1)))
    nil))
`);

  assertEquals(result, 8);
});

Deno.test("LoopSyntax: loop supports empty binding vectors", async () => {
  const result = await run(`
(var counter 0)
(loop []
  (if (< counter 3)
    (do
      (= counter (+ counter 1))
      (recur))
    counter))
`);

  assertEquals(result, 3);
});

Deno.test("LoopSyntax: nested loops compose side effects correctly", async () => {
  const result = await run(`
(var total 0)
(loop [i 1]
  (if (<= i 3)
    (do
      (loop [j 1]
        (if (<= j 3)
          (do
            (= total (+ total (* i j)))
            (recur (+ j 1)))
          nil))
      (recur (+ i 1)))
    total))
`);

  assertEquals(result, 36);
});

Deno.test("LoopSyntax: while supports mutation and early termination", async () => {
  const result = await run(`
(var i 0)
(var found false)
(var nums [1, 3, 5, 7, 8, 9])
(while (and (< i nums.length) (not found))
  (if (=== (% (get nums i) 2) 0)
    (= found true)
    nil)
  (= i (+ i 1)))
i
`);

  assertEquals(result, 5);
});

Deno.test("LoopSyntax: repeat repeats multi-expression bodies", async () => {
  const result = await run(`
(var output [])
(repeat 2
  (.push output "first")
  (.push output "second"))
output
`);

  assertEquals(result, ["first", "second", "first", "second"]);
});

Deno.test("LoopSyntax: for supports positional and named numeric ranges", async () => {
  const result = await runRuntime(`
(var stepped [])
(for [i 0 10 2]
  (.push stepped i))
(var named [])
(for [j from: 5 to: 8]
  (.push named j))
[stepped named]
`);

  assertEquals(result, [[0, 2, 4, 6, 8], [5, 6, 7]]);
});

Deno.test("LoopSyntax: for iterates collections element-wise", async () => {
  const result = await runRuntime(`
(var doubled [])
(for [x [1 2 3]]
  (.push doubled (* x 2)))
doubled
`);

  assertEquals(result, [2, 4, 6]);
});
