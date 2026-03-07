import { assertEquals } from "jsr:@std/assert";
import { run } from "./helpers.ts";

async function runRuntime(code: string) {
  return await run(code, { typeCheck: false });
}

Deno.test("deep freeze: const recursively freezes nested objects, arrays, and destructured values", async () => {
  const result = await runRuntime(`
    [
      (try
        (do
          (const nested {"outer": {"inner": 42}})
          (var outer (get nested "outer"))
          (= outer.inner 100)
          false)
        (catch e true))
      (try
        (do
          (const arr [[1 2] [3 4]])
          (.push (get arr 0) 999)
          false)
        (catch e true))
      (try
        (do
          (const [a] [{"x": 1}])
          (= a.x 2)
          false)
        (catch e true))
      (try
        (do
          (const {x} {"x": {"nested": 42}})
          (= x.nested 100)
          false)
        (catch e true))
    ]
  `);
  assertEquals(result, [true, true, true, true]);
});

Deno.test("deep freeze: const preserves reads and exposes frozen nested references", async () => {
  const result = await runRuntime(`
    (const data {"level1": {"level2": {"level3": "deep value"}}})
    (const arr [{"a": 1} {"b": 2}])
    [
      (get (get (get data "level1") "level2") "level3")
      (js-call Object "isFrozen" (get data "level1"))
      (js-call Object "isFrozen" (get arr 0))
    ]
  `);
  assertEquals(result, ["deep value", true, true]);
});

Deno.test("deep freeze: var bindings stay mutable where const bindings do not", async () => {
  const result = await runRuntime(`
    [
      (try
        (do
          (const arr [1 2 3])
          (.push arr 4)
          false)
        (catch e true))
      (do
        (var mutable {"nested": {"value": 10}})
        (var nested (get mutable "nested"))
        (= nested.value 20)
        nested.value)
    ]
  `);
  assertEquals(result, [true, 20]);
});
