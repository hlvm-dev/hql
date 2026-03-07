import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

async function runRuntime(code: string) {
  return await run(code, { typeCheck: false });
}

Deno.test("optional general: optional chaining works in let bindings, regular functions, and method chains", async () => {
  const result = await runRuntime(`
    (var data {user: {profile: {age: 25}}})
    (var obj {items: [1 2 3]})
    (fn safe-get [x] x?.name)
    [
      (let age data?.user?.profile?.age)
      (obj?.items?.includes 2)
      (safe-get nil)
      (do
        (var source {users: [{name: "Alice"} {name: "Bob"}]})
        (source?.users.map (fn [u] u.name)))
    ]
  `);
  assertEquals(result, [25, true, undefined, ["Alice", "Bob"]]);
});

Deno.test("optional general: nullish coalescing works in nested expressions, functions, and lambdas", async () => {
  const result = await runRuntime(`
    (fn greet [name] (?? name "stranger"))
    (fn add [a b] (+ (?? a 0) (?? b 0)))
    (var users [{name: "Alice"} {name: nil} {name: "Bob"}])
    (var a nil)
    (var b nil)
    (var c "found")
    [
      (greet nil)
      (?? a (?? b c))
      (users.map (=> (?? $0.name "unknown")))
      (add nil 5)
    ]
  `);
  assertEquals(result, ["stranger", "found", ["Alice", "unknown", "Bob"], 5]);
});

Deno.test("optional general: optional chaining and nullish coalescing compose cleanly", async () => {
  const result = await runRuntime(`
    (var user {profile: nil})
    (var items [{name: "Alice"} nil {name: "Bob"}])
    [
      (?? user?.profile?.name "no name")
      (items.map (=> $0?.name))
    ]
  `);
  assertEquals(result, ["no name", ["Alice", undefined, "Bob"]]);
});
