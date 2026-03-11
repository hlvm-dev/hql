import { assertEquals } from "jsr:@std/assert";
import { run } from "../../../helpers.ts";

Deno.test("conditional: if chooses the correct branch for literals and expressions", async () => {
  const result = await run(`
    (var a 5)
    (var b 3)
    (var c 10)
    [
      (if true 1 2)
      (if false 1 2)
      (if (> a b) "yes" "no")
      (if (=== a a) "equal" "not equal")
      (if (!= a b) "not equal" "equal")
      (if (<= a a) "yes" "no")
      (if (>= c a) "yes" "no")
    ]
  `);
  assertEquals(result, [1, 2, "yes", "equal", "not equal", "yes", "yes"]);
});

Deno.test("conditional: branches stay expression-oriented inside do, let, and functions", async () => {
  const result = await run(`
    (fn check [n]
      (if (> n 0) "positive" "non-positive"))

    [
      (if true
        (do
          (var x 10)
          (+ x 5))
        (do
          (var y 20)
          (- y 5)))
      (if true
        (if false 1 2)
        3)
      (let result (if (< 3 5) "less" "greater"))
      (check 5)
    ]
  `);
  assertEquals(result, [15, 2, "less", "positive"]);
});

Deno.test("conditional: cond picks the first matching clause and falls back to default", async () => {
  const result = await run(`
    (let x 10)
    [
      (cond
        ((< 5 3) "case1")
        ((> 5 3) "case2")
        (true "case3"))
      (cond
        ((< 5 3) "won't match")
        (true "default"))
      (cond
        ((< x 5) "small")
        ((< x 15) "medium")
        (true "large"))
    ]
  `);
  assertEquals(result, ["case2", "default", "medium"]);
});
