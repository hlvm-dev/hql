/**
 * Explicit tests for runtime helper embedding
 *
 * These tests verify that runtime helpers are properly embedded in transpiled output,
 * ensuring transpiled code can run standalone without runtime dependencies.
 *
 * This provides explicit regression protection for the 100% shared architecture.
 */

import { transpile } from "../../mod.ts";
import { assertEquals } from "jsr:@std/assert";

Deno.test("Helper Embedding: __hql_deepFreeze is embedded when const is used", async () => {
  const hqlCode = `(const x 42)`;
  const result = await transpile(hqlCode);
  const code = typeof result === 'string' ? result : result.code || '';

  // Verify __hql_deepFreeze is embedded
  assertEquals(
    code.includes("__hql_deepFreeze"),
    true,
    "Transpiled code must include __hql_deepFreeze when const is used"
  );

  // Verify the function definition is present (not just a call)
  assertEquals(
    code.includes("function __hql_deepFreeze"),
    true,
    "Transpiled code must define __hql_deepFreeze function"
  );

  // Verify it can run standalone
  try {
    const fn = new Function(code);
    fn(); // Should not throw ReferenceError
  } catch (error) {
    throw new Error(
      `Transpiled code failed standalone execution: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

Deno.test("Helper Embedding: __hql_deepFreeze is embedded with exports", async () => {
  const hqlCode = `(const PI 3.14) (export [PI])`;
  const result = await transpile(hqlCode);
  const code = typeof result === 'string' ? result : result.code || '';

  // Verify __hql_deepFreeze is embedded
  assertEquals(
    code.includes("__hql_deepFreeze"),
    true,
    "Transpiled code with exports must include __hql_deepFreeze"
  );

  // Verify export statement is present
  assertEquals(
    code.includes("export"),
    true,
    "Transpiled code must have export statement"
  );

  // Verify NO IIFE wrapping (would break exports)
  const hasIIFE = code.includes("(function()") || code.includes("(function ()");
  assertEquals(
    hasIIFE,
    false,
    "Transpiled code with exports must NOT be wrapped in IIFE"
  );
});

Deno.test("Helper Embedding: __hql_deepFreeze handles multiple const bindings", async () => {
  const hqlCode = `(const a 1) (const b 2) (const c 3)`;
  const result = await transpile(hqlCode);
  const code = typeof result === 'string' ? result : result.code || '';

  // Verify __hql_deepFreeze is embedded
  assertEquals(
    code.includes("__hql_deepFreeze"),
    true,
    "Transpiled code must include __hql_deepFreeze for multiple const bindings"
  );

  // Verify all const bindings use __hql_deepFreeze
  const deepFreezeCallCount = (code.match(/__hql_deepFreeze\(/g) || []).length;
  assertEquals(
    deepFreezeCallCount >= 3,
    true,
    `Expected at least 3 __hql_deepFreeze calls, got ${deepFreezeCallCount}`
  );

  // Verify standalone execution
  try {
    const fn = new Function(code);
    fn();
  } catch (error) {
    throw new Error(
      `Multiple let bindings failed standalone: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

Deno.test("Helper Embedding: __hql_deepFreeze NOT embedded when only var is used", async () => {
  const hqlCode = `(var x 42)`;
  const result = await transpile(hqlCode);
  const code = typeof result === 'string' ? result : result.code || '';

  // Verify __hql_deepFreeze is NOT embedded (var doesn't use it)
  assertEquals(
    code.includes("__hql_deepFreeze"),
    false,
    "Transpiled code should NOT include __hql_deepFreeze when only var is used"
  );
});

Deno.test("Helper Embedding: __hql_range is embedded when range is used", async () => {
  const hqlCode = `(into [] (range 5))`;
  const result = await transpile(hqlCode);
  const code = typeof result === 'string' ? result : result.code || '';

  // Verify __hql_range is embedded
  assertEquals(
    code.includes("__hql_range"),
    true,
    "Transpiled code must include __hql_range when range is used"
  );

  // Verify rangeCore dependency is also embedded
  assertEquals(
    code.includes("rangeCore"),
    true,
    "Transpiled code must include rangeCore dependency"
  );
});

Deno.test("Helper Embedding: __hql_get is embedded when property access is used", async () => {
  const hqlCode = `(get {"a": 1} "a")`;
  const result = await transpile(hqlCode);
  const code = typeof result === 'string' ? result : result.code || '';

  // Verify __hql_get is embedded
  assertEquals(
    code.includes("__hql_get"),
    true,
    "Transpiled code must include __hql_get when get is used"
  );
});

Deno.test("Helper Embedding: Multiple helpers embedded when needed", async () => {
  const hqlCode = `(const nums (into [] (range 5)))`;
  const result = await transpile(hqlCode);
  const code = typeof result === 'string' ? result : result.code || '';

  // Verify multiple helpers are embedded
  const expectedHelpers = ["__hql_deepFreeze", "__hql_range"];

  for (const helper of expectedHelpers) {
    assertEquals(
      code.includes(helper),
      true,
      `Transpiled code must include ${helper}`
    );
  }
});

Deno.test("Helper Embedding: Verify single source of truth via function.toString()", async () => {
  const hqlCode = `(const x 1)`;
  const result = await transpile(hqlCode);
  const code = typeof result === 'string' ? result : result.code || '';

  // Extract the embedded __hql_deepFreeze function (now with visited parameter for cycle detection)
  const match = code.match(/function __hql_deepFreeze\(obj,?\s*visited\)?\s*\{[\s\S]*?\n\}/);

  assertEquals(
    match !== null,
    true,
    "Should find embedded __hql_deepFreeze function"
  );

  if (match) {
    const embeddedCode = match[0];

    // Verify key features are present (proves it's the real implementation)
    assertEquals(
      embeddedCode.includes("Object.isFrozen"),
      true,
      "Embedded function must check Object.isFrozen (circular reference protection)"
    );

    assertEquals(
      embeddedCode.includes("LazySeq"),
      true,
      "Embedded function must skip LazySeq objects"
    );

    assertEquals(
      embeddedCode.includes("Object.getOwnPropertyNames"),
      true,
      "Embedded function must freeze all properties"
    );

    assertEquals(
      embeddedCode.includes("Object.getOwnPropertySymbols"),
      true,
      "Embedded function must freeze symbol properties"
    );
  }
});

Deno.test("Helper Embedding: __hql_hash_map is embedded when map literal is used", async () => {
  const hqlCode = `{"a": 1, "b": 2, "c": 3}`;
  const result = await transpile(hqlCode);
  const code = typeof result === 'string' ? result : result.code || '';

  // Verify __hql_hash_map is embedded
  assertEquals(
    code.includes("__hql_hash_map"),
    true,
    "Transpiled code must include __hql_hash_map when map literal is used"
  );

  // Verify the function definition is present (not just a call)
  assertEquals(
    code.includes("function __hql_hash_map"),
    true,
    "Transpiled code must define __hql_hash_map function"
  );

  // Verify it creates the map correctly with __hql_hash_map call
  assertEquals(
    code.includes('__hql_hash_map(\'a\'') || code.includes('__hql_hash_map("a"'),
    true,
    "Map literal should be transpiled to __hql_hash_map call"
  );

  // This test verifies __hql_hash_map embedding - the key regression protection.
  // Functional testing is covered by existing 1152 tests.
});

// NOTE: __hql_throw exists in runtimeHelperImplementations but is NOT used by the transpiler.
// HQL throw expressions are transpiled to native JavaScript throw statements, not helper calls.
// Therefore, there is no embedding test for __hql_throw - it would be pointless testing.

Deno.test("Helper Embedding: for loop over collection generates native for-of loop", async () => {
  // Collection iteration syntax (x coll) is now optimized to native for-of loops
  // This is more efficient and supports early returns correctly
  const hqlCode = `(var result []) (for [x [1 2 3]] (.push result x)) result`;
  const result = await transpile(hqlCode);
  const code = typeof result === 'string' ? result : result.code || '';

  // Verify native for-of loop is generated
  assertEquals(
    code.includes("for (const x of"),
    true,
    "Collection iteration should be transpiled to native for-of loop"
  );

  // __hql_for_each is no longer needed for simple collection iteration
  // The native for-of loop handles all iterables including arrays and LazySeqs
});

Deno.test("Helper Embedding: numeric range loops are optimized to native for loops", async () => {
  // Numeric range loops are optimized to native for loops
  // No helpers needed - pure native JavaScript
  const hqlCode = `(for [i 0 10] i)`;
  const result = await transpile(hqlCode);
  const code = typeof result === 'string' ? result : result.code || '';

  // Verify native for loop is generated with numeric initialization
  assertEquals(
    code.includes("for (let i = 0; i < 10;"),
    true,
    "Numeric range loops should be transpiled to native for loops"
  );

  // Verify i++ is used (standard increment)
  assertEquals(
    code.includes("i++)"),
    true,
    "Numeric range loops should use standard increment"
  );
});

Deno.test("Helper Embedding: __hql_getNumeric alias is set when __hql_get is embedded", async () => {
  const hqlCode = `(get {"a": 1} "a")`;
  const result = await transpile(hqlCode);
  const code = typeof result === 'string' ? result : result.code || '';

  // Verify __hql_get is embedded
  assertEquals(
    code.includes("__hql_get"),
    true,
    "Transpiled code must include __hql_get"
  );

  // Verify __hql_getNumeric alias is set
  assertEquals(
    code.includes("__hql_getNumeric"),
    true,
    "Transpiled code must include __hql_getNumeric alias"
  );

  // Verify the alias assignment is present
  assertEquals(
    code.includes("__hql_getNumeric = __hql_get"),
    true,
    "__hql_getNumeric must be assigned to __hql_get (alias)"
  );

  // This test verifies the alias is properly set up for backwards compatibility
  // and numeric property access patterns
});
