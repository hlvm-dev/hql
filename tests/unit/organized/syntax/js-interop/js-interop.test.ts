import { assertEquals } from "jsr:@std/assert";
import { run } from "../../../helpers.ts";
import { transpile } from "../../../../../mod.ts";
import { getPlatform } from "../../../../../src/platform/platform.ts";

const platform = getPlatform();

async function withTempModule<T>(
  fileName: string,
  code: string,
  runCase: (module: Record<string, unknown>) => Promise<T> | T,
): Promise<T> {
  const tempFile = `/tmp/${fileName}`;
  await platform.fs.writeTextFile(tempFile, code);
  try {
    const module = await import(`${tempFile}?t=${Date.now()}`) as Record<string, unknown>;
    return await runCase(module);
  } finally {
    try {
      await platform.fs.remove(tempFile);
    } catch {
      // Ignore cleanup failures in tests.
    }
  }
}

Deno.test("JS interop: basic method, property, mutation, and dot notation work", async () => {
  const upper = await run(`
    (var textValue "hello world")
    (js-call textValue "toUpperCase")
  `);
  const property = await run(`
    (var personObj {"name": "Alice", "age": 30})
    (js-get personObj "name")
  `);
  const assigned = await run(`
    (var counterObj {"count": 0})
    (js-set counterObj "count" 42)
    (js-get counterObj "count")
  `);
  const length = await run(`
    (var arrayObj (js-new Array (5)))
    (js-get arrayObj "length")
  `);
  const chained = await run(`
    (var text "  hello  ")
    (text .trim .toUpperCase)
  `);

  assertEquals(upper, "HELLO WORLD");
  assertEquals(property, "Alice");
  assertEquals(assigned, 42);
  assertEquals(length, 5);
  assertEquals(chained, "HELLO");
});

Deno.test("JS interop: async await and Promise helpers resolve correctly", async () => {
  const sumPromise = await run(`
    (async fn add-async [a b]
      (let x (await (js-call Promise "resolve" a)))
      (let y (await (js-call Promise "resolve" b)))
      (+ x y))
    (add-async 10 20)
  `);
  const racePromise = await run(`
    (async fn race-promises []
      (let promises [
        (js-call Promise "resolve" "slow")
        (js-call Promise "resolve" "fast")])
      (await (js-call Promise "race" promises)))
    (race-promises)
  `);
  const delayed = await run(`
    (js-new Promise ((fn [resolve]
      (js-call setTimeout (fn [] (resolve "delayed")) 10))))
  `);

  assertEquals(await sumPromise, 30);
  assertEquals(["slow", "fast"].includes(await racePromise as string), true);
  assertEquals(delayed, "delayed");
});

Deno.test("JS interop: HQL values behave like JavaScript arrays, objects, and closures", async () => {
  const arrayResult = await run(`
    (var arr [1 2 3 4 5])
    (js-call arr "map" (fn [x] (* x 2)))
  `);
  const objectResult = await run(`
    (var obj {"x": 10, "y": 20})
    (var json (js-call JSON "stringify" obj))
    (var parsed (js-call JSON "parse" json))
    (js-get parsed "x")
  `);
  const closureResult = await run(`
    (fn make-adder [x]
      (fn [y] (+ x y)))
    (var add5 (make-adder 5))
    (add5 10)
  `);

  assertEquals(arrayResult, [2, 4, 6, 8, 10]);
  assertEquals(objectResult, 10);
  assertEquals(closureResult, 15);
});

Deno.test("JS interop: importing JS functions, constants, and classes works", async () => {
  const jsFunction = await run(`
    (import [jsDivide] from "./test/fixtures/js-module.js")
    (jsDivide 20 4)
  `);
  const jsConst = await run(`
    (import [JS_VERSION] from "./test/fixtures/js-module.js")
    JS_VERSION
  `);
  const jsClass = await run(`
    (import [JsCounter] from "./test/fixtures/js-module.js")
    (var counter (js-new JsCounter (10)))
    (js-call counter "increment")
    (js-call counter "increment")
    (js-call counter "getValue")
  `);

  assertEquals(jsFunction, 5);
  assertEquals(jsConst, "ES6");
  assertEquals(jsClass, 12);
});

Deno.test("JS interop: transpile output is usable as a JavaScript module", async () => {
  const transpileResult = await transpile(`
    (fn double [x] (* x 2))
    (fn triple [x] (* x 3))
    (export [double triple])
  `);
  const jsCode = typeof transpileResult === "string"
    ? transpileResult
    : transpileResult.code;

  assertEquals(jsCode.includes("export"), true);
  assertEquals(jsCode.includes("double"), true);

  await withTempModule("test-hql-module.mjs", jsCode, (module) => {
    assertEquals((module.double as (n: number) => number)(5), 10);
    assertEquals((module.triple as (n: number) => number)(4), 12);
  });
});

Deno.test("JS interop: circular HQL-JS imports still resolve", async () => {
  const result = await run(`
    (import [circularFunction] from "./test/fixtures/circular/a.hql")
    (circularFunction)
  `);
  assertEquals(result, 20);
});
