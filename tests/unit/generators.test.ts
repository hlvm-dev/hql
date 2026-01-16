// Tests for generator functions
import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/hql/transpiler/index.ts";

Deno.test("Generator: anonymous generator function", async () => {
  const result = await transpile(`
    (fn* []
      (yield 1)
      (yield 2)
      (yield 3))
  `);
  assertStringIncludes(result.code, "function*");
  assertStringIncludes(result.code, "yield 1");
  assertStringIncludes(result.code, "yield 2");
});

Deno.test("Generator: named generator function", async () => {
  const result = await transpile(`
    (fn* range [start end]
      (var i start)
      (while (< i end)
        (yield i)
        (= i (+ i 1))))
  `);
  assertStringIncludes(result.code, "function*");
  assertStringIncludes(result.code, "yield i");
});

Deno.test("Generator: yield without value", async () => {
  const result = await transpile(`
    (fn* simple []
      (yield)
      (yield 42))
  `);
  assertStringIncludes(result.code, "yield;");
  assertStringIncludes(result.code, "yield 42");
});

Deno.test("Generator: yield* delegation", async () => {
  const result = await transpile(`
    (fn* combined []
      (yield* [1 2 3])
      (yield 4))
  `);
  assertStringIncludes(result.code, "yield*");
  assertStringIncludes(result.code, "yield 4");
});

Deno.test("Generator: iterator usage pattern", async () => {
  const result = await transpile(`
    (fn* fibonacci []
      (var a 0)
      (var b 1)
      (while true
        (yield a)
        (var temp b)
        (= b (+ a b))
        (= a temp)))
  `);
  assertStringIncludes(result.code, "function*");
  assertStringIncludes(result.code, "yield a");
});
