import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.170.0/testing/asserts.ts";
import { runHQLFile, getExport } from "./hql.ts";

// ---------- Arithmetic Operations Test (untyped) ----------
Deno.test("Arithmetic operations (untyped)", async () => {
  const code = `
    (def addTest (fn (a b) (+ a b)))
    (export "addTest" addTest)
  `;
  const testFile = "temp_arithmetic.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const addTest = getExport("addTest", exportsMap);
  assertEquals(await addTest(5, 7), 12);
  await Deno.remove(testFile);
});

// ---------- Conditional ("if") Test ----------
Deno.test("Conditionals", async () => {
  const code = `
    (def condTrue (if true 100 200))
    (def condFalse (if false 100 200))
    (export "condTrue" condTrue)
    (export "condFalse" condFalse)
  `;
  const testFile = "temp_conditionals.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  assertEquals(getExport("condTrue", exportsMap), 100);
  assertEquals(getExport("condFalse", exportsMap), 200);
  await Deno.remove(testFile);
});

// ---------- Quoting Test ----------
Deno.test("Quoting", async () => {
  const code = `
    (def quoted (quote (1 2 3)))
    (export "quoted" quoted)
  `;
  const testFile = "temp_quoting.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  assertEquals(getExport("quoted", exportsMap), [1, 2, 3]);
  await Deno.remove(testFile);
});

// ---------- Definition and Retrieval Test ----------
Deno.test("Definition and retrieval", async () => {
  const code = `
    (def myVar 42)
    (export "myVar" myVar)
  `;
  const testFile = "temp_definition.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  assertEquals(getExport("myVar", exportsMap), 42);
  await Deno.remove(testFile);
});

// ---------- Function Invocation Test (untyped) ----------
Deno.test("Function invocation (untyped)", async () => {
  const code = `
    (def double (fn (x) (+ x x)))
    (def result (double 5))
    (export "result" result)
  `;
  const testFile = "temp_function.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  assertEquals(getExport("result", exportsMap), 10);
  await Deno.remove(testFile);
});

// ---------- Labeled Call Test for Typed Functions ----------
Deno.test("Labeled call for typed functions", async () => {
  const code = `
    (defn minus (x: Number y: Number) (-> Number)
      (- x y))
    (export "minus" minus)
  `;
  const testFile = "temp_typed_call.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const minus = getExport("minus", exportsMap);
  // Calling typed function using JS style: pass an opaque object wrapping a plain object.
  assertEquals(await minus({ "x:": 100, "y:": 20 }), 80);
  // Alternatively, calling in HQL S–expression form would be: (minus x: 100 y: 20)
  await Deno.remove(testFile);
});

// ---------- Test that untyped function calls must be positional ----------
Deno.test("Untyped function call rejects labels", async () => {
  const code = `
    (defn add (x y) (+ x y))
    (export "add" add)
  `;
  const testFile = "temp_untyped_labels.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const add = getExport("add", exportsMap);
  await assertRejects(
    async () => { await add({ "x:": 3, "y:": 20 }); },
    Error,
    "Call to an untyped function must use positional arguments"
  );
  await Deno.remove(testFile);
});

// ---------- Built-in "get" with JS Object Test ----------
Deno.test("Built-in get with JS object", async () => {
  const jsModuleCode = `
    export function add(x, y) { return x + y; }
    export const value = 42;
  `;
  const jsModuleFile = "temp_obj.js";
  await Deno.writeTextFile(jsModuleFile, jsModuleCode);

  const code = `
    (def myObj (import "./temp_obj.js"))
    (def addFunc (get myObj "add"))
    (def sum (addFunc 3 4))
    (def getValue (get myObj "value"))
    (export "sum" sum)
    (export "getValue" getValue)
  `;
  const testFile = "temp_get.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  assertEquals(getExport("sum", exportsMap), 7);
  assertEquals(getExport("getValue", exportsMap), 42);
  await Deno.remove(testFile);
  await Deno.remove(jsModuleFile);
});

// ---------- Complex Arithmetic Expression Test ----------
Deno.test("Complex arithmetic expression", async () => {
  const code = `
    (def complexArith (+ (* 2 3) (- 10 4) (/ 20 5)))
    (export "complexArith" complexArith)
  `;
  const testFile = "temp_complex_arith.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  assertEquals(getExport("complexArith", exportsMap), 16);
  await Deno.remove(testFile);
});

// ---------- New Special Form - Date ----------
Deno.test("New Special Form - Date", async () => {
  const code = `
    (def testDate (new Date))
    (export "testDate" testDate)
  `;
  const tempFile = "temp_new_date.hql";
  await Deno.writeTextFile(tempFile, code);
  const exportsMap = await runHQLFile(tempFile);
  const testDate = getExport("testDate", exportsMap);
  // Check that the value is an instance of Date.
  if (!(testDate instanceof Date)) {
    throw new Error("testDate should be an instance of Date");
  }
  await Deno.remove(tempFile);
});

// ---------- New Special Form - RegExp ----------
Deno.test("New Special Form - RegExp", async () => {
  const code = `
    (def testRegExp (new RegExp "abc" "i"))
    (export "testRegExp" testRegExp)
  `;
  const tempFile = "temp_new_regexp.hql";
  await Deno.writeTextFile(tempFile, code);
  const exportsMap = await runHQLFile(tempFile);
  const testRegExp = getExport("testRegExp", exportsMap);
  if (!(testRegExp instanceof RegExp)) {
    throw new Error("testRegExp should be an instance of RegExp");
  }
  assertEquals(testRegExp.source, "abc");
  assertEquals(testRegExp.flags, "i");
  await Deno.remove(tempFile);
});

// ---------- New Special Form - Array ----------
Deno.test("New Special Form - Array", async () => {
  const code = `
    (def testArray (new Array 1 2 3))
    (export "testArray" testArray)
  `;
  const tempFile = "temp_new_array.hql";
  await Deno.writeTextFile(tempFile, code);
  const exportsMap = await runHQLFile(tempFile);
  const testArray = getExport("testArray", exportsMap);
  if (!Array.isArray(testArray)) {
    throw new Error("testArray should be an array");
  }
  assertEquals(testArray, [1, 2, 3]);
  await Deno.remove(tempFile);
});

// ---------- New Special Form - Map ----------
Deno.test("New Special Form - Map", async () => {
  const code = `
    (def testMap (new Map))
    (export "testMap" testMap)
  `;
  const tempFile = "temp_new_map.hql";
  await Deno.writeTextFile(tempFile, code);
  const exportsMap = await runHQLFile(tempFile);
  const testMap = getExport("testMap", exportsMap);
  if (!(testMap instanceof Map)) {
    throw new Error("testMap should be an instance of Map");
  }
  assertEquals(testMap.size, 0);
  await Deno.remove(tempFile);
});

// ---------- New Special Form - Set ----------
Deno.test("New Special Form - Set", async () => {
  const code = `
    (def testSet (new Set (list 1 2 3)))
    (export "testSet" testSet)
  `;
  const tempFile = "temp_new_set.hql";
  await Deno.writeTextFile(tempFile, code);
  const exportsMap = await runHQLFile(tempFile);
  const testSet = getExport("testSet", exportsMap);
  if (!(testSet instanceof Set)) {
    throw new Error("testSet should be an instance of Set");
  }
  // Expect size 3.
  assertEquals(testSet.size, 3);
  await Deno.remove(tempFile);
});

// ---------- New Special Form - Error ----------
Deno.test("New Special Form - Error", async () => {
  const code = `
    (def testError (new Error "test error"))
    (export "testError" testError)
  `;
  const tempFile = "temp_new_error.hql";
  await Deno.writeTextFile(tempFile, code);
  const exportsMap = await runHQLFile(tempFile);
  const testError = getExport("testError", exportsMap);
  if (!(testError instanceof Error)) {
    throw new Error("testError should be an instance of Error");
  }
  assertEquals(testError.message, "test error");
  await Deno.remove(tempFile);
});

// ---------- New Special Form - URL ----------
Deno.test("New Special Form - URL", async () => {
  const code = `
    (def testURL (new URL "https://example.com"))
    (export "testURL" testURL)
  `;
  const tempFile = "temp_new_url.hql";
  await Deno.writeTextFile(tempFile, code);
  const exportsMap = await runHQLFile(tempFile);
  const testURL = getExport("testURL", exportsMap);
  if (!(testURL instanceof URL)) {
    throw new Error("testURL should be an instance of URL");
  }
  assertEquals(testURL.href, "https://example.com/");
  await Deno.remove(tempFile);
});
