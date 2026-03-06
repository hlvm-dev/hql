import { assertEquals } from "jsr:@std/assert";
import { run } from "./helpers.ts";

// Runtime coverage only: current type-checking still lags some match-pattern forms.
const runPattern = (code: string) => run(code, { typeCheck: false });

Deno.test("Pattern Matching - literal clauses and default fallback", async () => {
  const result = await runPattern(`
    (fn classify [value]
      (match value
        (case 42 "forty-two")
        (case "hello" "greeting")
        (case true "yes")
        (case null "nothing")
        (default "other")))
    [
      (classify 42)
      (classify "hello")
      (classify true)
      (classify null)
      (classify 100)
    ]
  `);

  assertEquals(result, ["forty-two", "greeting", "yes", "nothing", "other"]);
});

Deno.test("Pattern Matching - symbol binding and wildcard fallback", async () => {
  const result = await runPattern(`
    [
      (match "test"
        (case 42 "number")
        (case s (+ "value: " s)))
      (match 999
        (case 1 "one")
        (case 2 "two")
        (case _ "other"))
    ]
  `);

  assertEquals(result, ["value: test", "other"]);
});

Deno.test("Pattern Matching - array patterns cover empty fixed and rest forms", async () => {
  const result = await runPattern(`
    (fn describe-value [value]
      (match value
        (case [] "empty")
        (case [x] (+ "one: " x))
        (case [a, b] (+ a b))
        (case [h, & t] [h t])
        (default "not array")))
    [
      (describe-value [])
      (describe-value [42])
      (describe-value [1, 2])
      (describe-value [10, 20, 30])
      (describe-value "oops")
    ]
  `);

  assertEquals(result, ["empty", "one: 42", 3, [10, [20, 30]], "not array"]);
});

Deno.test("Pattern Matching - object and nested patterns bind structured values", async () => {
  const result = await runPattern(`
    (fn inspect [value]
      (match value
        (case {name: n, coords: [x, y]} [n (+ x y)])
        (case [[a, b], [c, d]] (+ a b c d))
        (default "no match")))
    [
      (inspect {"name": "Alice", "coords": [10, 20]})
      (inspect [[1, 2], [3, 4]])
      (inspect [1, 2, 3])
    ]
  `);

  assertEquals(result, [["Alice", 30], 10, "no match"]);
});

Deno.test("Pattern Matching - guards control clause selection", async () => {
  const result = await runPattern(`
    (fn classify [value]
      (match value
        (case x (if (> x 0)) "positive")
        (case x (if (< x 0)) "negative")
        (default "zero")))
    [
      (classify 10)
      (classify -5)
      (classify 0)
      (match [5, 3]
        (case [a, b] (if (> a b)) "a > b")
        (case [a, b] (if (< a b)) "a < b")
        (default "a = b"))
    ]
  `);

  assertEquals(result, ["positive", "negative", "zero", "a > b"]);
});

Deno.test("Pattern Matching - recursive destructuring handles list traversal", async () => {
  const result = await runPattern(`
    (fn sum [lst]
      (match lst
        (case [] 0)
        (case [h, & t] (+ h (sum t)))))
    (sum [1, 2, 3, 4, 5])
  `);

  assertEquals(result, 15);
});

Deno.test("Pattern Matching - or-patterns share one clause across alternatives", async () => {
  const result = await runPattern(`
    (fn classify [value]
      (match value
        (case (| 1 2 3) "small")
        (case (| "yes" "y" "Y") true)
        (case (| null undefined) "nothing")
        (default "other")))
    [
      (classify 2)
      (classify "yes")
      (classify null)
      (classify 99)
    ]
  `);

  assertEquals(result, ["small", true, "nothing", "other"]);
});

Deno.test("Pattern Matching - unmatched errors include the original value", async () => {
  const result = await runPattern(`
    (try
      (match 42
        (case 1 "one")
        (case 2 "two"))
      (catch e (js-get e "message")))
  `);

  assertEquals(typeof result, "string");
  assertEquals((result as string).includes("42"), true);
});
