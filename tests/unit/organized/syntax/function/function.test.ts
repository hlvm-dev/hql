import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { run, transpile } from "../../../helpers.ts";

Deno.test("Function: named and anonymous functions execute correctly", async () => {
  const named = await run(`
    (fn add [a b] (+ a b))
    (add 3 5)
  `);
  const anonymous = await run(`
    (let square (fn [x] (* x x)))
    (square 6)
  `);

  assertEquals(named, 8);
  assertEquals(anonymous, 36);
});

Deno.test("Function: closures and higher-order calls retain captured values", async () => {
  const result = await run(`
    (fn make-adder [n]
      (fn [x] (+ x n)))
    (fn apply-fn [f x] (f x))
    (let add5 (make-adder 5))
    (apply-fn add5 10)
  `);
  assertEquals(result, 15);
});

Deno.test("Function: recursive function computes expected result", async () => {
  const result = await run(`
    (fn factorial [n]
      (if (<= n 1)
        1
        (* n (factorial (- n 1)))))
    (factorial 5)
  `);
  assertEquals(result, 120);
});

Deno.test("Function: default parameters and placeholders resolve correctly", async () => {
  const result = await run(`
    (fn multiply [x = 10 y = 20]
      (* x y))
    (multiply _ 7)
  `);
  assertEquals(result, 70);
});

Deno.test("Function: rest parameters collect remaining arguments", async () => {
  const result = await run(`
    (fn sum [x y & rest]
      (+ x y (.reduce rest (fn [acc val] (+ acc val)) 0)))
    (sum 10 20 1 2 3)
  `);
  assertEquals(result, 36);
});

Deno.test("Function: JSON-style map parameters bind defaults and overrides", async () => {
  const result = await run(`
    (fn connect {"host": "localhost", "port": 8080, "ssl": false}
      (if ssl
        (+ "https://" host ":" port)
        (+ "http://" host ":" port)))
    (connect {"ssl": true, "port": 443, "host": "example.com"})
  `);
  assertEquals(result, "https://example.com:443");
});

Deno.test("Function: syntax flexibility accepts mixed map styles and comma-separated params", async () => {
  const mixedMap = await run(`
    (fn add {x: 0, "y": 0}
      (+ x y))
    (add {x: 10 "y": 20})
  `);
  const commaParams = await run(`
    (fn sum [x, y z]
      (+ x y z))
    (sum 10, 20 30)
  `);

  assertEquals(mixedMap, 30);
  assertEquals(commaParams, 60);
});

Deno.test("Function: explicit return exits early", async () => {
  const result = await run(`
    (fn early-exit [x]
      (return 42)
      (+ x 100))
    (early-exit 5)
  `);
  assertEquals(result, 42);
});

Deno.test("Function: return inside inner function does not abort outer function", async () => {
  const result = await run(`
    (fn outer [x]
      (fn inner [y]
        (if (< y 0)
          (return "negative")
          "positive"))
      (let result (inner x))
      (+ "Result: " result))
    (outer -5)
  `);
  assertEquals(result, "Result: negative");
});

Deno.test("Function: named arguments are rejected with migration guidance", async () => {
  await assertRejects(
    () => run(`
      (fn calc [a b c] (+ a b c))
      (calc 5 b: 10 c: 15)
    `),
    Error,
    "JSON map",
  );
});

Deno.test("Function: Swift-style type syntax with fn still runs", async () => {
  const result = await run(`
    (fn add [a:Int b:Int] -> Int (+ a b))
    (add 2 3)
  `);
  assertEquals(result, 5);
});

Deno.test("Function: malformed Swift-style return annotation is rejected", async () => {
  await assertRejects(
    () => transpile(`(fn add [a:Int b:Int] -> (+ a b))`),
    Error,
    "Expected return type after '->'",
  );
});
