import { assertEquals } from "jsr:@std/assert";
import hql from "../../mod.ts";

Deno.test("macro edge cases: nested macro calls inside arguments expand recursively", async () => {
  const result = await hql.run(`
    (macro dec1 [x] (- x 1))
    (dec1 (dec1 (dec1 10)))
  `);

  assertEquals(result, 7);
});

Deno.test("macro edge cases: recursive macros keep expanding until the base case", async () => {
  const result = await hql.run(`
    (macro factorial [n]
      (if (<= n 1)
        1
        (* n (factorial (- n 1)))))
    (factorial 5)
  `);

  assertEquals(result, 120);
});

Deno.test("macro edge cases: deep macro chains preserve expansion order", async () => {
  const result = await hql.run(`
    (macro l1 [x] (+ x 1))
    (macro l2 [x] (l1 (l1 x)))
    (macro l3 [x] (l2 (l2 x)))
    (macro l4 [x] (l3 (l3 x)))
    (macro l5 [x] (l4 (l4 x)))
    (l5 0)
  `);

  assertEquals(result, 16);
});

Deno.test("macro edge cases: compile-time macros work inside chained let bindings", async () => {
  const result = await hql.run(`
    (macro inc [x] (+ x 1))
    (macro dec [x] (- x 1))
    (let [a (inc 5)
          b (dec a)
          c (inc (inc b))]
      [a b c])
  `);

  assertEquals(result, [6, 5, 7]);
});

Deno.test("macro edge cases: macros can invoke other macros from their expansion bodies", async () => {
  const result = await hql.run(`
    (macro square [x] (* x x))
    (macro quad [x] (square (square x)))
    (quad 2)
  `);

  assertEquals(result, 16);
});

Deno.test("macro edge cases: macro conditionals and arithmetic can return heterogeneous values", async () => {
  const result = await hql.run(`
    (macro type-test [val]
      (cond
        ((< val 0) "negative")
        ((=== val 0) 0)
        ((> val 10) true)
        (true val)))
    [(type-test -5) (type-test 0) (type-test 100) (type-test 5)]
  `);

  assertEquals(result, ["negative", 0, true, 5]);
});
