import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.170.0/testing/asserts.ts";
import { runHQLFile, getExport } from "./hql.ts";

// ---------- Arithmetic Operations Test ----------
Deno.test("Arithmetic operations", async () => {
  const code = `
    (def addTest (fn ((a Number) (b Number)) (+ a b)))
    (export "addTest" addTest)
  `;
  const testFile = "temp_arithmetic.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const addTest = getExport("addTest", exportsMap);
  // addTest is async, so await its result.
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
  // (quote (1 2 3)) is converted to a JS array.
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

// ---------- Function Invocation Test ----------
Deno.test("Function invocation", async () => {
  const code = `
    (def double (fn ((x Number)) (+ x x)))
    (def result (double 5))
    (export "result" result)
  `;
  const testFile = "temp_function.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  assertEquals(getExport("result", exportsMap), 10);
  await Deno.remove(testFile);
});

// ---------- List Built-in Test ----------
Deno.test("List built-in", async () => {
  const code = `
    (def myList (list 1 2 3))
    (export "myList" myList)
  `;
  const testFile = "temp_list.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  assertEquals(getExport("myList", exportsMap), [1, 2, 3]);
  await Deno.remove(testFile);
});

// ---------- Hash-map Built-in Test ----------
Deno.test("Hash-map built-in", async () => {
  const code = `
    (def myMap (hash-map "a" 1 "b" 2))
    (export "myMap" myMap)
  `;
  const testFile = "temp_hashmap.hql";
  await Deno.writeTextFile(testFile, code);
  // Our hash-map built-in creates a list beginning with the symbol "hash-map".
  const exportsMap = await runHQLFile(testFile);
  assertEquals(getExport("myMap", exportsMap), ["hash-map", "a", 1, "b", 2]);
  await Deno.remove(testFile);
});

// ---------- Set Built-in Test ----------
Deno.test("Set built-in", async () => {
  const code = `
    (def mySet (set 1 2 3 4))
    (export "mySet" mySet)
  `;
  const testFile = "temp_set.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  assertEquals(getExport("mySet", exportsMap), ["set", 1, 2, 3, 4]);
  await Deno.remove(testFile);
});

// ---------- String-append Built-in Test ----------
Deno.test("String-append built-in", async () => {
  const code = `
    (def concatStr (string-append "hello" " world"))
    (export "concatStr" concatStr)
  `;
  const testFile = "temp_string_append.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  assertEquals(getExport("concatStr", exportsMap), "hello world");
  await Deno.remove(testFile);
});

// ---------- Macro Expansion Test ----------
Deno.test("Macro expansion", async () => {
  // This test uses a simple macro that expands to a value.
  const code = `
    (def not (fn ((x Boolean)) (if x false true)))
    (defmacro myunless (cond body) 
      (list (quote if) (list (quote not) cond) body 0))
    (def macroResult (myunless false 456))
    (export "macroResult" macroResult)
  `;
  const testFile = "temp_macro.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  // (myunless false 456) should expand to 456.
  assertEquals(getExport("macroResult", exportsMap), 456);
  await Deno.remove(testFile);
});

// ---------- Built-in "get" with JS Object Test ----------
Deno.test("Built-in get with JS object", async () => {
  // Create a temporary JS module.
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
  // Calculation: 2*3=6, 10-4=6, 20/5=4, so 6+6+4=16.
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
  assert(testDate instanceof Date, "testDate should be an instance of Date");
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
  assert(testRegExp instanceof RegExp, "testRegExp should be an instance of RegExp");
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
  assert(Array.isArray(testArray), "testArray should be an array");
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
  assert(testMap instanceof Map, "testMap should be an instance of Map");
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
  assert(testSet instanceof Set, "testSet should be an instance of Set");
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
  assert(testError instanceof Error, "testError should be an instance of Error");
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
  // global fallback should provide URL from globalThis.
  assert(testURL instanceof URL, "testURL should be an instance of URL");
  assertEquals(testURL.href, "https://example.com/");
  await Deno.remove(tempFile);
});
