import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("map ops: get and getIn cover existing, missing, nil, and nested array lookup", async () => {
  const result = await run(`
    [
      (get {"a": 1, "b": 2} "a")
      (get {"a": 1} "b" "default")
      (get {"a": 1} "b")
      (get nil "x" "default")
      (getIn {"user": {"name": "Alice", "age": 30}} ["user" "name"])
      (getIn {"user": {"name": "Alice"}} ["user" "age"] 25)
      (getIn {"items": ["a" "b" "c"]} ["items" 1])
    ]
  `);

  assertEquals(result, [1, "default", undefined, "default", "Alice", 25, "b"]);
});

Deno.test("map ops: assoc and assocIn add, update, and create nested containers", async () => {
  const result = await run(`
    [
      (assoc {"a": 1} "b" 2)
      (assoc {"a": 1, "b": 2} "a" 10)
      (assoc nil "a" 1)
      (assoc {} 0 "zero")
      (assocIn {"user": {"name": "Alice", "age": 30}} ["user" "age"] 31)
      (assocIn {} ["user" "name"] "Bob")
      (assocIn {} ["items" 0] "first")
    ]
  `);

  assertEquals(result, [
    { a: 1, b: 2 },
    { a: 10, b: 2 },
    { a: 1 },
    { "0": "zero" },
    { user: { name: "Alice", age: 31 } },
    { user: { name: "Bob" } },
    { items: ["first"] },
  ]);
});

Deno.test("map ops: dissoc removes keys from objects, arrays, and Maps", async () => {
  const result = await run(`
    [
      (dissoc {"a": 1, "b": 2, "c": 3} "b")
      (dissoc {"a": 1, "b": 2, "c": 3, "d": 4} "b" "d")
      (dissoc nil "a")
      (dissoc [10 20 30] 1)
      (let [m (js-new Map)]
        (js-call m "set" "a" 1)
        (js-call m "set" "b" 2)
        (js-call m "set" "c" 3)
        (let [r (dissoc m "b")]
          [(js-call r "has" "a") (js-call r "has" "b") (js-get r "size")]))
    ]
  `);

  assertEquals(result[0], { a: 1, c: 3 });
  assertEquals(result[1], { a: 1, c: 3 });
  assertEquals(result[2], {});
  assertEquals(result[3][0], 10);
  assertEquals(result[3][1], undefined);
  assertEquals(result[3][2], 30);
  assertEquals(result[4], [true, false, 2]);
});

Deno.test("map ops: update and updateIn transform existing and missing values", async () => {
  const result = await run(`
    [
      (update {"count": 5} "count" inc)
      (update {"a": 1} "b" (fn [x] (+ (if (isNil x) 0 x) 10)))
      (updateIn {"user": {"age": 30}} ["user" "age"] inc)
      (updateIn {} ["user" "age"] (fn [x] (+ (if (isNil x) 0 x) 1)))
    ]
  `);

  assertEquals(result, [
    { count: 6 },
    { a: 1, b: 10 },
    { user: { age: 31 } },
    { user: { age: 1 } },
  ]);
});

Deno.test("map ops: merge ignores nil and gives later maps precedence", async () => {
  const result = await run(`
    [
      (merge {"a": 1} {"b": 2})
      (merge {"a": 1, "b": 2} {"b": 3, "c": 4})
      (merge {"a": 1} nil {"b": 2})
    ]
  `);

  assertEquals(result, [
    { a: 1, b: 2 },
    { a: 1, b: 3, c: 4 },
    { a: 1, b: 2 },
  ]);
});

Deno.test("map ops: hash-map enforces even arity", async () => {
  const ok = await run(`(hash-map "a" 1 "b" 2)`);
  assertEquals(ok, { a: 1, b: 2 });

  await assertRejects(
    async () => await run(`(hash-map "a" 1 "b")`),
    Error,
    "even number",
  );
});
