import { assertEquals } from "jsr:@std/assert";
import { run } from "./helpers.ts";

const runRuntime = (code: string) => run(code, { typeCheck: false });

Deno.test("property syntax: dot notation reads nested object and collection properties", async () => {
  const result = await run(`
    (var user {"profile": {"name": "Bob"}, "tags": [1 2 3]})
    [user.profile.name user.tags.length]
  `);

  assertEquals(result, ["Bob", 3]);
});

Deno.test("property syntax: get handles dynamic object keys and numeric indexes", async () => {
  const result = await run(`
    (var obj {"x": 10, "items": ["a" "b" "c"]})
    (var key "x")
    (var idx 2)
    [(get obj key) (get (get obj "items") idx)]
  `);

  assertEquals(result, [10, "c"]);
});

Deno.test("property syntax: property methods support arguments and in-place mutation", async () => {
  const result = await runRuntime(`
    (var nums [1 2 3])
    (var textValue "Hello")
    [(textValue.charAt 1) (nums.push 4) nums]
  `);

  assertEquals(result, ["e", 4, [1, 2, 3, 4]]);
});

Deno.test("property syntax: chained calls work across strings and collections", async () => {
  const result = await run(`
    (var text "  HELLO  ")
    (var nums [1 2 3 4 5])
    (var doubled (nums.map (fn [n] (* n 2))))
    [((text.trim).toLowerCase) (doubled.filter (fn [n] (> n 5)))]
  `);

  assertEquals(result, ["hello", [6, 8, 10]]);
});

Deno.test("property syntax: class instances expose fields and methods through dot access", async () => {
  const result = await runRuntime(`
    (class Calculator
      (constructor (base)
        (= this.base base))

      (fn add [x]
        (+ this.base x)))

    (var calc (new Calculator 10))
    [calc.base (calc.add 5)]
  `);

  assertEquals(result, [10, 15]);
});

Deno.test("property syntax: assignment updates existing properties and adds new ones", async () => {
  const result = await run(`
    (var obj {"count": 0})
    (= obj.count 42)
    (= obj.label "done")
    [obj.count obj.label]
  `);

  assertEquals(result, [42, "done"]);
});
