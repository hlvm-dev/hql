// Additional tests for optional chaining transpilation
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/transpiler/index.ts";

Deno.test("Optional chaining: standalone symbol access", async () => {
  const result = await transpile("user?.name");
  assertStringIncludes(result.code, "user?.name");
});

Deno.test("Optional chaining: method call with arguments", async () => {
  const result = await transpile('(obj?.greet "World")');
  assertStringIncludes(result.code, "obj?.greet");
  assertStringIncludes(result.code, "(\"World\")");
});

Deno.test("Optional chaining: multiple method chain", async () => {
  const result = await transpile('(response?.data?.items?.map fn)');
  assertStringIncludes(result.code, "?.");
});
