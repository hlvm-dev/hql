// Test optional chaining — transpilation AND runtime execution
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/hql/transpiler/index.ts";
import { run } from "./helpers.ts";

// ============================================================================
// SECTION 1: TRANSPILATION TESTS (verify correct JS output)
// ============================================================================

Deno.test("Optional chaining transpile: basic property access", async () => {
  const result = await transpile("(const name user?.name)");
  assertStringIncludes(result.code, "user?.name");
});

Deno.test("Optional chaining transpile: nested chain", async () => {
  const result = await transpile("(const city data?.user?.address?.city)");
  assertStringIncludes(result.code, "data?.user?.address?.city");
});

Deno.test("Optional chaining transpile: mixed regular and optional access", async () => {
  const result = await transpile("(const x obj?.a.b?.c)");
  assertStringIncludes(result.code, "?.a");
  assertStringIncludes(result.code, ".b");
  assertStringIncludes(result.code, "?.c");
});

Deno.test("Optional chaining transpile: method call", async () => {
  const result = await transpile('(const greeting (obj?.greet "World"))');
  assertStringIncludes(result.code, "obj?.greet");
});

// ============================================================================
// SECTION 2: RUNTIME TESTS (verify actual execution)
// ============================================================================

Deno.test("Optional chaining runtime: nil returns undefined", async () => {
  const result = await run(`
    (var obj nil)
    obj?.name
  `);
  assertEquals(result, undefined);
});

Deno.test("Optional chaining runtime: valid object returns value", async () => {
  const result = await run(`
    (var user {name: "Alice"})
    user?.name
  `);
  assertEquals(result, "Alice");
});

Deno.test("Optional chaining runtime: nested chain on nil", async () => {
  const result = await run(`
    (var data nil)
    data?.user?.address?.city
  `);
  assertEquals(result, undefined);
});

Deno.test("Optional chaining runtime: nested chain on valid object", async () => {
  const result = await run(`
    (var data {user: {address: {city: "Seoul"}}})
    data?.user?.address?.city
  `);
  assertEquals(result, "Seoul");
});

Deno.test("Optional chaining runtime: nil in middle of chain", async () => {
  const result = await run(`
    (var data {user: nil})
    data?.user?.address?.city
  `);
  assertEquals(result, undefined);
});

Deno.test("Optional chaining runtime: mixed regular and optional", async () => {
  const result = await run(`
    (var obj {a: {b: {c: 42}}})
    obj?.a.b?.c
  `);
  assertEquals(result, 42);
});

Deno.test("Optional chaining runtime: method call on nil", async () => {
  const result = await run(`
    (var obj nil)
    (obj?.toString)
  `);
  assertEquals(result, undefined);
});

Deno.test("Optional chaining runtime: method call on valid object", async () => {
  const result = await run(`
    (var arr [1 2 3])
    (arr?.includes 2)
  `);
  assertEquals(result, true);
});

Deno.test("Optional chaining runtime: with nullish coalescing fallback", async () => {
  const result = await run(`
    (var user nil)
    (?? user?.name "unknown")
  `);
  assertEquals(result, "unknown");
});

Deno.test("Optional chaining runtime: empty object nested access", async () => {
  const result = await run(`
    (var x {})
    x?.a?.b?.c
  `);
  assertEquals(result, undefined);
});
