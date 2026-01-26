/**
 * Comprehensive Error Reporting Verification Tests
 *
 * Tests HQL's error handling and debug message capabilities:
 * - Compile-time errors (parsing, validation)
 * - Runtime errors (undefined variables, function calls)
 * - Error message formatting and source location
 * - Stack trace quality
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { getPlatform } from "../../src/platform/platform.ts";
import hql from "../../mod.ts";
import { ParseError, RuntimeError } from "../../src/common/error.ts";
import { run } from "./helpers.ts";

const path = () => getPlatform().path;
const fs = () => getPlatform().fs;
const join = (...paths: string[]) => path().join(...paths);
const makeTempDir = (opts?: { prefix?: string }) => fs().makeTempDir(opts);
const writeTextFile = (p: string, content: string) => fs().writeTextFile(p, content);
const remove = (p: string, opts?: { recursive?: boolean }) => fs().remove(p, opts);

async function withTempHqlFile<T>(
  code: string,
  fn: (filePath: string) => Promise<T>,
): Promise<T> {
  const tempDir = await makeTempDir({
    prefix: "hlvm-error-",
  });
  const filePath = join(tempDir, "error.hql");

  try {
    await writeTextFile(filePath, code);
    return await fn(filePath);
  } finally {
    await remove(tempDir, { recursive: true });
  }
}

async function runFileExpectRuntimeError(
  code: string,
): Promise<{ error: RuntimeError; filePath: string }> {
  return await withTempHqlFile(code, async (filePath) => {
    if (!hql.runFile) {
      throw new Error("hql.runFile is not available in this runtime");
    }

    const error = await assertRejects(
      async () => await hql.runFile!(filePath),
      RuntimeError,
    );

    if (!(error instanceof RuntimeError)) {
      throw error;
    }

    return { error, filePath };
  });
}

// Uses hql.transpile (different from helpers.ts's transpileToJavascript)
async function transpile(code: string): Promise<string> {
  const result = await hql.transpile(code);
  return typeof result === "string" ? result : result.code;
}

// ============================================================================
// COMPILE-TIME ERROR TESTS
// ============================================================================

Deno.test("Error Reporting: Parse error - unclosed parenthesis", async () => {
  const code = `
(let x 10)
(let y (+ x 5
`;

  await assertRejects(
    async () => await transpile(code),
    ParseError,
    "Unclosed",
  );
});

Deno.test("Error Reporting: Parse error - unbalanced delimiters", async () => {
  const code = `
(let data [1 2 3))
`;

  await assertRejects(
    async () => await transpile(code),
    Error,
  );
});

Deno.test("Error Reporting: Invalid syntax - malformed let", async () => {
  const code = `
(let)
`;

  await assertRejects(
    async () => await transpile(code),
    Error,
  );
});

Deno.test("Error Reporting: Invalid function definition", async () => {
  const code = `
(fn)
`;

  await assertRejects(
    async () => await transpile(code),
    Error,
  );
});

// ============================================================================
// RUNTIME ERROR TESTS
// ============================================================================

Deno.test("Error Reporting: Runtime - undefined variable reference", async () => {
  const code = `
(let x 10)
(+ x undefinedVariable)
`;

  await assertRejects(
    async () => await run(code),
    Error,
    "undefinedVariable",
  );
});

Deno.test("Error Reporting: Runtime - function not defined", async () => {
  const code = `
(nonExistentFunction 1 2 3)
`;

  await assertRejects(
    async () => await run(code),
    Error,
  );
});

Deno.test("Error Reporting: Runtime - wrong number of arguments", async () => {
  const code = `
(fn add [x y] (+ x y))
(add 1)
`;

  await assertRejects(
    async () => await run(code),
    Error,
  );
});

Deno.test("Error Reporting: Runtime - property access on undefined", async () => {
  const code = `
(let obj null)
(. obj someProperty)
`;

  await assertRejects(
    async () => await run(code),
    Error,
  );
});

Deno.test("Error Reporting: Runtime - accurate location for shadowed binding", async () => {
  const code = `
(let foo "abc")

(fn broken []
  (console.log "outer foo" foo)
  (let foo 42)
  (console.log "inner foo" foo)
  (foo 1))

(broken)
`;

  const { error, filePath } = await runFileExpectRuntimeError(code);
  assertEquals(error.sourceLocation.filePath, filePath);
  // With proper source maps, the error is now reported at the actual error location (line 5)
  // where the TDZ error occurs when accessing 'foo' before its declaration
  // Note: JavaScript TDZ errors are reported at the ACCESS point, not the DECLARATION point
  assertEquals(error.sourceLocation.line, 5);
});

Deno.test("Error Reporting: Runtime - type error in operation", async () => {
  const code = `
(let x "string")
(+ x 5)
`;

  // This might actually work in JS (string concatenation), but let's test
  const result = await run(code);
  assertEquals(result, "string5"); // JS coercion behavior
});

Deno.test("Error Reporting: Runtime - division by zero", async () => {
  const code = `
(/ 10 0)
`;

  const result = await run(code);
  assertEquals(result, Infinity); // JS behavior
});

Deno.test("Error Reporting: Runtime - array access out of bounds", async () => {
  const code = `
(let arr [1 2 3])
(get arr 10)
`;

  const result = await run(code);
  assertEquals(result, undefined); // JS behavior - no error thrown
});

// ============================================================================
// ERROR MESSAGE QUALITY TESTS
// ============================================================================

Deno.test("Error Reporting: Error contains source location info", async () => {
  const code = `
(let x 10)
(let y 20)
(+ x y z)
`;

  const { error, filePath } = await runFileExpectRuntimeError(code);

  assertEquals(error.sourceLocation.filePath, filePath);
  assertEquals(error.sourceLocation.line, 4);
  assertStringIncludes(error.message, "z");
  assert(
    error.contextLines.some((line) =>
      line.isError && line.content.includes("(+ x y z)")
    ),
  );
});

Deno.test("Error Reporting: Parse error shows context lines", async () => {
  const code = `
(let valid1 10)
(let valid2 20)
(let broken (+ 1 2
(let valid3 30)
`;

  const error = await assertRejects(
    async () => await transpile(code),
    ParseError,
  );

  if (!(error instanceof ParseError)) {
    throw error;
  }

  assert(error.sourceLocation.line && error.sourceLocation.line > 0);
  assert(error.contextLines.length > 0);
  assert(
    error.contextLines.some((line) =>
      line.isError && line.content.includes("(let broken (+ 1 2")
    ),
  );
});

// ============================================================================
// STACK TRACE TESTS
// ============================================================================

const nestedCallCode = `
(fn helper [x] (unknownFunc x))
(fn middle [x] (helper x))
(fn outer [x] (middle x))
(outer 10)
`;

Deno.test("Error Reporting: Stack trace in nested function calls", async () => {
  const { error, filePath } = await runFileExpectRuntimeError(nestedCallCode);
  const stack = error.stack ?? "";

  assert(stack.length > 0);
  assertStringIncludes(stack, "helper");
  assertStringIncludes(stack, "middle");
  assertStringIncludes(stack, "outer");
  assertStringIncludes(stack, filePath);
});

Deno.test("Error Reporting: Stack trace with actual error in nested calls", async () => {
  const { error, filePath } = await runFileExpectRuntimeError(nestedCallCode);
  const stack = error.stack ?? "";

  assertStringIncludes(error.message, "unknownFunc");
  assert(stack.length > 0);
  assertStringIncludes(stack, `${filePath}:2:`);
  assertStringIncludes(stack, `${filePath}:5:`);
});

// ============================================================================
// METADATA PRESERVATION TESTS
// ============================================================================

Deno.test("Error Reporting: Transpiled output includes source map metadata", async () => {
  const code = `
(let x 10)
(let y 20)
(+ x y)
`;

  const result = await hql.transpile(code, {
    currentFile: "inline.hql",
    generateSourceMap: true,
    sourceContent: code,
  });

  if (typeof result === "string") {
    throw new Error("Expected source map output");
  }

  assertEquals(typeof result.sourceMap, "string");
  const map = JSON.parse(result.sourceMap || "{}") as {
    sources?: string[];
    mappings?: string;
  };

  assertEquals(Array.isArray(map.sources), true);
  assertEquals(map.sources?.includes("inline.hql"), true);
  assertEquals(typeof map.mappings, "string");
  assertEquals((map.mappings?.length ?? 0) > 0, true);
});

// ============================================================================
// ERROR RECOVERY TESTS
// ============================================================================

Deno.test("Error Reporting: Multiple errors in sequence", async () => {
  // Test that error handling doesn't break the runtime

  // First error
  await assertRejects(
    async () => await run("(unknownFunc1)"),
    Error,
  );

  // Second error - should still work
  await assertRejects(
    async () => await run("(unknownFunc2)"),
    Error,
  );

  // Valid code after errors - should execute
  const result = await run("(+ 1 2)");
  assertEquals(result, 3);
});
