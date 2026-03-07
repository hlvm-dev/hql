import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

async function runRuntime(code: string) {
  return await run(code, { typeCheck: false });
}

Deno.test("destructuring defaults: array defaults apply only when values are missing or undefined", async () => {
  const result = await runRuntime(`
    [
      (do
        (let [x (= 10)] [])
        x)
      (do
        (let [x (= 10)] [5])
        x)
      (do
        (let [x (= 1) y (= 2)] [])
        (+ x y))
      (do
        (let [x (= 1) y (= 2)] [10])
        (+ x y))
      (do
        (let [a b (= 20) c] [1 undefined 3])
        (+ a (+ b c)))
    ]
  `);
  assertEquals(result, [10, 5, 3, 12, 24]);
});

Deno.test("destructuring defaults: defaults can be expressions and nested array patterns", async () => {
  const result = await runRuntime(`
    [
      (do
        (let [x (= (+ 5 5))] [])
        x)
      (do
        (let [[a b] (= [1 2])] [])
        (+ a b))
      (do
        (let [[a b] (= [1 2])] [[10 20]])
        (+ a b))
      (do
        (let [[a (= 1)] (= [undefined])] [])
        a)
      (do
        (let [x [[y (= 5)]]] [10 [[undefined]]])
        (+ x y))
    ]
  `);
  assertEquals(result, [10, 3, 30, 1, 15]);
});

Deno.test("destructuring defaults: var destructuring keeps defaults and later mutation working together", async () => {
  const result = await runRuntime(`
    (var [x (= 5) y (= 10)] [])
    (= x 20)
    (+ x y)
  `);
  assertEquals(result, 30);
});
