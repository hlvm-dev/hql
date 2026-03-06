import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

Deno.test("template literals: preserve plain strings including empty and whitespace", async () => {
  const result = await run('[`hello world` `` `  spaces around  `]');
  assertEquals(result, ["hello world", "", "  spaces around  "]);
});

Deno.test("template literals: support interpolation at any position and consecutively", async () => {
  const result = await run('[`${10} apples` `I have ${5} apples` `Total: ${42}` `${10}${20}`]');
  assertEquals(result, ["10 apples", "I have 5 apples", "Total: 42", "1020"]);
});

Deno.test("template literals: evaluate nested expressions, variables, and function calls", async () => {
  const result = await run(`
    (let name "Alice")
    (let age 30)
    (fn add [a b] (+ a b))
    [
      ` + '`${(* (+ 2 3) 4)}`' + `
      ` + '`${name} is ${age} years old`' + `
      ` + '`${(add 2 3)} * ${(add 4 5)} = ${(* (add 2 3) (add 4 5))}`' + `
    ]
  `);

  assertEquals(result, ["20", "Alice is 30 years old", "5 * 9 = 45"]);
});

Deno.test("template literals: honor escape sequences", async () => {
  const result = await run('[`This is a \\` backtick` `Price: \\$100` `Line 1\\nLine 2` `Col1\\tCol2` `Path: C:\\\\Users`]');
  assertEquals(result, [
    "This is a ` backtick",
    "Price: $100",
    "Line 1\nLine 2",
    "Col1\tCol2",
    "Path: C:\\Users",
  ]);
});

Deno.test("template literals: interpolate control flow and data access expressions", async () => {
  const result = await run(`
    (let arr [10 20 30])
    (let obj {"name": "Bob" "age": 25})
    [
      ` + '`Status: ${(? true "active" "inactive")}`' + `
      ` + '`Second element: ${(get arr 1)}`' + `
      ` + '`Name: ${(get obj "name")}`' + `
    ]
  `);

  assertEquals(result, ["Status: active", "Second element: 20", "Name: Bob"]);
});

Deno.test("template literals: compose with functions, bindings, arrays, and objects", async () => {
  const result = await run(`
    (fn greet [name] ` + '`Hello, ${name}!`' + `)
    (let x 10)
    (let message ` + '`Value is ${x}`' + `)
    (let arr [` + '`first`' + ` ` + '`second ${2}`' + ` ` + '`third`' + `])
    (let obj {"greeting": ` + '`Hello World`' + `})
    [
      (greet "World")
      message
      (get arr 1)
      (get obj "greeting")
    ]
  `);

  assertEquals(result, ["Hello, World!", "Value is 10", "second 2", "Hello World"]);
});
