import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { transpileToJavascript } from "../../src/hql/transpiler/hql-transpiler.ts";
import { run } from "./helpers.ts";

async function runLoose(code: string): Promise<unknown> {
  return await run(code, { typeCheck: false });
}

async function transpileLoose(code: string): Promise<string> {
  const result = await transpileToJavascript(code, {
    typeCheck: false,
    showTypeWarnings: false,
  });
  return result.code;
}

Deno.test("tco: tail-recursive functions compute representative results", async () => {
  const result = await runLoose(`
    (fn factorial [n acc]
      (if (<= n 1)
        acc
        (factorial (- n 1) (* n acc))))

    (fn sum [n acc]
      (if (<= n 0)
        acc
        (sum (- n 1) (+ acc n))))

    (fn fib [n a b]
      (if (=== n 0)
        a
        (fib (- n 1) b (+ a b))))

    (fn gcd [a b]
      (if (=== b 0)
        a
        (gcd b (% a b))))

    [
      (factorial 10 1)
      (sum 100 0)
      (fib 20 0 1)
      (gcd 48 18)
    ]
  `);

  assertEquals(result, [3628800, 5050, 6765, 6]);
});

Deno.test("tco: deep tail recursion stays stack-safe", async () => {
  const result = await runLoose(`
    (fn countdown [n]
      (if (<= n 0)
        0
        (countdown (- n 1))))

    (fn sum [n acc]
      (if (<= n 0)
        acc
        (sum (- n 1) (+ acc n))))

    [(countdown 50000) (sum 10000 0)]
  `);

  assertEquals(result, [0, 50005000]);
});

Deno.test("tco: tail calls in nested control flow still optimize correctly", async () => {
  const result = await runLoose(`
    (fn classify [n]
      (if (< n 0)
        "negative"
        (if (=== n 0)
          "zero"
          (classify (- n 1)))))

    (fn collatz-length [n steps]
      (if (=== n 1)
        steps
        (if (=== (% n 2) 0)
          (collatz-length (/ n 2) (+ steps 1))
          (collatz-length (+ (* n 3) 1) (+ steps 1)))))

    (fn sum-with-let [n acc]
      (let [done (<= n 0)]
        (if done
          acc
          (sum-with-let (- n 1) (+ acc n)))))

    [(classify 5) (classify -3) (collatz-length 6 0) (sum-with-let 10 0)]
  `);

  assertEquals(result, ["zero", "negative", 8, 55]);
});

Deno.test("tco: non-tail and non-recursive functions are not rewritten into loops", async () => {
  const factorialResult = await runLoose(`
    (fn factorial-naive [n]
      (if (<= n 1)
        1
        (* n (factorial-naive (- n 1)))))
    (factorial-naive 5)
  `);
  const nonTailJs = await transpileLoose(`
    (fn factorial-naive [n]
      (if (<= n 1)
        1
        (* n (factorial-naive (- n 1)))))
  `);
  const nonRecursiveJs = await transpileLoose(`
    (fn add [a b]
      (+ a b))
  `);

  assertEquals(factorialResult, 120);
  assertEquals(nonTailJs.includes("while (true)"), false);
  assertEquals(nonRecursiveJs.includes("while"), false);
});

Deno.test("tco: optimized output uses a loop, parameter reassignment, and base-case return", async () => {
  const js = await transpileLoose(`
    (fn factorial [n acc]
      (if (<= n 1)
        acc
        (factorial (- n 1) (* n acc))))
  `);

  assertStringIncludes(js, "while (true)");
  assertStringIncludes(js, "[n, acc]");
  assertStringIncludes(js, "return");
});

Deno.test("tco: mutual recursion returns correct values", async () => {
  const result = await runLoose(`
    (fn is-even [n]
      (if (=== n 0) true (is-odd (- n 1))))
    (fn is-odd [n]
      (if (=== n 0) false (is-even (- n 1))))
    (fn step-a [n]
      (if (=== n 0) "done-a" (step-b (- n 1))))
    (fn step-b [n]
      (if (=== n 0) "done-b" (step-c (- n 1))))
    (fn step-c [n]
      (if (=== n 0) "done-c" (step-a (- n 1))))
    [(is-even 10) (is-odd 7) (step-a 2) (step-a 3)]
  `);

  assertEquals(result, [true, true, "done-c", "done-a"]);
});

Deno.test("tco: mutual recursion stays stack-safe on deep calls", async () => {
  const result = await runLoose(`
    (fn is-even [n]
      (if (=== n 0) true (is-odd (- n 1))))
    (fn is-odd [n]
      (if (=== n 0) false (is-even (- n 1))))
    [(is-even 10000) (is-odd 9999)]
  `);

  assertEquals(result, [true, true]);
});

Deno.test("tco: cross-group mutual recursion returns final values instead of raw thunks", async () => {
  const result = await runLoose(`
    (fn ping [n]
      (if (=== n 0) "ponged" (pong (- n 1))))
    (fn pong [n]
      (if (=== n 0) "pinged" (ping (- n 1))))
    (fn test-cross-call []
      (let [res (ping 4)]
        res))
    (test-cross-call)
  `);

  assertEquals(result, "ponged");
});
