// Tests for compound assignment operators (+=, -=, *=, /=, %=, **=, &=, |=, ^=, <<=, >>=, >>>=)
import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/hql/transpiler/index.ts";

// Arithmetic compound assignments
Deno.test("+= addition assignment", async () => {
  const result = await transpile(`(+= x 10)`);
  assertStringIncludes(result.code, "x += 10");
});

Deno.test("-= subtraction assignment", async () => {
  const result = await transpile(`(-= x 5)`);
  assertStringIncludes(result.code, "x -= 5");
});

Deno.test("*= multiplication assignment", async () => {
  const result = await transpile(`(*= x 2)`);
  assertStringIncludes(result.code, "x *= 2");
});

Deno.test("/= division assignment", async () => {
  const result = await transpile(`(/= x 2)`);
  assertStringIncludes(result.code, "x /= 2");
});

Deno.test("%= remainder assignment", async () => {
  const result = await transpile(`(%= x 3)`);
  assertStringIncludes(result.code, "x %= 3");
});

Deno.test("**= exponentiation assignment", async () => {
  const result = await transpile(`(**= base 2)`);
  assertStringIncludes(result.code, "base **= 2");
});

// Bitwise compound assignments
Deno.test("&= bitwise AND assignment", async () => {
  const result = await transpile(`(&= flags 0xFF)`);
  assertStringIncludes(result.code, "flags &=");
});

Deno.test("|= bitwise OR assignment", async () => {
  const result = await transpile(`(|= flags 0x01)`);
  assertStringIncludes(result.code, "flags |=");
});

Deno.test("^= bitwise XOR assignment", async () => {
  const result = await transpile(`(^= mask 0xAA)`);
  assertStringIncludes(result.code, "mask ^=");
});

Deno.test("<<= left shift assignment", async () => {
  const result = await transpile(`(<<= bits 2)`);
  assertStringIncludes(result.code, "bits <<= 2");
});

Deno.test(">>= right shift assignment", async () => {
  const result = await transpile(`(>>= bits 1)`);
  assertStringIncludes(result.code, "bits >>= 1");
});

Deno.test(">>>= unsigned right shift assignment", async () => {
  const result = await transpile(`(>>>= bits 1)`);
  assertStringIncludes(result.code, "bits >>>= 1");
});

// Member expression targets
Deno.test("+= with member expression", async () => {
  const result = await transpile(`(+= obj.count 1)`);
  assertStringIncludes(result.code, "obj.count += 1");
});

Deno.test("*= with array index", async () => {
  const result = await transpile(`(*= arr.0 2)`);
  assertStringIncludes(result.code, "arr[0] *= 2");
});

// In function context
Deno.test("Compound assignments in function", async () => {
  const result = await transpile(`
    (fn updateStats [stats]
      (+= stats.total 1)
      (*= stats.multiplier 1.1)
      (-= stats.remaining 1)
      stats)
  `);
  assertStringIncludes(result.code, "stats.total += 1");
  assertStringIncludes(result.code, "stats.multiplier *= 1.1");
  assertStringIncludes(result.code, "stats.remaining -= 1");
});
