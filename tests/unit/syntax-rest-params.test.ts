import { assertEquals } from "jsr:@std/assert";
import { run } from "./helpers.ts";

const runRuntime = (code: string) => run(code, { typeCheck: false });

Deno.test("rest params: rest-only functions collect and reduce variadic arguments", async () => {
  const result = await run(`
    (fn sum [...nums]
      [nums (.reduce nums (fn [acc val] (+ acc val)) 0)])
    (sum 1 2 3 4 5)
  `);

  assertEquals(result, [[1, 2, 3, 4, 5], 15]);
});

Deno.test("rest params: fixed parameters preserve head values and empty rest", async () => {
  const result = await run(`
    (fn summarize [x y ...rest]
      [x y rest (+ x y (get rest "length"))])
    [(summarize 10 20 1 2) (summarize 10 20)]
  `);

  assertEquals(result, [
    [10, 20, [1, 2], 32],
    [10, 20, [], 30],
  ]);
});

Deno.test("rest params: collected args behave like arrays for indexing, length, and map", async () => {
  const result = await run(`
    (fn inspect [...items]
      [(get items 1) (get items "length") (.map items (fn [x] (* x 2)))])
    (inspect 1 2 3)
  `);

  assertEquals(result, [2, 3, [2, 4, 6]]);
});

Deno.test("rest params: destructuring and default placeholders compose with rest", async () => {
  const result = await runRuntime(`
    (fn destructured [[a b] ...rest]
      (+ a b (.reduce rest (fn [acc x] (+ acc x)) 0)))
    (fn defaulted [x = 5 ...rest]
      (+ x (.reduce rest (fn [acc val] (+ acc val)) 0)))
    [(destructured [5 10] 1 2 3) (defaulted 10 1 2 3) (defaulted _ 1 2 3)]
  `);

  assertEquals(result, [21, 16, 11]);
});

Deno.test("rest params: arrow functions support fixed and variadic parameters", async () => {
  const result = await run(`
    (let multiply (=> (factor ...nums)
      (.map nums (fn [x] (* factor x)))))
    (multiply 3 1 2 3)
  `);

  assertEquals(result, [3, 6, 9]);
});

Deno.test("rest params: rest arguments can be forwarded and closed over", async () => {
  const result = await runRuntime(`
    (fn sum [...nums]
      (.reduce nums (fn [acc x] (+ acc x)) 0))
    (fn average [...values]
      (/ (sum ...values) (get values "length")))
    (fn makeAdder [x]
      (fn [...nums]
        (+ x (sum ...nums))))
    (let add5 (makeAdder 5))
    [(average 10 20 30) (add5 1 2 3)]
  `);

  assertEquals(result, [20, 11]);
});
