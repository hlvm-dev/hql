import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

Deno.test("ternary: rejects arity mismatches", async () => {
  for (const code of ['(? true "yes")', '(? true "yes" "no" "extra")', '(?)']) {
    await assertRejects(
      async () => await run(code),
      Error,
      "? requires exactly 3 arguments",
    );
  }
});

Deno.test("ternary: selects then or else branch from boolean conditions", async () => {
  const result = await run('[ (? true "yes" "no") (? false "yes" "no") (? (> 5 3) "greater" "lesser") ]');
  assertEquals(result, ["yes", "no", "greater"]);
});

Deno.test("ternary: treats canonical falsy values as false", async () => {
  const result = await run('[ (? false "then" "else") (? 0 "then" "else") (? "" "then" "else") (? null "then" "else") (? undefined "then" "else") ]');
  assertEquals(result, ["else", "else", "else", "else", "else"]);
});

Deno.test("ternary: composes inside nested and surrounding expressions", async () => {
  const result = await run(`
    (let x 15)
    [
      (? true (? true "A" "B") "C")
      (? false "A" (? true "B" "C"))
      (? (< x 0) "negative"
        (? (== x 0) "zero"
          (? (< x 10) "small" "large")))
      (* (? (> 5 3) 2 3) (? (< 1 2) 4 5))
      (+ 10 (? true 5 3))
    ]
  `);
  assertEquals(result, ["A", "B", "large", 8, 15]);
});

Deno.test("ternary: works in function returns and with branch expressions", async () => {
  const result = await run(`
    (fn double [x] (* x 2))
    (fn triple [x] (* x 3))
    (fn classify [x] (? (> x 0) "positive" "negative"))
    [
      (? true (double 5) (triple 5))
      (classify 10)
    ]
  `);
  assertEquals(result, [10, "positive"]);
});

Deno.test("ternary: returns branch values without coercing arrays objects null or undefined", async () => {
  const result = await run(`
    [
      (? true [1 2 3] [4 5 6])
      (? false {"a": 1} {"b": 2})
      (? true null "value")
      (? false "value" null)
      (? true undefined "value")
    ]
  `);
  assertEquals(result, [[1, 2, 3], { b: 2 }, null, null, undefined]);
});

Deno.test("ternary: evaluates only the selected branch", async () => {
  const result = await run(`
    (var counter 0)
    (fn increment [] (= counter (+ counter 1)) counter)
    [
      (? true (increment) (increment))
      counter
      (? false (increment) (increment))
      counter
    ]
  `);
  assertEquals(result, [1, 1, 2, 2]);
});
