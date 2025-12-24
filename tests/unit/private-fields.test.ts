// Tests for private class fields
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/transpiler/index.ts";

Deno.test("Private field: basic private field (WeakMap pattern)", async () => {
  const result = await transpile(`
    (class BankAccount
      (#balance 0))
  `);
  // TypeScript compiles private fields to WeakMap pattern
  assertStringIncludes(result.code, "_BankAccount_balance");
  assertStringIncludes(result.code, "WeakMap");
});

Deno.test("Private field: multiple private fields", async () => {
  const result = await transpile(`
    (class BankAccount
      (#balance 0)
      (#transactions []))
  `);
  assertStringIncludes(result.code, "_BankAccount_balance");
  assertStringIncludes(result.code, "_BankAccount_transactions");
  assertStringIncludes(result.code, "WeakMap");
});

Deno.test("Private field: mixed private and public fields", async () => {
  const result = await transpile(`
    (class User
      (#password "secret")
      (var username "guest"))
  `);
  // Private field becomes WeakMap
  assertStringIncludes(result.code, "_User_password");
  // Public field stays as normal property
  assertStringIncludes(result.code, "this.username");
});

Deno.test("Private field: initial value is preserved", async () => {
  const result = await transpile(`
    (class Counter
      (#count 42))
  `);
  // Initial value should be in the WeakMap.set call
  assertStringIncludes(result.code, ".set(this, 42)");
});
