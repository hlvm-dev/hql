import { assertEquals } from "jsr:@std/assert";
import { run } from "../../../helpers.ts";

Deno.test("DataStructure: vectors support mixed values, nesting, indexed access, length, and mutation", async () => {
  const result = await run(`
(var v [1, "hello", true, [3, 4]])
(v.push 5)
[(get v 1) (get (get v 3) 0) v.length v]
`);

  assertEquals(result, ["hello", 3, 5, [1, "hello", true, [3, 4], 5]]);
});

Deno.test("DataStructure: maps support nested access, mutation, and numeric string keys", async () => {
  const result = await run(`
(var m {"user": {"name": "Bob", "id": 123}, "0": "zero"})
(= m.newProp "added")
[(get (get m "user") "name") (get m "0") (get m "newProp")]
`);

  assertEquals(result, ["Bob", "zero", "added"]);
});

Deno.test("DataStructure: sets deduplicate values and expose membership checks", async () => {
  const result = await run(`
(var s #[1, 2, 2, 3, 3, 3])
[s.size (s.has 2) (s.has 9)]
`);

  assertEquals(result, [3, true, false]);
});

Deno.test("DataStructure: get composes across maps and vectors and supports missing-key fallbacks", async () => {
  const result = await run(`
(var data {"users": [{"name": "Alice"}, {"name": "Bob"}]})
(var profile {"name": "Alice"})
[(get (get (get data "users") 1) "name")
 (if (get profile "age")
   (get profile "age")
   "default-age")]
`);

  assertEquals(result, ["Bob", "default-age"]);
});

Deno.test("DataStructure: collection methods map, filter, and reduce vectors", async () => {
  const result = await run(`
(var numbers [1, 2, 3, 4, 5, 6])
[(numbers.map (fn [n] (* n 2)))
 (numbers.filter (fn [n] (> n 3)))
 (numbers.reduce (fn [acc n] (+ acc n)) 0)]
`);

  assertEquals(result, [[2, 4, 6, 8, 10, 12], [4, 5, 6], 21]);
});
