import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

async function runRuntime(code: string) {
  return await run(code, { typeCheck: false });
}

Deno.test("edge syntax: chained calls, lambda shorthand, and property traps stay distinct", async () => {
  const chained = await runRuntime(`
    (var arr [1 2 3 4 5])
    (arr.map (fn [x] (* x 2)).filter (fn [x] (> x 5)))
  `);
  assertEquals(chained, [6, 8, 10]);

  const trapped = await runRuntime(`
    (var arr [1 2 3 4 5])
    (var big? (fn [x] (> x 5)))
    (arr.filter big?)
  `);
  assertEquals(trapped, []);

  const lambda = await runRuntime(`
    [
      ((=> [x] (* x x)) 5)
      ((=> (* $0 $0)) 7)
      ((=> $0?.a?.b) {a: {b: 1}})
      ((=> $0?.a?.b) nil)
    ]
  `);
  assertEquals(lambda, [25, 49, 1, undefined]);
});

Deno.test("edge syntax: nullish coalescing only falls back for nullish values", async () => {
  const result = await run(`
    [
      (?? false "fallback")
      (?? 0 "fallback")
      (?? "" "fallback")
      (?? undefined "fallback")
      (?? nil "fallback")
    ]
  `);
  assertEquals(result, [false, 0, "", "fallback", "fallback"]);
});

Deno.test("edge syntax: property access and zero-arg method calls do not blur together", async () => {
  const result = await run(`
    (var arr [1 2 3])
    (var text "  hello  ")
    (var msg "hello")
    [arr.length (text.trim) msg.length]
  `);
  assertEquals(result, [3, "hello", 5]);
});

Deno.test("edge syntax: realistic optional and nullish pipelines preserve values", async () => {
  const result = await runRuntime(`
    (var items [{a: {b: 1}} nil {a: nil}])
    (var users [
      {name: "Alice" email: "alice@test.com"}
      {name: "Bob" email: nil}
      {name: nil email: "charlie@test.com"}
    ])
    [
      (items.map (=> $0?.a?.b))
      (users.map (fn [u] (?? u.name "anonymous")))
    ]
  `);
  assertEquals(result, [[1, undefined, undefined], ["Alice", "Bob", "anonymous"]]);
});

Deno.test("edge syntax: assignment to optional chains is rejected clearly", async () => {
  await assertRejects(
    async () => await runRuntime(`(var obj {a: {b: 1}}) (= obj?.a.b 99)`),
    Error,
    "optional chain",
  );
});

Deno.test("edge syntax: throw preserves non-Error values through catch", async () => {
  const result = await run(`
    [
      (try (throw "not-an-error") (catch e e))
      (try (throw 42) (catch e e))
    ]
  `);
  assertEquals(result, ["not-an-error", 42]);
});
