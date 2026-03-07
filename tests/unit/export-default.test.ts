import { assertEquals } from "jsr:@std/assert";
import { transpile } from "../../src/hql/transpiler/index.ts";
import { getPlatform } from "../../src/platform/platform.ts";

Deno.test("Export Default: named function", async () => {
  const code = `
    (fn add [a b] (+ a b))
    (export default add)
  `;
  const result = await transpile(code, { baseDir: getPlatform().process.cwd() });
  // Check that the output contains 'export default add'
  assertEquals(result.code.includes("export default add"), true);
});

Deno.test("Export Default: literal string", async () => {
  const code = `(export default "hello world")`;
  const result = await transpile(code, { baseDir: getPlatform().process.cwd() });
  assertEquals(result.code.includes("export default"), true);
  // The output may use single or double quotes
  assertEquals(
    result.code.includes('"hello world"') || result.code.includes("'hello world'"),
    true
  );
});

Deno.test("Export Default: arrow function", async () => {
  const code = `(export default (=> (* $0 $0)))`;
  const result = await transpile(code, { baseDir: getPlatform().process.cwd() });
  assertEquals(result.code.includes("export default"), true);
});

Deno.test("Export Default: binary expression", async () => {
  const code = `(export default (+ 1 2))`;
  const result = await transpile(code, { baseDir: getPlatform().process.cwd() });
  assertEquals(result.code.includes("export default"), true);
  assertEquals(result.code.includes("1 + 2"), true);
});

Deno.test("Export Default: combined with named exports", async () => {
  const code = `
    (fn helper [] 1)
    (fn main [] (helper))
    (export [helper])
    (export default main)
  `;
  const result = await transpile(code, { baseDir: getPlatform().process.cwd() });
  assertEquals(result.code.includes("export default main"), true);
  assertEquals(result.code.includes("export {") || result.code.includes("export{"), true);
});
