import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import hql from "../../mod.ts";
import { ParseError } from "../../src/common/error.ts";
import { captureConsole, run, runFileExpectRuntimeError } from "./helpers.ts";

async function transpile(code: string): Promise<string> {
  const result = await hql.transpile(code);
  return typeof result === "string" ? result : result.code;
}

Deno.test("error reporting: malformed syntax rejects with parse errors and useful context", async () => {
  await assertRejects(
    () =>
      transpile(`
        (let x 10)
        (let y (+ x 5
      `),
    ParseError,
    "Unclosed",
  );

  const error = await assertRejects(
    () =>
      transpile(`
        (let valid1 10)
        (let valid2 20)
        (let broken (+ 1 2
        (let valid3 30)
      `),
    ParseError,
  );

  if (!(error instanceof ParseError)) {
    throw error;
  }

  assert(error.sourceLocation.line && error.sourceLocation.line > 0);
  assert(
    error.contextLines.some((line) =>
      line.isError && line.content.includes("(let broken (+ 1 2")
    ),
  );
});

Deno.test("error reporting: runtime errors include source location and highlighted context", async () => {
  const { result } = await captureConsole(
    () =>
      runFileExpectRuntimeError(`
        (let x 10)
        (let y 20)
        (+ x y z)
      `),
    ["error"],
  );
  const { error, filePath } = result;

  assertEquals(error.sourceLocation.filePath, filePath);
  assertEquals(error.sourceLocation.line, 4);
  assertStringIncludes(error.message, "z");
  assert(
    error.contextLines.some((line) =>
      line.isError && line.content.includes("(+ x y z)")
    ),
  );
});

Deno.test("error reporting: compile-time TDZ validation reports the access line accurately", async () => {
  try {
    await transpile(`
      (let foo "abc")

      (fn broken []
        (console.log "outer foo" foo)
        (let foo 42)
        (console.log "inner foo" foo)
        (foo 1))

      (broken)
    `);
    assert(false, "Expected compile-time TDZ validation error");
  } catch (error) {
    const err = error as { message?: string; sourceLocation?: { line?: number } };
    assertStringIncludes(err.message ?? "", "Cannot access 'foo' before initialization");
    assertEquals(err.sourceLocation?.line, 5);
  }
});

Deno.test("error reporting: JS-compatible runtime edge behavior remains stable", async () => {
  assertEquals(
    await run(`
      (let x "string")
      (+ x 5)
    `),
    "string5",
  );
  assertEquals(await run(`(/ 10 0)`), Infinity);
  assertEquals(
    await run(`
      (let arr [1 2 3])
      (get arr 10)
    `),
    undefined,
  );
});

Deno.test("error reporting: nested runtime errors retain a useful stack trace", async () => {
  const { result } = await captureConsole(
    () =>
      runFileExpectRuntimeError(`
        (fn helper [x] (unknownFunc x))
        (fn middle [x] (helper x))
        (fn outer [x] (middle x))
        (outer 10)
      `),
    ["error"],
  );
  const { error, filePath } = result;
  const stack = error.stack ?? "";

  assertStringIncludes(error.message, "unknownFunc");
  assert(stack.length > 0);
  assertStringIncludes(stack, "helper");
  assertStringIncludes(stack, "middle");
  assertStringIncludes(stack, "outer");
  assertStringIncludes(stack, filePath);
});

Deno.test("error reporting: source-map metadata is emitted when requested", async () => {
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
  assertStringIncludes(result.code, "sourceMappingURL");
});
