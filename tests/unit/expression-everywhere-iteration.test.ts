import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpileToJavascript } from "../../src/hql/transpiler/hql-transpiler.ts";
import { run } from "./helpers.ts";

async function runLoose(code: string): Promise<unknown> {
  return await run(code, { typeCheck: false });
}

async function transpileLoose(code: string): Promise<string> {
  const result = await transpileToJavascript(code, {
    typeCheck: false,
    showTypeWarnings: false,
  });
  return result.code;
}

Deno.test("iteration expressions: for-of returns null while preserving side effects", async () => {
  const result = await runLoose(`
    (let values [])
    (let returned
      (if true
        (for-of [x [1 2 3]]
          (values.push (* x 2)))
        (for-of [x [9]] (values.push x))))
    [returned values]
  `);

  assertEquals(result, [null, [2, 4, 6]]);
});

Deno.test("iteration expressions: for-of lowers to an invoked null-returning IIFE", async () => {
  const code = await transpileLoose(`
    (let value (for-of [x items] (process x)))
  `);

  assertStringIncludes(code, "return null");
  assertStringIncludes(code, ")()");
});

Deno.test("iteration expressions: for-await-of lowers to an async null-returning IIFE", async () => {
  const code = await transpileLoose(`
    (async fn consume []
      (for-await-of [chunk stream]
        (process chunk)))
  `);

  assertStringIncludes(code, "async");
  assertStringIncludes(code, "for await");
  assertStringIncludes(code, "return null");
});

Deno.test("iteration expressions: case covers match, default, null, and composition", async () => {
  const result = await runLoose(`
    [
      (case "monday"
        "monday" "Start of week"
        "friday" "Almost weekend"
        "Other day")
      (case "wednesday"
        "monday" "Start of week"
        "friday" "Almost weekend"
        "Other day")
      (case "wednesday"
        "monday" "Start of week"
        "friday" "Almost weekend")
      (+ 10 (case 2 1 100 2 200 0))
      (case "fruit"
        "fruit" (case "apple"
                  "apple" "Red fruit"
                  "banana" "Yellow fruit"
                  "Unknown fruit")
        "vegetable" "Some veggie"
        "Unknown category")
    ]
  `);

  assertEquals(result, [
    "Start of week",
    "Other day",
    null,
    210,
    "Red fruit",
  ]);
});

Deno.test("iteration expressions: case lowers to chained ternaries", async () => {
  const code = await transpileLoose(`
    (case x
      1 "one"
      2 "two"
      "other")
  `);

  assertStringIncludes(code, "x === 1");
  assertStringIncludes(code, "x === 2");
  assertStringIncludes(code, "?");
});

Deno.test("iteration expressions: switch covers match, default, null, and block result", async () => {
  const result = await runLoose(`
    [
      (switch "monday"
        (case "monday" "Start of week")
        (case "friday" "Almost weekend")
        (default "Other day"))
      (switch "wednesday"
        (case "monday" "Start of week")
        (case "friday" "Almost weekend")
        (default "Other day"))
      (switch "wednesday"
        (case "monday" "Start of week")
        (case "friday" "Almost weekend"))
      (+ 10 (switch 2
              (case 1 100)
              (case 2 200)
              (default 0)))
      (switch "test"
        (case "test"
          (let a 10)
          (let b 20)
          (+ a b))
        (default 0))
    ]
  `);

  assertEquals(result, [
    "Start of week",
    "Other day",
    null,
    210,
    30,
  ]);
});

Deno.test("iteration expressions: switch lowers to chained ternaries", async () => {
  const code = await transpileLoose(`
    (switch x
      (case 1 "one")
      (case 2 "two")
      (default "other"))
  `);

  assertStringIncludes(code, "x === 1");
  assertStringIncludes(code, "x === 2");
  assertStringIncludes(code, "?");
});

Deno.test("iteration expressions: labeled break works across for-of IIFE boundary", async () => {
  const result = await runLoose(`
    (let output "default")
    (label outer
      (for-of [x [1 2 3]]
        (if (=== x 2)
          (break outer)
          (= output x))))
    output
  `);

  assertEquals(result, 1);
});

Deno.test("iteration expressions: labeled for-of keeps the label inside the lowered IIFE", async () => {
  const code = await transpileLoose(`
    (label outer
      (for-of [x items]
        (if (=== x 2) (break outer))))
  `);

  assertStringIncludes(code, "outer:");
  assertStringIncludes(code, "for (const");
  assertStringIncludes(code, "return null");
  assertStringIncludes(code, ")()");
});
