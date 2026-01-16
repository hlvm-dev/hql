// Tests for static class members
import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/hql/transpiler/index.ts";

Deno.test("Static field: basic static var (hoisted pattern)", async () => {
  const result = await transpile(`
    (class Counter
      (static var count 0))
  `);
  // Static fields with values use hoisted pattern: _a.count = 0
  assertStringIncludes(result.code, ".count = 0");
});

Deno.test("Static field: static let (hoisted pattern)", async () => {
  const result = await transpile(`
    (class Config
      (static let MAX 100))
  `);
  // Static fields with values use hoisted pattern
  assertStringIncludes(result.code, ".MAX = 100");
});

Deno.test("Static method: basic static fn", async () => {
  const result = await transpile(`
    (class Factory
      (static fn create []
        (new Factory)))
  `);
  assertStringIncludes(result.code, "static create()");
});

Deno.test("Static: mixed static and instance members", async () => {
  const result = await transpile(`
    (class Counter
      (static var count 0)
      (var value 1)
      (static fn increment []
        (= Counter.count (+ Counter.count 1)))
      (fn getValue []
        this.value))
  `);
  // Static fields use hoisted pattern
  assertStringIncludes(result.code, ".count = 0");
  // Instance fields are in constructor
  assertStringIncludes(result.code, "this.value = 1");
  // Static methods have static keyword
  assertStringIncludes(result.code, "static increment()");
  // Instance methods do not have static keyword
  assertStringIncludes(result.code, "getValue()");
});

Deno.test("Static method: with parameters", async () => {
  const result = await transpile(`
    (class MathUtils
      (static fn add [a b]
        (+ a b)))
  `);
  assertStringIncludes(result.code, "static add(a, b)");
});
