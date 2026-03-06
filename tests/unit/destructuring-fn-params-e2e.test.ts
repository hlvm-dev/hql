import { assertEquals } from "jsr:@std/assert";
import { run } from "./helpers.ts";

const runRuntime = (code: string) => run(code, { typeCheck: false });

Deno.test("function parameter destructuring: basic positional array patterns bind element values", async () => {
  const result = await runRuntime(`
    (fn add [[a b]] (+ a b))
    (fn sum3 [[x y z]] (+ x (+ y z)))
    (fn identity [[x]] x)
    [(add [1 2]) (sum3 [10 20 30]) (identity [42])]
  `);

  assertEquals(result, [3, 60, 42]);
});

Deno.test("function parameter destructuring: skip and rest markers bind only the intended values", async () => {
  const result = await runRuntime(`
    (fn pick-second [[_ y]] y)
    (fn skip-middle [[x _ z]] (+ x z))
    (fn first-and-rest [[x & rest]] rest)
    (fn all-elements [[& all]] all)
    [(pick-second [1 2]) (skip-middle [1 2 3]) (first-and-rest [1 2 3 4]) (all-elements [1 2 3])]
  `);

  assertEquals(result, [2, 4, [2, 3, 4], [1, 2, 3]]);
});

Deno.test("function parameter destructuring: nested patterns work at multiple depths", async () => {
  const result = await runRuntime(`
    (fn add-nested [[[a b]]] (+ a b))
    (fn deep [[[a [b c]]]] (+ a (+ b c)))
    [(add-nested [[1 2]]) (deep [[1 [2 3]]])]
  `);

  assertEquals(result, [3, 6]);
});

Deno.test("function parameter destructuring: destructured params can mix with normal params and multiple arrays", async () => {
  const result = await runRuntime(`
    (fn mixed [x [y z]] (+ x (+ y z)))
    (fn mixed2 [[a b] c] (+ a (+ b c)))
    (fn mixed3 [x [y z] w] (+ x (+ y (+ z w))))
    (fn two-arrays [[a b] [c d]] (+ a (+ b (+ c d))))
    [(mixed 1 [2 3]) (mixed2 [1 2] 3) (mixed3 1 [2 3] 4) (two-arrays [1 2] [3 4])]
  `);

  assertEquals(result, [6, 6, 10, 10]);
});

Deno.test("function parameter destructuring: anonymous functions support the same patterns", async () => {
  const result = await runRuntime(`
    (let f (fn [[x y]] (+ x y)))
    [ (f [5 10]) ((fn [[a b]] (* a b)) [3 4]) ]
  `);

  assertEquals(result, [15, 12]);
});
