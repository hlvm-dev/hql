import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.170.0/testing/asserts.ts";
import { runHQLFile, getExport } from "./hql.ts";

// ---------- Arithmetic Operations Test ----------
Deno.test("Arithmetic operations", async () => {
  const code = `
    (def addTest (fn ((a Number) (b Number)) (+ a b)))
    (export "addTest" addTest)
  `;
  const testFile = "temp_arithmetic.hql";
  await Deno.writeTextFile(testFile, code);
  await runHQLFile(testFile);
  const addTest = getExport("addTest");
  // addTest is defined with "def", so it returns an async function.
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
  await runHQLFile(testFile);
  assertEquals(getExport("condTrue"), 100);
  assertEquals(getExport("condFalse"), 200);
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
  await runHQLFile(testFile);
  // (quote (1 2 3)) is parsed as a list; conversion yields a JS array.
  assertEquals(getExport("quoted"), [1, 2, 3]);
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
  await runHQLFile(testFile);
  assertEquals(getExport("myVar"), 42);
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
  await runHQLFile(testFile);
  assertEquals(getExport("result"), 10);
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
  await runHQLFile(testFile);
  // The built‑in list produces an HQL list which converts to a JS array.
  assertEquals(getExport("myList"), [1, 2, 3]);
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
  await runHQLFile(testFile);
  // Our hash-map built‑in creates a list starting with the symbol "hash-map".
  assertEquals(getExport("myMap"), ["hash-map", "a", 1, "b", 2]);
  await Deno.remove(testFile);
});

// ---------- Set Built-in Test ----------
Deno.test("Set built-in", async () => {
  const code = `
    (def mySet (set 1 2 3))
    (export "mySet" mySet)
  `;
  const testFile = "temp_set.hql";
  await Deno.writeTextFile(testFile, code);
  await runHQLFile(testFile);
  assertEquals(getExport("mySet"), ["set", 1, 2, 3]);
  await Deno.remove(testFile);
});

// ---------- String-append Built-in Test ----------
Deno.test("String-append built-in", async () => {
  const code = `
    (def concatStr (string-append "hello" " " "world"))
    (export "concatStr" concatStr)
  `;
  const testFile = "temp_string_append.hql";
  await Deno.writeTextFile(testFile, code);
  await runHQLFile(testFile);
  assertEquals(getExport("concatStr"), "hello world");
  await Deno.remove(testFile);
});

// ---------- Macro Expansion Test ----------
Deno.test("Macro expansion", async () => {
  // Note: The macro now uses explicit quoting so that literal symbols (such as if and not)
  // are not looked up during macro expansion.
  const code = `
    (def not (fn ((x Boolean)) (if x false true)))
    (defmacro myunless (cond body) 
      (list (quote if) (list (quote not) cond) body 0))
    (def macroResult (myunless false 456))
    (export "macroResult" macroResult)
  `;
  const testFile = "temp_macro.hql";
  await Deno.writeTextFile(testFile, code);
  await runHQLFile(testFile);
  // (myunless false 456) expands to (if (list (quote not) false) 456 0)
  // which in turn calls (not false) → true so the if returns 456.
  assertEquals(getExport("macroResult"), 456);
  await Deno.remove(testFile);
});

// ---------- Undefined Symbol Error Test ----------
// Use assertRejects for async failures.
Deno.test("Undefined symbol error", async () => {
  const code = `
    (def errorTest (nonexistentFunction 10))
    (export "errorTest" errorTest)
  `;
  const testFile = "temp_undefined.hql";
  await Deno.writeTextFile(testFile, code);
  await assertRejects(
    async () => {
      await runHQLFile(testFile);
    },
    Error,
    "Symbol 'nonexistentFunction' not found"
  );
  await Deno.remove(testFile);
});

// ---------- Non-function Call Error Test ----------
Deno.test("Non-function call error", async () => {
  const code = `
    (def notAFunction 10)
    (def callError (notAFunction 5))
    (export "callError" callError)
  `;
  const testFile = "temp_nonfunction.hql";
  await Deno.writeTextFile(testFile, code);
  await assertRejects(
    async () => {
      await runHQLFile(testFile);
    },
    Error,
    "Attempt to call non-function"
  );
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
  await runHQLFile(testFile);
  assertEquals(getExport("sum"), 7);
  assertEquals(getExport("getValue"), 42);
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
  await runHQLFile(testFile);
  // Calculation: 2*3=6, 10-4=6, 20/5=4, so 6+6+4=16.
  assertEquals(getExport("complexArith"), 16);
  await Deno.remove(testFile);
});
