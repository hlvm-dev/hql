// Test optional chaining transpilation
import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/hql/transpiler/index.ts";

Deno.test("Optional chaining: basic property access", async () => {
  const result = await transpile("(const name user?.name)");
  assertStringIncludes(result.code, "user?.name");
});

Deno.test("Optional chaining: nested chain", async () => {
  const result = await transpile("(const city data?.user?.address?.city)");
  assertStringIncludes(result.code, "data?.user?.address?.city");
});

Deno.test("Optional chaining: mixed regular and optional access", async () => {
  const result = await transpile("(const x obj?.a.b?.c)");
  // Should have optional, regular, then optional access
  assertStringIncludes(result.code, "?.a"); // First optional
  assertStringIncludes(result.code, ".b");   // Regular
  assertStringIncludes(result.code, "?.c");  // Second optional
});

Deno.test("Optional chaining: method call", async () => {
  const result = await transpile('(const greeting (obj?.greet "World"))');
  assertStringIncludes(result.code, "obj?.greet");
});
