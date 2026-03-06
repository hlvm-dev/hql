import { assertEquals } from "jsr:@std/assert";
import { run } from "./helpers.ts";

Deno.test("@hlvm/string: split and join cover representative separators", async () => {
  const result = await run(`
    (import [split, join] from "@hlvm/string")
    [
      (split "a,b,c" ",")
      (split "hello-world-test" "-")
      (join ["x" "y" "z"] "-")
      (join ["hello" "world"] " ")
    ]
  `);

  assertEquals(result, [
    ["a", "b", "c"],
    ["hello", "world", "test"],
    "x-y-z",
    "hello world",
  ]);
});

Deno.test("@hlvm/string: trim, upper-case, and lower-case interoperate with imported helpers", async () => {
  const result = await run(`
    (import [trim, upper-case, lower-case] from "@hlvm/string")
    [
      (trim "  hello  ")
      (upper-case "hello")
      (lower-case "WORLD")
    ]
  `);

  assertEquals(result, ["hello", "HELLO", "world"]);
});

Deno.test("@hlvm/string: aliased and multiple imports compose with core functions", async () => {
  const result = await run(`
    (import [split as str-split, join, trim, upper-case] from "@hlvm/string")
    (var parts (str-split "  a , b , c  " ","))
    (var trimmed (doall (map trim parts)))
    [(join trimmed "-") (doall (map upper-case (str-split "hello world" " ")))]
  `);

  assertEquals(result, ["a-b-c", ["HELLO", "WORLD"]]);
});

Deno.test("@hlvm/string: prefix and suffix predicates preserve true and false cases", async () => {
  const result = await run(`
    (import [starts-with?, ends-with?] from "@hlvm/string")
    [
      (starts-with? "hello world" "hello")
      (starts-with? "hello world" "world")
      (ends-with? "hello world" "world")
      (ends-with? "hello world" "hello")
    ]
  `);

  assertEquals(result, [true, false, true, false]);
});

Deno.test("@hlvm/string: replace handles substitutions and removals", async () => {
  const result = await run(`
    (import [replace] from "@hlvm/string")
    [
      (replace "hello world" "world" "there")
      (replace "hello world" " world" "")
    ]
  `);

  assertEquals(result, ["hello there", "hello"]);
});
