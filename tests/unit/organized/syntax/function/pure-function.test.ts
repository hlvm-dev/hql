import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { run, transpile } from "../../../helpers.ts";

Deno.test("Pure Function: basic fx executes and returns a value", async () => {
  const result = await run(`
    (fx add [a b] (+ a b))
    (add 3 5)
  `);
  assertEquals(result, 8);
});

Deno.test("Pure Function: fx can call other pure functions and recurse", async () => {
  const squareSum = await run(`
    (fx square [x] (* x x))
    (fx sum-of-squares [a b] (+ (square a) (square b)))
    (sum-of-squares 3 4)
  `);
  const fib = await run(`
    (fx fib [n]
      (if (<= n 1) n
        (+ (fib (- n 1)) (fib (- n 2)))))
    (fib 10)
  `);

  assertEquals(squareSum, 25);
  assertEquals(fib, 55);
});

Deno.test("Pure Function: side effects inside fx are rejected", async () => {
  await assertRejects(
    () => run(`
      (fx bad [x] (console.log x) x)
    `),
    Error,
    "console.log",
  );
});

Deno.test("Pure Function: mutation inside fx is rejected", async () => {
  await assertRejects(
    () => run(`
      (const counter 0)
      (fx bad [x] (= counter 1) x)
    `),
    Error,
    "Mutation",
  );
});

Deno.test("Pure Function: impure function calls cannot be smuggled through aliases", async () => {
  await assertRejects(
    () => run(`
      (fn impure [x] (console.log x) x)
      (const g impure)
      (fx bad [x] (g x))
    `),
    Error,
    "impure",
  );
});

Deno.test("Pure Function: pure collection transforms are allowed", async () => {
  const mapped = await run(`
    (fx double-all [arr:Array<Int>]
      (.map arr (fn [x] (* x 2))))
    (double-all [1 2 3])
  `);
  const reduced = await run(`
    (fx sum [xs:Array<Int>] (.reduce xs (fn [acc x] (+ acc x)) 0))
    (sum [1 2 3 4])
  `);

  assertEquals(mapped, [2, 4, 6]);
  assertEquals(reduced, 10);
});

Deno.test("Pure Function: loop/recur remains valid inside fx", async () => {
  const result = await run(`
    (fx factorial [n]
      (loop [i n acc 1]
        (if (<= i 1) acc
          (recur (- i 1) (* acc i)))))
    (factorial 6)
  `);
  assertEquals(result, 720);
});

Deno.test("Pure Function: Pure-typed callbacks compile and run", async () => {
  const result = await run(`
    (fx apply-pure [f:(fx Int Int) x:Int] (f x))
    (apply-pure (fx [x] (+ x 1)) 5)
  `);
  assertEquals(result, 6);
});

Deno.test("Pure Function: impure callbacks are rejected at call-site", async () => {
  await assertRejects(
    () => run(`
      (fn impure [x] (console.log x) x)
      (fx apply-pure [f:(fx Int Int) x:Int] (f x))
      (apply-pure impure 5)
    `),
    Error,
    "impure",
  );
});

Deno.test("Pure Function: receiver-type-aware rules allow Map.get but reject Map.set", async () => {
  await transpile(`
    (fx lookup [m:Map<String, Int> k:String] (.get m k))
  `);

  await assertRejects(
    () => transpile(`
      (fx mutate [m:Map<String, Int> k:String v:Int] (.set m k v))
    `),
    Error,
  );
});

Deno.test("Pure Function: Swift-style fx type syntax works", async () => {
  const result = await run(`
    (fx add [a:Int b:Int] -> Int (+ a b))
    (add 3 5)
  `);
  assertEquals(result, 8);
});

Deno.test("Pure Function: impure higher-order callbacks are rejected", async () => {
  await assertRejects(
    () => transpile(`(fx bad [xs:Array] (.map xs (fn [x] (console.log x) x)))`),
    Error,
    "Impure callback",
  );
});

Deno.test("Pure Function: zero-annotation callable params still enforce purity at call-site", async () => {
  const ok = await run(`
    (fx call-fn [f x] (f x))
    (call-fn (fx [x] (+ x 1)) 5)
  `);
  assertEquals(ok, 6);

  await assertRejects(
    () => run(`
      (fn impure [x] (console.log x) x)
      (fx call-fn [f x] (f x))
      (call-fn impure 5)
    `),
    Error,
    "impure",
  );
});
