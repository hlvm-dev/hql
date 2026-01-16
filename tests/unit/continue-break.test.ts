// Tests for continue and break statements
import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/hql/transpiler/index.ts";

Deno.test("Continue: in while loop", async () => {
  const result = await transpile(`
    (var i 0)
    (while (< i 10)
      (= i (+ i 1))
      (when (=== (% i 2) 0)
        (continue))
      (console.log i))
  `);
  assertStringIncludes(result.code, "continue;");
});

Deno.test("Break: in while loop", async () => {
  const result = await transpile(`
    (var i 0)
    (while (< i 100)
      (= i (+ i 1))
      (when (> i 10)
        (break)))
  `);
  assertStringIncludes(result.code, "break;");
});

Deno.test("Continue and Break: together in while loop", async () => {
  const result = await transpile(`
    (var i 0)
    (while (< i 100)
      (= i (+ i 1))
      (when (=== (% i 2) 0)
        (continue))
      (when (> i 50)
        (break))
      (console.log i))
  `);
  assertStringIncludes(result.code, "continue;");
  assertStringIncludes(result.code, "break;");
});

Deno.test("Continue: in loop/recur optimized to while", async () => {
  // loop/recur with simple if pattern gets optimized to while
  const result = await transpile(`
    (loop [i 0]
      (if (< i 10)
        (do
          (when (=== (% i 2) 0)
            (continue))
          (console.log i)
          (recur (+ i 1)))
        nil))
  `);
  assertStringIncludes(result.code, "continue;");
});

Deno.test("Break: in loop/recur optimized to while", async () => {
  const result = await transpile(`
    (loop [i 0]
      (if (< i 100)
        (do
          (when (> i 10)
            (break))
          (recur (+ i 1)))
        nil))
  `);
  assertStringIncludes(result.code, "break;");
});
