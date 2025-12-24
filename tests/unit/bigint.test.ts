// Tests for BigInt literal support
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/transpiler/index.ts";

Deno.test("BigInt: basic literal", async () => {
  const result = await transpile(`123n`);
  assertStringIncludes(result.code, "123n");
});

Deno.test("BigInt: large number", async () => {
  const result = await transpile(`9007199254740993n`);
  assertStringIncludes(result.code, "9007199254740993n");
});

Deno.test("BigInt: zero", async () => {
  const result = await transpile(`0n`);
  assertStringIncludes(result.code, "0n");
});

Deno.test("BigInt: negative number", async () => {
  const result = await transpile(`-123n`);
  assertStringIncludes(result.code, "-123n");
});

Deno.test("BigInt: in variable declaration", async () => {
  const result = await transpile(`(let x 123n)`);
  // HQL separates declaration and assignment
  assertStringIncludes(result.code, "let x");
  assertStringIncludes(result.code, "x = 123n");
});

Deno.test("BigInt: in arithmetic operation", async () => {
  const result = await transpile(`(+ 1n 2n)`);
  assertStringIncludes(result.code, "1n + 2n");
});

Deno.test("BigInt: in comparison", async () => {
  const result = await transpile(`(> 10n 5n)`);
  assertStringIncludes(result.code, "10n > 5n");
});

Deno.test("BigInt: in function call", async () => {
  const result = await transpile(`(myFunc 123n)`);
  assertStringIncludes(result.code, "myFunc(123n)");
});

Deno.test("BigInt: mixed with regular numbers in code", async () => {
  const result = await transpile(`
    (let bigVal 9007199254740993n)
    (let normalVal 42)
  `);
  assertStringIncludes(result.code, "9007199254740993n");
  assertStringIncludes(result.code, "42");
});

Deno.test("BigInt: very large number", async () => {
  const result = await transpile(`12345678901234567890123456789012345678901234567890n`);
  assertStringIncludes(result.code, "12345678901234567890123456789012345678901234567890n");
});
