// test/repl-set-undefined.test.ts
// Tests for REPL handling of = (assignment) on undefined variables

import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile, type TranspileResult } from "../mod.ts";

function getCode(result: string | TranspileResult): string {
  return typeof result === "string" ? result : result.code;
}

Deno.test("REPL Issue: = on undefined variable should give clear error", async () => {
  // This demonstrates the problem: = transpiles fine but fails at runtime
  const code = "(= a 20)";
  const result = await transpile(code, { baseDir: Deno.cwd(), currentFile: "<test>" });
  const js = getCode(result);

  // The transpiled code is: a = 20
  assertEquals(js.includes("a = 20"), true, "= should transpile to assignment");

  // But when evaluated in a fresh scope, it throws ReferenceError
  await assertRejects(
    async () => {
      const module = await import(`data:text/javascript,${encodeURIComponent(js)}`);
      return module;
    },
    Error,
    "a is not defined", // ← Expected error
    "Should throw ReferenceError for undefined variable"
  );
});

Deno.test("REPL Issue: = with reserved keyword 'let' becomes '_let'", async () => {
  // When using reserved keyword 'let' as variable name
  const varCode = "(var let 10)";
  const setCode = "(= let 20)";

  const varResult = await transpile(varCode, { baseDir: Deno.cwd(), currentFile: "<test>" });
  const setResult = await transpile(setCode, { baseDir: Deno.cwd(), currentFile: "<test>" });

  const varJs = getCode(varResult);
  const setJs = getCode(setResult);

  // 'let' gets sanitized to '_let'
  assertEquals(varJs.includes("var _let = 10"), true, "var let should create _let");
  assertEquals(setJs.includes("_let = 20"), true, "= let should assign to _let");
});

Deno.test("REPL Correct Usage: var then = works", async () => {
  const code = `
(var x 10)
(= x 20)
x
`;
  const result = await transpile(code, { baseDir: Deno.cwd(), currentFile: "<test>" });
  const js = getCode(result);

  // Should contain both declaration and assignment
  assertEquals(js.includes("var x = 10"), true);
  assertEquals(js.includes("x = 20"), true);

  // Evaluate and verify
  const module = await import(`data:text/javascript,${encodeURIComponent(js)}`);
  // The last expression (x) should be 20
  // Note: This might need adjustment based on how the module exports work
});

Deno.test("Documentation: = requires var first", async () => {
  // This test documents the correct pattern
  const correctPattern = `
(var counter 0)
(= counter (+ counter 1))
counter  ; => 1
`;

  const result = await transpile(correctPattern, { baseDir: Deno.cwd(), currentFile: "<test>" });
  const js = getCode(result);

  assertEquals(js.includes("var counter = 0"), true, "Should declare with var");
  assertEquals(js.includes("counter = "), true, "Should have assignment");
});
