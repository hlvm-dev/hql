import { assertEquals } from "jsr:@std/assert";
import { run } from "./helpers.ts";

const runRuntime = (code: string) => run(code, { typeCheck: false });

Deno.test("object destructuring: direct bindings ignore property order, extras, and missing keys", async () => {
  const ordered = await runRuntime(`
    (let {x y} {x: 1 y: 2})
    (+ x y)
  `);
  const reordered = await runRuntime(`
    (let {b a} {a: 1 b: 2 z: 3})
    (+ a b)
  `);
  const missing = await runRuntime(`
    (let {x y z} {x: 1 y: 2})
    (if (=== z undefined) "ok" "fail")
  `);

  assertEquals(ordered, 3);
  assertEquals(reordered, 3);
  assertEquals(missing, "ok");
});

Deno.test("object destructuring: aliases compose with direct bindings", async () => {
  const renamed = await runRuntime(`
    (let {x: newX} {x: 42})
    newX
  `);
  const multiple = await runRuntime(`
    (let {a: x b: y} {a: 1 b: 2})
    (+ x y)
  `);
  const mixed = await runRuntime(`
    (let {a x: y} {a: 10 x: 20})
    (+ a y)
  `);

  assertEquals(renamed, 42);
  assertEquals(multiple, 3);
  assertEquals(mixed, 30);
});

Deno.test("object destructuring: nested object and mixed object-array patterns bind deeply", async () => {
  const nested = await runRuntime(`
    (let {data: {x y}} {data: {x: 10 y: 20}})
    (+ x y)
  `);
  const deep = await runRuntime(`
    (let {outer: {middle: {inner}}} {outer: {middle: {inner: 42}}})
    inner
  `);
  const objectWithArray = await runRuntime(`
    (let {nums: [a b]} {nums: [1 2]})
    (+ a b)
  `);
  const arrayWithObject = await runRuntime(`
    (let [{x y}] [{x: 1 y: 2}])
    (+ x y)
  `);

  assertEquals(nested, 30);
  assertEquals(deep, 42);
  assertEquals(objectWithArray, 3);
  assertEquals(arrayWithObject, 3);
});

Deno.test("object destructuring: var bindings stay mutable after destructuring", async () => {
  const result = await runRuntime(`
    (var {x y} {x: 1 y: 2})
    (= x 10)
    (+ x y)
  `);

  assertEquals(result, 12);
});

Deno.test("object destructuring: destructured sources can come from function calls and expressions", async () => {
  const fromFunction = await runRuntime(`
    (fn make-point [a b]
      {x: a y: b})
    (let {x y} (make-point 10 20))
    (+ x y)
  `);
  const fromExpressions = await runRuntime(`
    (let {x y} {x: (+ 1 2) y: (* 3 4)})
    (+ x y)
  `);

  assertEquals(fromFunction, 30);
  assertEquals(fromExpressions, 15);
});
