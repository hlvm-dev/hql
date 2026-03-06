import { assertEquals } from "jsr:@std/assert";
import { run } from "../../../helpers.ts";

Deno.test("macro syntax: quote preserves literals and list structure without evaluation", async () => {
  const result = await run(`
    [(quote x) (quote null) (quote ()) (quote (a (b c) d))]
  `);

  assertEquals(result, ["x", "null", [], ["a", ["b", "c"], "d"]]);
});

Deno.test("macro syntax: quasiquote interpolates unquote and unquote-splicing", async () => {
  const result = await run(`
    (var x 10)
    (var nums [1 2 3])
    (quasiquote (a (unquote x) (unquote-splicing nums) z))
  `);

  assertEquals(result, ["a", 10, 1, 2, 3, "z"]);
});

Deno.test("macro syntax: backtick shorthand supports ~ and ~@", async () => {
  const result = await run(`
    (var x 42)
    (var items ["apple" "banana"])
    [` + "`" + `(result ~x) ` + "`" + `(fruits ~@items)]
  `);

  assertEquals(result, [["result", 42], ["fruits", "apple", "banana"]]);
});

Deno.test("macro syntax: macros built with quasiquote and unquote expand correctly", async () => {
  const result = await run(`
    (macro when [condition body]
      ` + "`" + `(if ~condition ~body null))
    (var x 10)
    (when (> x 5) "x is greater than 5")
  `);

  assertEquals(result, "x is greater than 5");
});

Deno.test("macro syntax: variadic macro bodies splice forms into the expansion", async () => {
  const result = await run(`
    (macro do-all [items]
      ` + "`" + `(do ~@items))
    (do-all ((var a 1) (var b 2) (+ a b)))
  `);

  assertEquals(result, 3);
});
