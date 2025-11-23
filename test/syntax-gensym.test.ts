/**
 * Tests for gensym - unique symbol generation for hygienic macros
 * Demonstrates production-ready macro hygiene using Common Lisp style
 */

import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import hql from "../mod.ts";
import { resetRuntime } from "../mod.ts";

async function run(code: string): Promise<unknown> {
  return await hql.run(code);
}

// =============================================================================
// BASIC GENSYM FUNCTIONALITY
// =============================================================================

Deno.test("gensym: generates unique symbols", async () => {
  const code = `
(var s1 (gensym))
(var s2 (gensym))
[s1 s2]
`;
  const result = await run(code) as string[];
  assertEquals(result.length, 2);
  assertNotEquals(
    result[0],
    result[1],
    "Each gensym call should produce unique symbol",
  );
});

Deno.test("gensym: uses default prefix 'g'", async () => {
  await resetRuntime();
  const code = `(gensym)`;
  const result = await run(code) as string;
  assertEquals(result.startsWith("g_"), true, "Default prefix should be 'g'");
});

Deno.test("gensym: accepts custom prefix", async () => {
  await resetRuntime();
  const code = `(gensym "temp")`;
  const result = await run(code) as string;
  assertEquals(result.startsWith("temp_"), true, "Should use custom prefix");
});

Deno.test("gensym: generates sequential unique names", async () => {
  await resetRuntime();
  const code = `
[
  (gensym "x")
  (gensym "x")
  (gensym "x")
]
`;
  const result = await run(code) as string[];
  assertEquals(result.length, 3);
  // Each should be unique even with same prefix
  assertNotEquals(result[0], result[1]);
  assertNotEquals(result[1], result[2]);
  assertNotEquals(result[0], result[2]);
});

// =============================================================================
// MACRO HYGIENE WITH GENSYM
// =============================================================================

Deno.test("gensym: prevents variable capture in macros", async () => {
  const code = `
(macro with-temp (value & body)
  (var tmp (gensym "temp"))
  \`(let (~tmp ~value)
     ~@body))

(var temp 999)
(with-temp 100
  temp)
`;
  const result = await run(code);
  // The outer 'temp' should still be 999 because macro used unique gensym'd name
  assertEquals(result, 999, "Macro should not capture user's 'temp' variable");
});

Deno.test("gensym: allows macro to use unique bindings", async () => {
  const code = `
(macro with-unique (value & body)
  (var unique_var (gensym "temp"))
  \`(let (~unique_var ~value)
     ~@body))

(with-unique 42
  (gensym))
`;
  // This test verifies that gensym can be used inside macro expansion
  // The macro creates a unique binding that doesn't conflict with anything
  const result = await run(code) as string;
  assertEquals(typeof result, "string");
  assertEquals(result.startsWith("g_"), true);
});

// =============================================================================
// REAL-WORLD MACRO PATTERNS
// =============================================================================

Deno.test("gensym: swap macro with proper hygiene", async () => {
  const code = `
(macro swap (a b)
  (var tmp (gensym "swap_tmp"))
  \`(let (~tmp ~a)
     (set! ~a ~b)
     (set! ~b ~tmp)))

(var x 10)
(var y 20)
(swap x y)
[x y]
`;
  const result = await run(code) as number[];
  assertEquals(
    result,
    [20, 10],
    "swap should exchange values without variable capture",
  );
});

Deno.test("gensym: when-let macro with gensym binding", async () => {
  const code = `
(macro when-let (binding & body)
  (var tmp (gensym "tmp"))
  (var value_sym (gensym "val"))
  \`(let (~value_sym ~(%nth binding 1))
     (if ~value_sym
       (let (~(%nth binding 0) ~value_sym)
         ~@body)
       nil)))

(when-let (x 42)
  (+ x 10))
`;
  const result = await run(code);
  assertEquals(result, 52, "when-let should bind value if truthy");
});

Deno.test("gensym: nested macros each get unique symbols", async () => {
  const code = `
(macro outer (x)
  (var tmp1 (gensym "outer"))
  \`(let (~tmp1 ~x)
     ~tmp1))

(macro inner (y)
  (var tmp2 (gensym "inner"))
  \`(let (~tmp2 ~y)
     ~tmp2))

(outer (inner 42))
`;
  const result = await run(code);
  assertEquals(
    result,
    42,
    "Nested macros should each use unique gensym'd names",
  );
});

// =============================================================================
// COMPARISON: MANUAL VS GENSYM HYGIENE
// =============================================================================

Deno.test("gensym: compare manual vs gensym hygiene", async () => {
  // Manual hygiene - fragile, can break if user picks same name
  const manualCode = `
(macro manual_double (n)
  \`(let (temp_12345_manual ~n)
     (+ temp_12345_manual temp_12345_manual)))

(manual_double 5)
`;
  const manualResult = await run(manualCode);
  assertEquals(manualResult, 10);

  // gensym hygiene - guaranteed unique, never breaks
  const gensymCode = `
(macro gensym_double (n)
  (var tmp (gensym "temp"))
  \`(let (~tmp ~n)
     (+ ~tmp ~tmp)))

(gensym_double 5)
`;
  const gensymResult = await run(gensymCode);
  assertEquals(gensymResult, 10);

  // Both work, but gensym is safer and more idiomatic
});

// =============================================================================
// EDGE CASES
// =============================================================================

Deno.test("gensym: works across multiple macro invocations", async () => {
  const code = `
(macro add_one (n)
  (var tmp (gensym "x"))
  \`(let (~tmp ~n)
     (+ ~tmp 1)))

[
  (add_one 10)
  (add_one 20)
  (add_one 30)
]
`;
  const result = await run(code) as number[];
  assertEquals(
    result,
    [11, 21, 31],
    "Each macro invocation gets unique gensym",
  );
});

Deno.test("gensym: multiple gensyms in same macro", async () => {
  const code = `
(macro complex (a b)
  (var tmp1 (gensym "x"))
  (var tmp2 (gensym "y"))
  \`(let (~tmp1 ~a)
     (let (~tmp2 ~b)
       (+ ~tmp1 ~tmp2))))

(complex 5 7)
`;
  const result = await run(code);
  assertEquals(result, 12, "Macro can use multiple unique gensym'd names");
});

Deno.test("gensym: empty prefix still works", async () => {
  const code = `(gensym "")`;
  const result = await run(code) as string;
  assertEquals(
    result.includes("_"),
    true,
    "Even empty prefix should produce valid symbol",
  );
});
