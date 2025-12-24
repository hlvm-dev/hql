// Tests for async generator functions
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/transpiler/index.ts";

Deno.test("Async Generator: anonymous async generator function", async () => {
  const result = await transpile(`
    (async fn* []
      (yield (await (Promise.resolve 1)))
      (yield (await (Promise.resolve 2)))
      (yield (await (Promise.resolve 3))))
  `);
  assertStringIncludes(result.code, "async function*");
  assertStringIncludes(result.code, "yield");
  assertStringIncludes(result.code, "await");
});

Deno.test("Async Generator: named async generator function", async () => {
  const result = await transpile(`
    (async fn* fetchPages [urls]
      (for-of [url urls]
        (yield (await (fetch url)))))
  `);
  assertStringIncludes(result.code, "async function*");
  assertStringIncludes(result.code, "fetchPages");
  assertStringIncludes(result.code, "yield");
});

Deno.test("Async Generator: yield* delegation", async () => {
  const result = await transpile(`
    (async fn* combined []
      (yield* [1 2 3])
      (yield (await (Promise.resolve 4))))
  `);
  assertStringIncludes(result.code, "async function*");
  assertStringIncludes(result.code, "yield*");
  assertStringIncludes(result.code, "yield await");
});

Deno.test("Async Generator: practical pagination pattern", async () => {
  const result = await transpile(`
    (async fn* paginate [startPage maxPages]
      (var page startPage)
      (while (<= page maxPages)
        (const data (await (fetchPage page)))
        (yield data)
        (= page (+ page 1))))
  `);
  assertStringIncludes(result.code, "async function*");
  assertStringIncludes(result.code, "yield data");
  assertStringIncludes(result.code, "await");
});

Deno.test("Async Generator: async iteration source", async () => {
  const result = await transpile(`
    (async fn* readLines [reader]
      (var line (await (.readLine reader)))
      (while (!== line null)
        (yield line)
        (= line (await (.readLine reader)))))
  `);
  assertStringIncludes(result.code, "async function*");
  assertStringIncludes(result.code, "yield line");
});
