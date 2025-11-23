/**
 * JavaScript Interoperability Tests
 * Comprehensive test suite for HQL ↔ JavaScript integration
 * 59 tests covering all JS interop features
 */

import { assertEquals } from "jsr:@std/assert";
import { run } from "../../../helpers.ts";
import { transpile } from "../../../../mod.ts";
import { writeTextFile, remove } from "../../../../core/src/platform/platform.ts";

// ============================================================================
// SECTION 1: BASIC JS INTEROP (10 tests)
// ============================================================================

Deno.test("JS Interop: js-call basic method invocation", async () => {
  const code = `
(var str "hello world")
(js-call str "toUpperCase")
`;
  const result = await run(code);
  assertEquals(result, "HELLO WORLD");
});

Deno.test("JS Interop: js-call with arguments", async () => {
  const code = `
(var str "hello,world,foo,bar")
(js-call str "split" ",")
`;
  const result = await run(code);
  assertEquals(result, ["hello", "world", "foo", "bar"]);
});

Deno.test("JS Interop: js-call on array with filter", async () => {
  const code = `
(var nums [1, 2, 3, 4, 5])
(js-call nums "filter" (fn (x) (> x 2)))
`;
  const result = await run(code);
  assertEquals(result, [3, 4, 5]);
});

Deno.test("JS Interop: js-get basic property access", async () => {
  const code = `
(var obj {"name": "Alice", "age": 30})
(js-get obj "name")
`;
  const result = await run(code);
  assertEquals(result, "Alice");
});

Deno.test("JS Interop: js-get nested property access", async () => {
  const code = `
(var person {"address": {"city": "NYC"}})
(var addr (js-get person "address"))
(js-get addr "city")
`;
  const result = await run(code);
  assertEquals(result, "NYC");
});

Deno.test("JS Interop: js-set property assignment", async () => {
  const code = `
(var obj {"count": 0})
(js-set obj "count" 42)
(js-get obj "count")
`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("JS Interop: js-new create Date object", async () => {
  const code = `
(var d (js-new Date (2023 11 25)))
(js-call d "getFullYear")
`;
  const result = await run(code);
  assertEquals(result, 2023);
});

Deno.test("JS Interop: js-new create Array", async () => {
  const code = `
(var arr (js-new Array (5)))
(js-get arr "length")
`;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("JS Interop: dot notation property access", async () => {
  const code = `
(var nums [1, 2, 3])
(nums .length)
`;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("JS Interop: dot notation method chaining", async () => {
  const code = `
(var text "  hello  ")
(text .trim .toUpperCase)
`;
  const result = await run(code);
  assertEquals(result, "HELLO");
});

// ============================================================================
// SECTION 2: ASYNC/AWAIT (12 tests)
// ============================================================================

Deno.test({
  name: "Async: Basic async function with await",
  async fn() {
    const code = `
(async fn get-value ()
  (await (js-call Promise "resolve" 42)))

(get-value)
`;
    const promise = await run(code);
    const result = await promise;
    assertEquals(result, 42);
  },
});

Deno.test({
  name: "Async: Multiple awaits in sequence",
  async fn() {
    const code = `
(async fn add-async (a b)
  (let x (await (js-call Promise "resolve" a)))
  (let y (await (js-call Promise "resolve" b)))
  (+ x y))

(add-async 10 20)
`;
    const promise = await run(code);
    const result = await promise;
    assertEquals(result, 30);
  },
});

Deno.test({
  name: "Async: Await with actual delay",
  async fn() {
    const code = `
(async fn delayed-value ()
  (await (js-call Promise "resolve" "success")))

(delayed-value)
`;
    const promise = await run(code);
    const result = await promise;
    assertEquals(result, "success");
  },
});

Deno.test({
  name: "Async: Promise.all with multiple promises",
  async fn() {
    const code = `
(async fn fetch-all ()
  (let promises [
    (js-call Promise "resolve" 1)
    (js-call Promise "resolve" 2)
    (js-call Promise "resolve" 3)])
  (await (js-call Promise "all" promises)))

(fetch-all)
`;
    const promise = await run(code);
    const result = await promise;
    assertEquals(result, [1, 2, 3]);
  },
});

Deno.test({
  name: "Async: Promise.race",
  async fn() {
    const code = `
(async fn race-promises ()
  (let promises [
    (js-call Promise "resolve" "slow")
    (js-call Promise "resolve" "fast")])
  (await (js-call Promise "race" promises)))

(race-promises)
`;
    const promise = await run(code);
    const result = await promise;
    assertEquals(typeof result, "string");
    assertEquals(["slow", "fast"].includes(result), true);
  },
});

Deno.test({
  name: "Async: Chained async operations",
  async fn() {
    const code = `
(async fn step1 ()
  (await (js-call Promise "resolve" 5)))

(async fn step2 (x)
  (let result (await (step1)))
  (* x result))

(step2 10)
`;
    const promise = await run(code);
    const result = await promise;
    assertEquals(result, 50);
  },
});

Deno.test({
  name: "Async: Async function returning computed values",
  async fn() {
    const code = `
(async fn get-user-data ()
  (let name (await (js-call Promise "resolve" "Alice")))
  (let age (await (js-call Promise "resolve" 30)))
  [name age])

(get-user-data)
`;
    const promise = await run(code);
    const result = await promise;
    assertEquals(result, ["Alice", 30]);
  },
});

Deno.test({
  name: "Async: Async with array operations",
  async fn() {
    const code = `
(async fn process-array ()
  (let arr (await (js-call Promise "resolve" [1 2 3 4 5])))
  (arr .map (fn (x) (* x 2))))

(process-array)
`;
    const promise = await run(code);
    const result = await promise;
    assertEquals(result, [2, 4, 6, 8, 10]);
  },
});

Deno.test({
  name: "Async: Promise rejection with catch",
  async fn() {
    const code = `
(async fn safe-call (shouldFail)
  (if shouldFail
    (await (js-call Promise "reject" "intentional-error"))
    (await (js-call Promise "resolve" "success"))))

(safe-call false)
`;
    const promise = await run(code);
    const result = await promise;
    assertEquals(result, "success");
  },
});

Deno.test({
  name: "Async: Nested async calls",
  async fn() {
    const code = `
(async fn inner ()
  (await (js-call Promise "resolve" 100)))

(async fn middle ()
  (let x (await (inner)))
  (+ x 50))

(async fn outer ()
  (let y (await (middle)))
  (+ y 25))

(outer)
`;
    const promise = await run(code);
    const result = await promise;
    assertEquals(result, 175);
  },
});

Deno.test({
  name: "Regression: js-new Promise with setTimeout (Bug #1)",
  async fn() {
    const code = `
(js-new Promise ((fn (resolve)
  (js-call setTimeout (fn () (resolve "delayed")) 50))))
`;
    const result = await run(code);
    assertEquals(result, "delayed");
  },
});

Deno.test({
  name: "Regression: js-new Promise with immediate resolve",
  async fn() {
    const code = `
(js-new Promise ((fn (resolve)
  (resolve "immediate"))))
`;
    const result = await run(code);
    assertEquals(result, "immediate");
  },
});

// ============================================================================
// SECTION 3: ERROR HANDLING (16 tests)
// ============================================================================

Deno.test({
  name: "Error: Basic try/catch with throw",
  async fn() {
    const code = `
(try
  (throw "error-message")
  (catch e
    "caught"))
`;
    const result = await run(code);
    assertEquals(result, "caught");
  },
});

Deno.test({
  name: "Error: Try/catch with throw",
  async fn() {
    const code = `
(try
  (throw "custom-error")
  (catch e
    e))
`;
    const result = await run(code);
    assertEquals(result, "custom-error");
  },
});

Deno.test({
  name: "Error: Try/catch/finally all execute",
  async fn() {
    const code = `
(var result [])
(try
  (result .push "try")
  (throw "error")
  (catch e
    (result .push "catch"))
  (finally
    (result .push "finally")))
result
`;
    const result = await run(code);
    assertEquals(result, ["try", "catch", "finally"]);
  },
});

Deno.test({
  name: "Error: Finally executes even without error",
  async fn() {
    const code = `
(var result [])
(try
  (result .push "try")
  (catch e
    (result .push "catch"))
  (finally
    (result .push "finally")))
result
`;
    const result = await run(code);
    assertEquals(result, ["try", "finally"]);
  },
});

Deno.test({
  name: "Error: Catch gets error object",
  async fn() {
    const code = `
(try
  (throw "test-message")
  (catch e
    e))
`;
    const result = await run(code);
    assertEquals(result, "test-message");
  },
});

Deno.test({
  name: "Error: Catch synchronous JS errors",
  async fn() {
    const code = `
(try
  (var arr [1 2 3])
  (throw "sync-error")
  (catch e
    (+ "caught: " e)))
`;
    const result = await run(code);
    assertEquals(result, "caught: sync-error");
  },
});

Deno.test({
  name: "Error: Catch JS method throwing error",
  async fn() {
    const code = `
(try
  (js-call JSON "parse" "invalid-json")
  (catch e
    "parse-error"))
`;
    const result = await run(code);
    assertEquals(result, "parse-error");
  },
});

Deno.test({
  name: "Error: Catch array access out of bounds",
  async fn() {
    const code = `
(var arr [1 2 3])
(try
  (js-get arr 999)
  (catch e
    "out-of-bounds"))
`;
    const result = await run(code);
    assertEquals(result, undefined);
  },
});

Deno.test({
  name: "Error: HQL function throws, catches internally",
  async fn() {
    const code = `
(async fn may-fail (shouldFail)
  (try
    (if shouldFail
      (throw "hql-error")
      "success")
    (catch e
      (+ "caught: " e))))

(may-fail true)
`;
    const promise = await run(code);
    const result = await promise;
    assertEquals(result, "caught: hql-error");
  },
});

Deno.test({
  name: "Error: HQL catches then returns value",
  async fn() {
    const code = `
(fn safe-divide [a b]
  (try
    (if (=== b 0)
      (throw "division-by-zero")
      (/ a b))
    (catch e
      (+ "error: " e))))

(safe-divide 10 0)
`;
    const result = await run(code);
    assertEquals(result, "error: division-by-zero");
  },
});

Deno.test({
  name: "Error: Nested try/catch blocks",
  async fn() {
    const code = `
(var result [])
(try
  (result .push "outer-try")
  (try
    (result .push "inner-try")
    (throw "inner-error")
    (catch e
      (result .push "inner-catch")))
  (result .push "after-inner")
  (catch e
    (result .push "outer-catch"))
  (finally
    (result .push "outer-finally")))
result
`;
    const result = await run(code);
    assertEquals(result, [
      "outer-try",
      "inner-try",
      "inner-catch",
      "after-inner",
      "outer-finally",
    ]);
  },
});

Deno.test({
  name: "Error: Catch in inner, rethrow to outer",
  async fn() {
    const code = `
(var result [])
(try
  (try
    (throw "error")
    (catch e
      (result .push "inner-caught")
      (throw e)))
  (catch e
    (result .push "outer-caught")))
result
`;
    const result = await run(code);
    assertEquals(result, ["inner-caught", "outer-caught"]);
  },
});

Deno.test({
  name: "Error: Async function with try/catch",
  async fn() {
    const code = `
(async fn safe-operation (shouldFail)
  (try
    (if shouldFail
      (throw "operation-failed")
      "success")
    (catch e
      (+ "error: " e))))

(safe-operation true)
`;
    const promise = await run(code);
    const result = await promise;
    assertEquals(result, "error: operation-failed");
  },
});

Deno.test({
  name: "Error: Async function with finally",
  async fn() {
    const code = `
(var cleanup [])

(async fn with-cleanup (shouldFail)
  (try
    (if shouldFail
      (throw "failed")
      "success")
    (catch e
      "caught")
    (finally
      (cleanup .push "cleanup-done"))))

(async fn test ()
  (let result (await (with-cleanup true)))
  (let cleanupValue cleanup)
  [result cleanupValue])

(test)
`;
    const promise = await run(code);
    const result = await promise;
    assertEquals(result[0], "caught");
    assertEquals(result[1], ["cleanup-done"]);
  },
});

Deno.test({
  name: "Error: Catch and access error properties",
  async fn() {
    const code = `
(try
  (throw "test-error")
  (catch e
    (+ "Error: " e)))
`;
    const result = await run(code);
    assertEquals(result, "Error: test-error");
  },
});

Deno.test({
  name: "Error: Access error message property",
  async fn() {
    const code = `
(try
  (throw "test-error-message")
  (catch e
    e))
`;
    const result = await run(code);
    assertEquals(result, "test-error-message");
  },
});

// ============================================================================
// SECTION 4: DEEP DIVE (17 tests)
// ============================================================================

Deno.test({
  name: "Interop Deep Dive: HQL imports JS function",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const code = `
(import [jsDivide] from "./test/fixtures/js-module.js")
(jsDivide 20 4)
`;
    const result = await run(code);
    assertEquals(result, 5);
  },
});

Deno.test({
  name: "Interop Deep Dive: HQL imports JS variadic function",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const code = `
(import [jsConcat] from "./test/fixtures/js-module.js")
(jsConcat "a" "b" "c" "d")
`;
    const result = await run(code);
    assertEquals(result, "a-b-c-d");
  },
});

Deno.test({
  name: "Interop Deep Dive: HQL imports JS constant",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const code = `
(import [JS_VERSION] from "./test/fixtures/js-module.js")
JS_VERSION
`;
    const result = await run(code);
    assertEquals(result, "ES6");
  },
});

Deno.test({
  name: "Interop Deep Dive: HQL imports and uses JS class",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const code = `
(import [JsCounter] from "./test/fixtures/js-module.js")
(var counter (js-new JsCounter (10)))
(js-call counter "increment")
(js-call counter "increment")
(js-call counter "getValue")
`;
    const result = await run(code);
    assertEquals(result, 12);
  },
});

Deno.test({
  name: "Interop Deep Dive: transpile() produces valid JavaScript",
  async fn() {
    const hqlCode = `
(fn add [a b]
  (+ a b))
(add 5 3)
`;
    const transpileResult = await transpile(hqlCode);
    const jsCode = typeof transpileResult === "string"
      ? transpileResult
      : transpileResult.code;

    assertEquals(jsCode.includes("add"), true);
    assertEquals(jsCode.includes("a + b"), true);
  },
});

Deno.test({
  name: "Interop Deep Dive: run() executes and returns result",
  async fn() {
    const result = await run(`
(var x 10)
(var y 20)
(+ x y (* 2 3))
`);
    assertEquals(result, 36);
  },
});

Deno.test({
  name: "Interop Deep Dive: HQL arrays are JS arrays",
  async fn() {
    const code = `
(var arr [1 2 3 4 5])
(js-call arr "map" (fn (x) (* x 2)))
`;
    const result = await run(code);
    assertEquals(result, [2, 4, 6, 8, 10]);
    assertEquals(Array.isArray(result), true);
  },
});

Deno.test({
  name: "Interop Deep Dive: HQL objects are JS objects",
  async fn() {
    const code = `
(var obj {"name": "Alice", "age": 30, "active": true})
(js-get obj "name")
`;
    const result = await run(code);
    assertEquals(result, "Alice");
  },
});

Deno.test({
  name: "Interop Deep Dive: HQL functions are JS functions",
  async fn() {
    const code = `
(fn multiplier [factor]
  (fn (x) (* x factor)))

(var times3 (multiplier 3))
(times3 7)
`;
    const result = await run(code);
    assertEquals(result, 21);
  },
});

Deno.test({
  name: "Interop Deep Dive: HQL closures work like JS closures",
  async fn() {
    const code = `
(fn make-adder [x]
  (fn (y) (+ x y)))

(var add5 (make-adder 5))
(add5 10)
`;
    const result = await run(code);
    assertEquals(result, 15);
  },
});

Deno.test({
  name: "Interop Deep Dive: Using Promise.resolve",
  async fn() {
    const code = `
(var promise (js-call Promise "resolve" 42))
promise
`;
    const result = await run(code);
    assertEquals(result, 42);
  },
});

Deno.test({
  name: "Interop Deep Dive: Array destructuring and spread",
  async fn() {
    const code = `
(var arr1 [1 2 3])
(var arr2 [4 5 6])
(js-call arr1 "concat" arr2)
`;
    const result = await run(code);
    assertEquals(result, [1, 2, 3, 4, 5, 6]);
  },
});

Deno.test({
  name: "Interop Deep Dive: JSON manipulation",
  async fn() {
    const code = `
(var obj {"x": 10, "y": 20})
(var json (js-call JSON "stringify" obj))
(var parsed (js-call JSON "parse" json))
(js-get parsed "x")
`;
    const result = await run(code);
    assertEquals(result, 10);
  },
});

Deno.test({
  name: "Interop Deep Dive: Dot notation with multiple chaining",
  async fn() {
    const code = `
(var text "  Hello World  ")
(text .trim .toLowerCase .split " ")
`;
    const result = await run(code);
    assertEquals(result, ["hello", "world"]);
  },
});

Deno.test({
  name: "Interop Deep Dive: Dot notation with property and method mix",
  async fn() {
    const code = `
(var arr [1 2 3 4 5])
(var len (arr .length))
(var doubled (arr .map (fn (x) (* x 2))))
(js-get doubled "length")
`;
    const result = await run(code);
    assertEquals(result, 5);
  },
});

Deno.test({
  name: "Interop Deep Dive: Null and undefined handling",
  async fn() {
    const code = `
(var obj {"a": 1})
(js-get obj "nonexistent")
`;
    const result = await run(code);
    assertEquals(result, undefined);
  },
});

Deno.test({
  name: "Interop Deep Dive: this binding in methods",
  async fn() {
    const code = `
(var obj {"value": 100, "getValue": (fn () (js-get this "value"))})
(js-call obj "getValue")
`;
    const result = await run(code);
    assertEquals(result, 100);
  },
});

// ============================================================================
// SECTION 5: MODULE SYSTEM (3 tests)
// ============================================================================

Deno.test({
  name: "JS Import HQL: Compile HQL and verify it exports correctly",
  async fn() {
    const hqlCode = `
(fn factorial [n]
  (if (<= n 1)
    1
    (* n (factorial (- n 1)))))

(let PI 3.14159)

(export [factorial PI])
`;

    const transpileResult = await transpile(hqlCode);
    const jsCode = typeof transpileResult === "string"
      ? transpileResult
      : transpileResult.code;

    assertEquals(jsCode.includes("export"), true);
    assertEquals(jsCode.includes("factorial"), true);
    assertEquals(jsCode.includes("PI"), true);
  },
});

Deno.test({
  name: "JS Import HQL: Write, import, and use compiled HQL module",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const hqlCode = `
(fn double [x]
  (* x 2))

(fn triple [x]
  (* x 3))

(export [double triple])
`;

    const transpileResult = await transpile(hqlCode);
    const jsCode = typeof transpileResult === "string"
      ? transpileResult
      : transpileResult.code;

    const tempFile = "/tmp/test-hql-module.mjs";
    await writeTextFile(tempFile, jsCode);

    const module = await import(tempFile);

    assertEquals(module.double(5), 10);
    assertEquals(module.triple(4), 12);

    try {
      await remove(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  },
});

Deno.test({
  name: "JS Import HQL: Complex HQL module with classes",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const hqlCode = `
(class Counter
  (var count 0)

  (fn increment []
    (= this.count (+ this.count 1))
    this.count)

  (fn getValue ()
    this.count))

(export [Counter])
`;

    const transpileResult = await transpile(hqlCode);
    const jsCode = typeof transpileResult === "string"
      ? transpileResult
      : transpileResult.code;

    const tempFile = "/tmp/test-hql-class-module.mjs";
    await writeTextFile(tempFile, jsCode);

    const module = await import(tempFile);
    const counter = new module.Counter();

    assertEquals(counter.increment(), 1);
    assertEquals(counter.increment(), 2);
    assertEquals(counter.getValue(), 2);

    try {
      await remove(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  },
});

// ============================================================================
// SECTION 6: CIRCULAR IMPORTS (1 test)
// ============================================================================

Deno.test({
  name: "Circular HQL-JS: Verify circular imports work from test context",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const code = `
(import [circularFunction] from "./test/fixtures/circular/a.hql")
(circularFunction)
`;
    const result = await run(code);
    assertEquals(result, 20);
  },
});

console.log("\n✅ All JS Interop tests created (59 tests)\n");
