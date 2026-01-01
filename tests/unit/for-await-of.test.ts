// Tests for for-of and for-await-of statements
import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/transpiler/index.ts";

Deno.test("for-of: basic iteration", async () => {
  const result = await transpile(`
    (for-of [x [1 2 3]]
      (print x))
  `);
  assertStringIncludes(result.code, "for (const x of");
  assertStringIncludes(result.code, "console.log(x)");
});

Deno.test("for-of: iterate over array with multiple statements", async () => {
  const result = await transpile(`
    (for-of [item items]
      (const processed (.toUpperCase item))
      (console.log processed))
  `);
  assertStringIncludes(result.code, "for (const item of");
  assertStringIncludes(result.code, "const processed");
});

Deno.test("for-of: with continue and break", async () => {
  const result = await transpile(`
    (for-of [n numbers]
      (when (=== n 0)
        (continue))
      (when (> n 100)
        (break))
      (process n))
  `);
  assertStringIncludes(result.code, "for (const n of");
  assertStringIncludes(result.code, "continue");
  assertStringIncludes(result.code, "break");
});

Deno.test("for-await-of: basic async iteration", async () => {
  const result = await transpile(`
    (for-await-of [chunk stream]
      (process chunk))
  `);
  assertStringIncludes(result.code, "for await (const chunk of");
  assertStringIncludes(result.code, "process(chunk)");
});

Deno.test("for-await-of: async iteration with await inside", async () => {
  const result = await transpile(`
    (for-await-of [response responses]
      (const data (await (.json response)))
      (results.push data))
  `);
  assertStringIncludes(result.code, "for await (const response of");
  assertStringIncludes(result.code, "await");
});

Deno.test("for-await-of: iterate over async generator", async () => {
  const result = await transpile(`
    (async fn* fetchPages [urls]
      (for-of [url urls]
        (yield (await (fetch url)))))

    (async fn processPages [urls]
      (for-await-of [page (fetchPages urls)]
        (console.log page)))
  `);
  assertStringIncludes(result.code, "async function*");
  assertStringIncludes(result.code, "for await (const page of");
});
