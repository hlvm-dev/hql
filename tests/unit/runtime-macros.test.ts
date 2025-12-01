/**
 * Runtime Macro Tests for HQL
 * Tests the runtime macro functionality including definition, expansion, and execution
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.210.0/assert/mod.ts";
import {
  defineMacro,
  getMacros,
  hasMacro,
  hqlEval,
  macroexpand1Runtime,
  macroexpandRuntime,
  resetRuntime,
} from "../../mod.ts";
import hql from "../../mod.ts";

Deno.test("Runtime Macros - Basic Definition", async () => {
  await resetRuntime();
  await defineMacro("(macro test1 [] 42)");

  const hasMacroTest = await hasMacro("test1");
  assertEquals(hasMacroTest, true, "Macro should be defined");

  const macros = await getMacros();
  assertExists(macros.test1, "Macro should be in registry");
});

Deno.test("Runtime Macros - Parameter Substitution", async () => {
  await resetRuntime();
  await defineMacro("(macro add-one [x] `(+ 1 ~x))");

  const expanded = await macroexpandRuntime("(add-one 5)") as unknown[];
  assertEquals(expanded[0], "+");
  assertEquals(expanded[1], 1);
  assertEquals(expanded[2], 5);

  const js = await hqlEval("(add-one 5)");
  assertEquals(
    js.includes("1") && js.includes("5"),
    true,
    "Should contain both values",
  );
});

Deno.test("Runtime Macros - Rest Parameters", async () => {
  await resetRuntime();
  await defineMacro("(macro mylist [& args] `(list ~@args))");

  const macros = await getMacros();
  assertEquals(macros.mylist.params.length, 0, "Should have no regular params");
  assertEquals(macros.mylist.restParam, "args", "Should have rest param");

  const expanded = await macroexpandRuntime("(mylist 1 2 3)") as unknown[];
  assertEquals(expanded[0], "list");
  assertEquals(expanded.length, 4, "Should have list + 3 args");
});

Deno.test("Runtime Macros - Mixed Parameters", async () => {
  await resetRuntime();
  await defineMacro(
    "(macro unless [test & body] `(if (not ~test) (do ~@body)))",
  );

  const macros = await getMacros();
  assertEquals(macros.unless.params, ["test"]);
  assertEquals(macros.unless.restParam, "body");

  const expanded = await macroexpandRuntime(
    "(unless false (print 1))",
  ) as unknown[];
  assertEquals(expanded[0], "if");
  const condition = expanded[1] as unknown[];
  assertEquals(condition[0], "not");
});

Deno.test("Runtime Macros - Empty Parameters", async () => {
  await resetRuntime();
  await defineMacro("(macro constant [] 999)");

  const macros = await getMacros();
  assertEquals(macros.constant.params.length, 0);
  assertEquals(macros.constant.restParam, null);

  const js = await hqlEval("(constant)");
  assertEquals(js.includes("999"), true);
});

Deno.test("Runtime Macros - Persistence Across Evaluations", async () => {
  await resetRuntime();

  await defineMacro("(macro m1 [] 1)");
  await defineMacro("(macro m2 [] 2)");

  assertEquals(await hasMacro("m1"), true);
  assertEquals(await hasMacro("m2"), true);

  const js1 = await hqlEval("(m1)");
  const js2 = await hqlEval("(m2)");

  assertEquals(js1.includes("1"), true);
  assertEquals(js2.includes("2"), true);
});

Deno.test("Runtime Macros - Reset Functionality", async () => {
  await resetRuntime();
  await defineMacro("(macro before-reset [] 100)");
  assertEquals(await hasMacro("before-reset"), true);

  await resetRuntime();
  assertEquals(
    await hasMacro("before-reset"),
    false,
    "Should be cleared after reset",
  );

  await defineMacro("(macro after-reset [] 200)");
  assertEquals(await hasMacro("after-reset"), true);
});

Deno.test("Runtime Macros - Isolation from Stateless Compiler", async () => {
  await resetRuntime();
  await defineMacro("(macro runtime-only [] 777)");

  // Stateless compiler should not see runtime macros
  const transpileResult = await hql.transpile("(runtime-only)");
  const statelessJs = typeof transpileResult === "string"
    ? transpileResult
    : transpileResult.code;
  assertEquals(
    statelessJs.includes("777"),
    false,
    "Stateless should not expand runtime macro",
  );
  // Note: hyphens in names are converted to underscores in JS
  assertEquals(
    statelessJs.includes("runtime_only"),
    true,
    "Should treat as function call",
  );

  // Runtime should see and expand the macro
  const runtimeJs = await hqlEval("(runtime-only)");
  assertEquals(runtimeJs.includes("777"), true, "Runtime should expand macro");
});

Deno.test("Runtime Macros - Complex Nested Expansion", async () => {
  await resetRuntime();
  await defineMacro("(macro m1 [x] `(+ 1 ~x))");
  await defineMacro("(macro m2 [x] `(* 2 ~x))");

  const js = await hqlEval("(m2 (m1 5))");
  assertEquals(
    js.includes("*") || js.includes("+"),
    true,
    "Should contain operators",
  );
});

Deno.test("Runtime Macros - Macroexpand vs Macroexpand1", async () => {
  await resetRuntime();
  await defineMacro("(macro twice [x] `(+ ~x ~x))");

  const expanded1 = await macroexpand1Runtime("(twice 7)") as unknown;
  assertEquals(Array.isArray(expanded1), true);
  const expanded1List = expanded1 as unknown[];
  assertEquals(expanded1List[0], "+");

  const expandedFull = await macroexpandRuntime("(twice 7)") as unknown[];
  assertEquals(expandedFull[0], "+");
  assertEquals(expandedFull[1], 7);
  assertEquals(expandedFull[2], 7);
});

Deno.test("Runtime Macros - No Re-tagging Warnings", async () => {
  await resetRuntime();
  await defineMacro("(macro test [] 42)");

  // Multiple evaluations should not produce warnings
  await hqlEval("(test)");
  await hqlEval("(test)");
  await hqlEval("(test)");
  // If warnings existed, they would appear in console
  // This test passes if no "Cannot redefine property" warnings appear
});

Deno.test("Runtime Macros - Cache Invalidation", async () => {
  await resetRuntime();

  // Define macro after potential caching
  await defineMacro("(macro cache-test [] 888)");
  const js = await hqlEval("(cache-test)");

  assertEquals(js.includes("888"), true, "Should expand despite any caching");
});
