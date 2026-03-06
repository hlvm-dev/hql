import { assertEquals } from "jsr:@std/assert";
import { run } from "../../../helpers.ts";

const runRuntime = (code: string) => run(code, { typeCheck: false });

Deno.test("binding syntax: const creates immutable values and deeply frozen collections", async () => {
  const result = await runRuntime(`
    (const nums [1 2 3])
    (const person {"name": "Alice", "nested": {"value": 1}})
    (var nested (get person "nested"))
    [
      (try (do (.push nums 4) "mutation-succeeded") (catch e "mutation-failed"))
      (try (do (= person.age 30) "mutation-succeeded") (catch e "mutation-failed"))
      (try (do (= nested.value 2) "mutation-succeeded") (catch e "mutation-failed"))
    ]
  `);

  assertEquals(result, ["mutation-failed", "mutation-failed", "mutation-failed"]);
});

Deno.test("binding syntax: var and = support repeated reassignment and property updates", async () => {
  const result = await run(`
    (var counter 0)
    (var obj {"count": 0})
    (= counter (+ counter 1))
    (= counter (+ counter 1))
    (= obj.count counter)
    [counter obj.count]
  `);

  assertEquals(result, [2, 2]);
});

Deno.test("binding syntax: let and var multi-bindings evaluate expressions inside their body", async () => {
  const result = await run(`
    [
      (let (x 10 y (+ 5 5) z 30)
        (+ x y z))
      (var (a 10 b 20)
        (= a 100)
        (+ a b))
    ]
  `);

  assertEquals(result, [50, 120]);
});

Deno.test("binding syntax: scoped bindings work with nested expressions and collection access", async () => {
  const result = await run(`
    (let person {"name": "Alice"})
    (let x 10)
    (let y 20)
    [person.name (+ x y)]
  `);

  assertEquals(result, ["Alice", 30]);
});

Deno.test("binding syntax: mutable collections remain editable under var bindings", async () => {
  const result = await run(`
    (var nums [1 2 3])
    (var person {"name": "Alice"})
    (.push nums 4)
    (= person.age 30)
    [nums.length person.age]
  `);

  assertEquals(result, [4, 30]);
});

Deno.test("binding syntax: top-level helpers still work after literal brace and parenthesis bindings", async () => {
  const braceResult = await runRuntime(`
    (let msg "{")
    (doall (range 3))
  `);
  const parenResult = await runRuntime(`
    (let msg "(")
    (doall (range 2))
  `);

  assertEquals(braceResult, [0, 1, 2]);
  assertEquals(parenResult, [0, 1]);
});
