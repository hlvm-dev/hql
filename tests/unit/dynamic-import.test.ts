// Tests for dynamic import expressions
import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/transpiler/index.ts";

Deno.test("Dynamic import: basic string path", async () => {
  const result = await transpile(`(import-dynamic "./module.js")`);
  assertStringIncludes(result.code, 'import("./module.js")');
});

Deno.test("Dynamic import: with await", async () => {
  const result = await transpile(`(await (import-dynamic "./utils.ts"))`);
  // await wraps import in __hql_consume_async_iter for dual-mode async support
  assertStringIncludes(result.code, 'import("./utils.ts")');
});

Deno.test("Dynamic import: with variable path", async () => {
  const result = await transpile(`(import-dynamic modulePath)`);
  assertStringIncludes(result.code, "import(modulePath)");
});

Deno.test("Dynamic import: in async function", async () => {
  const result = await transpile(`
    (async fn loadModule [path]
      (let module (await (import-dynamic path)))
      module)
  `);
  assertStringIncludes(result.code, "import(path)");
  // await wraps import in __hql_consume_async_iter for dual-mode async support
  assertStringIncludes(result.code, "await");
});

Deno.test("Dynamic import: with template literal path", async () => {
  const result = await transpile(`
    (import-dynamic \`./modules/\${name}.js\`)
  `);
  assertStringIncludes(result.code, "import(`./modules/${name}.js`)");
});

Deno.test("Dynamic import: conditional loading", async () => {
  const result = await transpile(`
    (async fn loadFeature [featureName]
      (if (=== featureName "analytics")
          (await (import-dynamic "./analytics.js"))
          (await (import-dynamic "./default.js"))))
  `);
  assertStringIncludes(result.code, 'import("./analytics.js")');
  assertStringIncludes(result.code, 'import("./default.js")');
});
