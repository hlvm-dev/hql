import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.170.0/testing/asserts.ts";
import { runHQLFile, getExport } from "../hql.ts";

// ---------- Enum and Fully Qualified Enum Case ----------
Deno.test("Enum and fully qualified enum case", async () => {
  const code = `
    (defenum Destination hlvm macos ios)
    (defn send (message: String to: Destination) message)
    (defn send2 (message: String to: Destination) (-> Void) message)
    (export "result1" (send message: "hello1" to: .hlvm))
    (export "result2" (send2 message: "hello2" to: Destination.hlvm))
  `;
  const testFile = "temp_enum.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const result1 = getExport("result1", exportsMap);
  const result2 = getExport("result2", exportsMap);
  assertEquals(result1, "hello1");
  assertEquals(result2, "hello2");
  await Deno.remove(testFile);
});

// ---------- String Interpolation Test using the new reader macro  ----------
Deno.test("String interpolation", async () => {
  const code = `
    (def name "Alice")
    (def otherValue "Bob")
    (export "interp" "hello my name is \\(name) and nice to meet you - \\(otherValue)")
  `;
  const testFile = "temp_interp.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const interp = getExport("interp", exportsMap);
  assertEquals(interp, "hello my name is Alice and nice to meet you - Bob");
  await Deno.remove(testFile);
});

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
  assertEquals(await minus({ "x:": 100, "y:": 20 }), 80);
  await Deno.remove(testFile);
});

// ---------- Updated Test: Untyped function call supports labeled arguments ----------
Deno.test("Untyped function call supports labeled arguments", async () => {
  const code = `
    (defn add (x y) (+ x y))
    (export "add" add)
  `;
  const testFile = "temp_untyped_labels.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const add = getExport("add", exportsMap);
  assertEquals(await add({ "x:": 3, "y:": 20 }), 23);
  assertEquals(await add("x:", 3, "y:", 20), 23);
  assertEquals(await add(3, 20), 23);
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

// ---------- Additional Tests for Typed Function Calls ----------

Deno.test("Typed function call using positional arguments", async () => {
  const code = `
    (defx multiply (x: Int y: Int) (-> Int)
      (* x y))
    (export "multiply" multiply)
  `;
  const testFile = "temp_typed_positional.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const multiply = getExport("multiply", exportsMap);
  assertEquals(await multiply(10, 20), 200);
  await Deno.remove(testFile);
});

Deno.test("Typed function call using labeled arguments", async () => {
  const code = `
    (defx multiply (x: Int y: Int) (-> Int)
      (* x y))
    (export "multiply" multiply)
  `;
  const testFile = "temp_typed_labeled.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const multiply = getExport("multiply", exportsMap);
  assertEquals(await multiply({ "x:": 10, "y:": 20 }), 200);
  await Deno.remove(testFile);
});

Deno.test("Typed function call using opaque object mapping", async () => {
  const code = `
    (defx multiply (x: Int y: Int) (-> Int)
      (* x y))
    (export "multiply" multiply)
  `;
  const testFile = "temp_typed_object.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const multiply = getExport("multiply", exportsMap);
  assertEquals(await multiply({ "x:": 10, "y:": 20 }), 200);
  await Deno.remove(testFile);
});

Deno.test("Typed function call with mixed labeled and positional arguments should reject", async () => {
  const code = `
    (defx multiply (x: Int y: Int) (-> Int)
      (* x y))
    (export "multiply" multiply)
  `;
  const testFile = "temp_typed_mixed.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const multiply = getExport("multiply", exportsMap);
  await assertRejects(
    async () => { await multiply({ "x:": 10 }, 20); },
    Error,
    "Mixed labeled and positional arguments are not allowed"
  );
  await Deno.remove(testFile);
});

Deno.test("Extra parentheses in typed function definition", async () => {
  const code = `
    (defx extraMultiply ((x: Int y: Int) (-> Int))
      (* x y))
    (export "extraMultiply" extraMultiply)
  `;
  const testFile = "temp_extra_parentheses.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const extraMultiply = getExport("extraMultiply", exportsMap);
  assertEquals(await extraMultiply(3, 4), 12);
  assertEquals(await extraMultiply({ "x:": 3, "y:": 4 }), 12);
  await Deno.remove(testFile);
});

Deno.test("Typed function call with missing labeled argument", async () => {
  const code = `
    (defx multiply (x: Int y: Int) (-> Int)
      (* x y))
    (export "multiply" multiply)
  `;
  const testFile = "temp_typed_missing.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const multiply = getExport("multiply", exportsMap);
  await assertRejects(
    async () => { await multiply({ "x:": 10 }); },
    Error,
    "Missing argument for parameter 'y'"
  );
  await Deno.remove(testFile);
});

Deno.test("Typed function call with extra arguments should reject", async () => {
  const code = `
    (defx multiply (x: Int y: Int) (-> Int)
      (* x y))
    (export "multiply" multiply)
  `;
  const testFile = "temp_typed_extra.hql";
  await Deno.writeTextFile(testFile, code);
  const exportsMap = await runHQLFile(testFile);
  const multiply = getExport("multiply", exportsMap);
  await assertRejects(
    async () => { await multiply(10, 20, 30); },
    Error,
    "Expected 2 arguments"
  );
  await Deno.remove(testFile);
});
