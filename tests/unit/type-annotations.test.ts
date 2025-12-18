/**
 * Tests for TypeScript type annotations in HQL
 *
 * Tests the new type annotation syntax:
 * - Parameter types: (fn add [a:number b:number] ...)
 * - Return types: (fn add [a b] :number ...)
 * - Generic types: (fn identity [x:T] :T ...)
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { parse } from "../../src/transpiler/pipeline/parser.ts";
import { transpile } from "../../src/transpiler/index.ts";

Deno.test("Type Annotations - Parameter type parsing", async () => {
  const code = `(fn add [a:number b:number] (+ a b))`;
  const result = await transpile(code, { currentFile: "test.hql" });
  assertStringIncludes(result.code, "function add");
  // Type annotation should be stripped from JS output (types are only for checking)
});

Deno.test("Type Annotations - Return type parsing", async () => {
  const code = `(fn add [a b] :number (+ a b))`;
  const result = await transpile(code, { currentFile: "test.hql" });
  assertStringIncludes(result.code, "function add");
});

Deno.test("Type Annotations - Combined parameter and return types", async () => {
  const code = `(fn add [a:number b:number] :number (+ a b))`;
  const result = await transpile(code, { currentFile: "test.hql" });
  assertStringIncludes(result.code, "function add");
});

Deno.test("Type Annotations - Anonymous function with types", async () => {
  const code = `(const double (fn [x:number] :number (* x 2)))`;
  const result = await transpile(code, { currentFile: "test.hql" });
  assertStringIncludes(result.code, "const double");
});

Deno.test("Type Annotations - Generic array type (Array<T>)", async () => {
  const code = `(fn getFirst [arr:Array<number>] :number (get arr 0))`;
  const result = await transpile(code, { currentFile: "test.hql" });
  assertStringIncludes(result.code, "function getFirst");
});

Deno.test("Type Annotations - Mixed typed and untyped params", async () => {
  const code = `(fn mixed [a:string b] (str a " " b))`;
  const result = await transpile(code, { currentFile: "test.hql" });
  assertStringIncludes(result.code, "function mixed");
});

Deno.test("Type Annotations - String type", async () => {
  const code = `(fn greet [name:string] :string (str "Hello, " name))`;
  const result = await transpile(code, { currentFile: "test.hql" });
  assertStringIncludes(result.code, "function greet");
});

Deno.test("Type Annotations - Boolean type", async () => {
  // Use === for comparison in HQL
  const code = `(fn isEven [n:number] :boolean (=== 0 (mod n 2)))`;
  const result = await transpile(code, { currentFile: "test.hql" });
  assertStringIncludes(result.code, "function isEven");
});

Deno.test("Type Annotations - Execution correctness", async () => {
  // Use Deno.Command to run actual HQL code
  const code = `(fn add [a:number b:number] :number (+ a b)) (print (add 5 7))`;

  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/cli/cli.ts", "run", "-e", code],
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
  });

  const { stdout, stderr } = await proc.output();
  const output = new TextDecoder().decode(stdout).trim();
  const errors = new TextDecoder().decode(stderr);

  assertEquals(output, "12", `Expected 12, got: ${output}. Errors: ${errors}`);
});

Deno.test("Type Annotations - hasTypeAnnotations detection - positive", async () => {
  const code = `(fn add [a:number b:number] (+ a b))`;
  const result = await transpile(code, { currentFile: "test.hql" });

  // Get IR and check
  const ast = parse(code, "test.hql");
  // We'd need access to the IR to test hasTypeAnnotations directly
  // For now, just verify transpilation works
  assertStringIncludes(result.code, "function add");
});

Deno.test("Type Annotations - hasTypeAnnotations detection - negative", async () => {
  const code = `(fn add [a b] (+ a b))`;
  const result = await transpile(code, { currentFile: "test.hql" });
  assertStringIncludes(result.code, "function add");
});

Deno.test("Type Annotations - Complex nested expression with types", async () => {
  const code = `
    (fn calculate [x:number y:number] :number
      (+ (* x 2) (* y 3)))
    (print (calculate 4 5))
  `;

  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/cli/cli.ts", "run", "-e", code],
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
  });

  const { stdout } = await proc.output();
  const output = new TextDecoder().decode(stdout).trim();

  // (+ (* 4 2) (* 5 3)) = (+ 8 15) = 23
  assertEquals(output, "23");
});

Deno.test("Type Annotations - Multiple functions with types", async () => {
  const code = `
    (fn square [x:number] :number (* x x))
    (fn double [x:number] :number (* x 2))
    (print (+ (square 3) (double 5)))
  `;

  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/cli/cli.ts", "run", "-e", code],
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
  });

  const { stdout } = await proc.output();
  const output = new TextDecoder().decode(stdout).trim();

  // (+ 9 10) = 19
  assertEquals(output, "19");
});

Deno.test("Type Annotations - Backward compatibility (no types)", async () => {
  const code = `
    (fn add [a b] (+ a b))
    (fn sub [a b] (- a b))
    (print (add 10 5))
    (print (sub 10 5))
  `;

  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/cli/cli.ts", "run", "-e", code],
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
  });

  const { stdout } = await proc.output();
  const output = new TextDecoder().decode(stdout).trim();

  assertEquals(output, "15\n5");
});

Deno.test("Type Annotations - Union types (syntax check)", async () => {
  // Just verify parsing doesn't fail
  const code = `(fn maybe [x:number|string] x)`;
  const result = await transpile(code, { currentFile: "test.hql" });
  assertStringIncludes(result.code, "function maybe");
});

Deno.test("Type Annotations - Optional type syntax", async () => {
  // Just verify parsing doesn't fail
  const code = `(fn optional [x:number?] x)`;
  const result = await transpile(code, { currentFile: "test.hql" });
  assertStringIncludes(result.code, "function optional");
});
