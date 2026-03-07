// Tests for async generator functions
import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/hql/transpiler/index.ts";

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

