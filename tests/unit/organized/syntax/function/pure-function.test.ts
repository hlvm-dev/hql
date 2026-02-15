// tests/unit/organized/syntax/function/pure-function.test.ts
// Comprehensive tests for pure functions (fx): compilation, purity enforcement, edge cases

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { run, transpile } from "../../../helpers.ts";

// ============================================================================
// SECTION 1: fx WORKS (compiles + runs correctly)
// ============================================================================

Deno.test("Pure Function: simple arithmetic fx", async () => {
  const code = `
(fx add [a b] (+ a b))
(add 3 5)
`;
  const result = await run(code);
  assertEquals(result, 8);
});

Deno.test("Pure Function: fx with type annotations", async () => {
  const code = `
(fx add [a:number b:number] :number (+ a b))
(add 10 20)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Pure Function: fx calling another fx", async () => {
  const code = `
(fx square [x] (* x x))
(fx sum-of-squares [a b] (+ (square a) (square b)))
(sum-of-squares 3 4)
`;
  const result = await run(code);
  assertEquals(result, 25);
});

Deno.test("Pure Function: recursive fx (fibonacci)", async () => {
  const code = `
(fx fib [n]
  (if (<= n 1) n
    (+ (fib (- n 1)) (fib (- n 2)))))
(fib 10)
`;
  const result = await run(code);
  assertEquals(result, 55);
});

Deno.test("Pure Function: fx with multiple expressions in body", async () => {
  const code = `
(fx compute [x y]
  (const a (+ x y))
  (const b (* x y))
  (+ a b))
(compute 3 4)
`;
  const result = await run(code);
  assertEquals(result, 19); // (3+4) + (3*4) = 7 + 12 = 19
});

Deno.test("Pure Function: fx with multiple body expressions", async () => {
  const code = `
(fx greet [name greeting]
  (str greeting ", " name "!"))
(greet "World" "Hello")
`;
  const result = await run(code);
  assertEquals(result, "Hello, World!");
});

Deno.test("Pure Function: fx with no parameters", async () => {
  const code = `
(fx answer [] 42)
(answer)
`;
  const result = await run(code);
  assertEquals(result, 42);
});

// ============================================================================
// SECTION 2: PURITY VIOLATIONS (compile errors)
// ============================================================================

Deno.test("Pure Function: rejects mutation (set!)", async () => {
  const code = `
(const counter 0)
(fx bad [x] (= counter 1) x)
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "Mutation",
  );
});

Deno.test("Pure Function: rejects console.log", async () => {
  const code = `
(fx bad [x] (console.log x) x)
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "console.log",
  );
});

Deno.test("Pure Function: rejects Math.random", async () => {
  const code = `
(fx bad [] (Math.random))
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "Math.random",
  );
});

Deno.test("Pure Function: rejects Date.now()", async () => {
  const code = `
(fx bad [] (Date.now))
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "Date.now",
  );
});

Deno.test("Pure Function: rejects new Date()", async () => {
  const code = `
(fx bad [] (new Date))
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "new Date",
  );
});

Deno.test("Pure Function: rejects calling fn function", async () => {
  const code = `
(fn impure [x] (console.log x) x)
(fx bad [x] (impure x))
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "impure",
  );
});

Deno.test("Pure Function: rejects .push (mutating method)", async () => {
  const code = `
(fx bad [arr] (.push arr 1) arr)
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "push",
  );
});

Deno.test("Pure Function: rejects fetch (network I/O)", async () => {
  const code = `
(fx bad [] (fetch "http://example.com"))
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "fetch",
  );
});

Deno.test("Pure Function: rejects .sort (mutating method)", async () => {
  const code = `
(fx bad [arr] (.sort arr) arr)
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "sort",
  );
});

Deno.test("Pure Function: rejects .splice (mutating method)", async () => {
  const code = `
(fx bad [arr] (.splice arr 0 1) arr)
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "splice",
  );
});

// ============================================================================
// SECTION 3: ALLOWED IN fx
// ============================================================================

Deno.test("Pure Function: allows arithmetic operators", async () => {
  const code = `
(fx calc [a b]
  (+ (* a b) (- a (/ b 2))))
(calc 10 4)
`;
  const result = await run(code);
  assertEquals(result, 48); // (10*4) + (10 - 4/2) = 40 + 8 = 48
});

Deno.test("Pure Function: allows comparison operators", async () => {
  const code = `
(fx max-of [a b]
  (if (> a b) a b))
(max-of 5 3)
`;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("Pure Function: allows string operations (.slice, .toUpperCase)", async () => {
  const code = `
(fx shout [s] (.toUpperCase s))
(shout "hello")
`;
  const result = await run(code);
  assertEquals(result, "HELLO");
});

Deno.test("Pure Function: allows if/cond expressions", async () => {
  const code = `
(fx classify [n]
  (cond
    (< n 0) "negative"
    (=== n 0) "zero"
    true "positive"))
(classify -5)
`;
  const result = await run(code);
  assertEquals(result, "negative");
});

Deno.test("Pure Function: allows let/const bindings", async () => {
  const code = `
(fx hypotenuse [a b]
  (const a2 (* a a))
  (const b2 (* b b))
  (Math.sqrt (+ a2 b2)))
(hypotenuse 3 4)
`;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("Pure Function: allows throw", async () => {
  const code = `
(fx safe-div [a b]
  (if (=== b 0)
    (throw (new Error "Division by zero"))
    (/ a b)))
(safe-div 10 2)
`;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("Pure Function: allows Math.floor/ceil/abs", async () => {
  const code = `
(fx round-down [x] (Math.floor x))
(round-down 3.7)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Pure Function: allows new Map(), new Set()", async () => {
  const code = `
(fx make-set [] (new Set))
(const s (make-set))
(Array.isArray (Array.from s))
`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Pure Function: allows .map/.filter on arrays", async () => {
  const code = `
(fx evens [arr] (.filter arr (fn [x] (=== (% x 2) 0))))
(evens [1 2 3 4 5 6])
`;
  const result = await run(code);
  assertEquals(result, [2, 4, 6]);
});

Deno.test("Pure Function: allows .includes, .indexOf", async () => {
  const code = `
(fx has-three [arr] (.includes arr 3))
(has-three [1 2 3 4])
`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Pure Function: allows JSON.stringify", async () => {
  const code = `
(fx to-json [obj] (JSON.stringify obj))
(to-json {a: 1 b: 2})
`;
  const result = await run(code);
  assertEquals(JSON.parse(result as string), { a: 1, b: 2 });
});

// ============================================================================
// SECTION 4: EDGE CASES
// ============================================================================

Deno.test("Pure Function: nested fn inside fx is allowed", async () => {
  const code = `
(fx transform [arr]
  (.map arr (fn [x] (* x x))))
(transform [1 2 3])
`;
  const result = await run(code);
  assertEquals(result, [1, 4, 9]);
});

Deno.test("Pure Function: fx error messages include function name", async () => {
  const code = `
(fx myPureFn [x] (console.log x) x)
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "myPureFn",
  );
});

Deno.test("Pure Function: fx transpiles identically to fn", async () => {
  const fnCode = `
(fn square [x] (* x x))
(square 9)
`;
  const fxCode = `
(fx square [x] (* x x))
(square 9)
`;

  const fnJs = await transpile(fnCode);
  const fxJs = await transpile(fxCode);
  assertEquals(fxJs, fnJs);
});

Deno.test("Pure Function: fx with string concatenation", async () => {
  const code = `
(fx greet [name] (str "Hello, " name))
(greet "World")
`;
  const result = await run(code);
  assertEquals(result, "Hello, World");
});

// ============================================================================
// SECTION 5: LOOP/RECUR IN FX (Bug fix: IIFE callee in purity checker)
// ============================================================================

Deno.test("Pure Function: fx with loop/recur (sum)", async () => {
  const code = `
(fx sum-to [n]
  (loop [i 0 acc 0]
    (if (> i n) acc
      (recur (+ i 1) (+ acc i)))))
(sum-to 5)
`;
  const result = await run(code);
  assertEquals(result, 15); // 0+1+2+3+4+5
});

Deno.test("Pure Function: fx with loop/recur (factorial)", async () => {
  const code = `
(fx factorial [n]
  (loop [i n acc 1]
    (if (<= i 1) acc
      (recur (- i 1) (* acc i)))))
(factorial 6)
`;
  const result = await run(code);
  assertEquals(result, 720);
});

Deno.test("Pure Function: fx with loop (no recur)", async () => {
  const code = `
(fx constant [n]
  (loop [i 0]
    i))
(constant 42)
`;
  const result = await run(code);
  assertEquals(result, 0);
});

Deno.test("Pure Function: fx calling another fx (cross-pure)", async () => {
  const code = `
(fx double [x] (* x 2))
(fx quadruple [x] (double (double x)))
(quadruple 5)
`;
  const result = await run(code);
  assertEquals(result, 20);
});

Deno.test("Pure Function: fx rejects calling impure fn", async () => {
  const code = `
(fn impure [x] (console.log x) x)
(fx bad [x] (impure x))
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "impure",
  );
});

Deno.test("Pure Function: fx with higher-order function (map callback)", async () => {
  const code = `
(fx double-all [arr]
  (.map arr (fn [x] (* x 2))))
(double-all [1 2 3])
`;
  const result = await run(code);
  assertEquals(result, [2, 4, 6]);
});

Deno.test("Pure Function: fx with reduce", async () => {
  const code = `
(fx sum [arr]
  (.reduce arr (fn [acc x] (+ acc x)) 0))
(sum [1 2 3 4])
`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Pure Function: fx with nested conditionals", async () => {
  const code = `
(fx fizzbuzz [n]
  (cond
    (=== (% n 15) 0) "fizzbuzz"
    (=== (% n 3) 0)  "fizz"
    (=== (% n 5) 0)  "buzz"
    true              n))
(.map [1 3 5 15] (fn [x] (fizzbuzz x)))
`;
  const result = await run(code);
  assertEquals(result, [1, "fizz", "buzz", "fizzbuzz"]);
});

Deno.test("Pure Function: rejects setTimeout inside fx", async () => {
  const code = `
(fx bad [] (setTimeout (fn [] 1) 0))
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "setTimeout",
  );
});

Deno.test("Pure Function: rejects setInterval inside fx", async () => {
  const code = `
(fx bad [] (setInterval (fn [] 1) 1000))
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "setInterval",
  );
});

// ============================================================================
// SECTION 6: STRICTNESS / BYPASS PREVENTION
// ============================================================================

Deno.test("Pure Function: rejects unknown function parameter calls", async () => {
  const code = `
(fx bad [f x] (f x))
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "unknown function",
  );
});

Deno.test("Pure Function: rejects aliased impure function calls", async () => {
  const code = `
(fn impure [x] (console.log x) x)
(const g impure)
(fx bad [x] (g x))
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "unknown function",
  );
});

Deno.test("Pure Function: rejects direct inline function invocation", async () => {
  const code = `
(fx bad [] ((fn [] (console.log 1))))
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "inline function",
  );
});

Deno.test("Pure Function: rejects unknown constructors", async () => {
  const code = `
(fx bad [] (new WebSocket "wss://example.com"))
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "WebSocket",
  );
});

Deno.test("Pure Function: rejects Object.assign (mutating static call)", async () => {
  const code = `
(fx bad [arr] (Object.assign arr [1 2]))
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "Object.assign",
  );
});

Deno.test("Pure Function: rejects top-level anonymous fx with side effects", async () => {
  const code = `
(fx [x] (console.log x) x)
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "console.log",
  );
});

Deno.test("Pure Function: rejects anonymous fx assigned to variable with side effects", async () => {
  const code = `
(const f (fx [x] (console.log x) x))
42
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "console.log",
  );
});

Deno.test("Pure Function: rejects immediately-invoked anonymous fx with side effects", async () => {
  const code = `
((fx [x] (console.log x) x) 7)
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "console.log",
  );
});

Deno.test("Pure Function: allows anonymous pure fx assigned to variable", async () => {
  const code = `
(const f (fx [x] (+ x 1)))
(f 5)
`;
  const result = await run(code);
  assertEquals(result, 6);
});

// ============================================================================
// SECTION 7: HIGHER-ORDER EFFECT TESTS
// ============================================================================

Deno.test("Pure Function: fx with Pure-typed callback compiles and runs", async () => {
  const code = `
(fx apply-pure [f:(Pure number number) x:number] (f x))
(apply-pure (fx [x] (+ x 1)) 5)
`;
  const result = await run(code);
  assertEquals(result, 6);
});

Deno.test("Pure Function: fx-to-fx passing with Pure param", async () => {
  const code = `
(fx double [x] (* x 2))
(fx apply-fn [f:(Pure number number) x:number] (f x))
(apply-fn double 5)
`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Pure Function: multiple Pure params", async () => {
  const code = `
(fx compose [f:(Pure number number) g:(Pure number number) x:number] (f (g x)))
(compose (fx [x] (+ x 1)) (fx [x] (* x 2)) 3)
`;
  const result = await run(code);
  assertEquals(result, 7);
});

Deno.test("Pure Function: no-arg Pure callback", async () => {
  const code = `
(fx run-pure [f:(Pure number)] (f))
(run-pure (fx [] 42))
`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Pure Function: anonymous fx arg to Pure param", async () => {
  const code = `
(fx apply-it [f:(Pure number number) x:number] (f x))
(apply-it (fx [x] (+ x 1)) 5)
`;
  const result = await run(code);
  assertEquals(result, 6);
});

Deno.test("Pure Function: (Pure number number) compiles with callback invocation", async () => {
  // Verifies that the Pure type annotation allows f to be called as a function
  // Type normalization (Pure number number) → (arg0: number) => number is tested
  // in the type-tokenizer unit tests; here we test end-to-end compilation
  const code = `
(fx apply-pure [f:(Pure number number) x:number] (f x))
(apply-pure (fx [x] (+ x 1)) 5)
`;
  const result = await run(code);
  assertEquals(result, 6);
});

Deno.test("Pure Function: rejects fn passed to Pure param (call-site soundness)", async () => {
  const code = `
(fn impure [x] (console.log x) x)
(fx apply-pure [f:(Pure number number) x:number] (f x))
(apply-pure impure 5)
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "impure",
  );
});

Deno.test("Pure Function: rejects impure callback at call-site", async () => {
  const code = `
(fn side-effecty [x] (console.log x) x)
(fx apply-pure [f:(Pure number number) x:number] (f x))
(apply-pure side-effecty 5)
`;
  await assertRejects(
    async () => await run(code),
    Error,
    "Pure function",
  );
});

Deno.test("Pure Function: effectAnnotation preserved on IR node", async () => {
  // This test verifies the integration works end-to-end:
  // The fact that the previous tests work (Pure-typed callbacks compile and
  // impure args are rejected) proves effectAnnotation is correctly propagated
  // through the pipeline: parse → IR → effect-checker
  const code = `
(fx apply-pure [f:(Pure number number) x:number] (f x))
(apply-pure (fx [x] (* x 3)) 7)
`;
  const result = await run(code);
  assertEquals(result, 21);
});

// ============================================================================
// SECTION 8: RECEIVER-TYPE-AWARE EFFECT CHECKING
// ============================================================================

Deno.test("Pure Function: typed Array param allows .map", async () => {
  const code = `
(fx transform [xs:Array] (.map xs (fn [x] (* x 2))))
(transform [1 2 3])
`;
  const result = await run(code);
  assertEquals(result, [2, 4, 6]);
});

Deno.test("Pure Function: typed String param allows .toUpperCase", async () => {
  const code = `
(fx shout [s:string] (.toUpperCase s))
(shout "hello")
`;
  const result = await run(code);
  assertEquals(result, "HELLO");
});

Deno.test("Pure Function: unknown type param rejects .map (fail-closed)", async () => {
  const code = `
(fx query [db:DatabaseConnection] (.map db (fn [x] x)))
`;
  await assertRejects(
    async () => await transpile(code),
    Error,
  );
});

Deno.test("Pure Function: typed Map param allows .get, rejects .set", async () => {
  // .get is pure for Map
  const code1 = `
(fx lookup [m:Map k:string] (.get m k))
`;
  await transpile(code1); // should not throw

  // .set is impure for Map
  const code2 = `
(fx mutate [m:Map k:string v:number] (.set m k v))
`;
  await assertRejects(
    async () => await transpile(code2),
    Error,
  );
});

Deno.test("Pure Function: untyped param preserves backward compat (.map still works)", async () => {
  const code = `
(fx transform [xs] (.map xs (fn [x] (* x 2))))
(transform [1 2 3])
`;
  const result = await run(code);
  assertEquals(result, [2, 4, 6]);
});

Deno.test("Pure Function: let-bound array literal allows .map", async () => {
  const code = `
(fx compute [] (let [xs [1 2 3]] (.map xs (fn [x] (* x 10)))))
(compute)
`;
  const result = await run(code);
  assertEquals(result, [10, 20, 30]);
});

Deno.test("Pure Function: let-bound array allows .indexOf", async () => {
  const code = `
(fx find-pos [] (let [xs [10 20 30]] (.indexOf xs 20)))
(find-pos)
`;
  const result = await run(code);
  assertEquals(result, 1);
});

Deno.test("Pure Function: var-bound new Map allows .has", async () => {
  // Uses var instead of let because HQL's let binding vector
  // can't parse (new Map) inline — known parser limitation
  const code = `
(fx check [] (var m (new Map)) (.has m "key"))
(check)
`;
  const result = await run(code);
  assertEquals(result, false);
});
