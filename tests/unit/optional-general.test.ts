// Test ?. and ?? in general contexts — not just simple hardcoded forms
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

Deno.test("general: ?. in let binding", async () => {
  const r = await run(`(var data {user: {profile: {age: 25}}}) (let age data?.user?.profile?.age) age`);
  assertEquals(r, 25);
});

Deno.test("general: ?? in function body", async () => {
  const r = await run(`(fn greet [name] (?? name "stranger")) (greet nil)`);
  assertEquals(r, "stranger");
});

Deno.test("general: ?. chained method", async () => {
  const r = await run(`(var obj {items: [1 2 3]}) (obj?.items?.includes 2)`);
  assertEquals(r, true);
});

Deno.test("general: nested ??", async () => {
  const r = await run(`(var a nil) (var b nil) (var c "found") (?? a (?? b c))`);
  assertEquals(r, "found");
});

Deno.test("general: ?? in arrow lambda", async () => {
  const r = await run(`(var users [{name: "Alice"} {name: nil} {name: "Bob"}]) (users.map (=> (?? $0.name "unknown")))`);
  assertEquals(r, ["Alice", "unknown", "Bob"]);
});

Deno.test("general: ?. feeds into method call", async () => {
  const r = await run(`
    (var data {users: [{name: "Alice"} {name: "Bob"}]})
    (data?.users.map (fn [u] u.name))
  `);
  assertEquals(r, ["Alice", "Bob"]);
});

Deno.test("general: ?. in fn (not arrow lambda)", async () => {
  const r = await run(`(var obj nil) (fn safe-get [x] x?.name) (safe-get obj)`);
  assertEquals(r, undefined);
});

Deno.test("general: ?. combined with ?? in expression", async () => {
  const r = await run(`(var user {profile: nil}) (?? user?.profile?.name "no name")`);
  assertEquals(r, "no name");
});

Deno.test("general: ?? as default argument pattern", async () => {
  const r = await run(`(fn add [a b] (+ (?? a 0) (?? b 0))) (add nil 5)`);
  assertEquals(r, 5);
});

Deno.test("general: $0?.prop in arrow lambda (bugfix)", async () => {
  const r = await run(`
    (var items [{name: "Alice"} nil {name: "Bob"}])
    (items.map (=> $0?.name))
  `);
  assertEquals(r, ["Alice", undefined, "Bob"]);
});
