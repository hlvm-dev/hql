import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { transpileToJavascript } from "../../src/hql/transpiler/hql-transpiler.ts";
import { run } from "./helpers.ts";

Deno.test("Semantic TDZ: top-level forward reference is rejected", async () => {
  const code = `
(let y x)
(let x 1)
y
`;

  await assertRejects(
    async () => {
      await transpileToJavascript(code);
    },
    Error,
    "before initialization",
  );
});

Deno.test("Semantic TDZ: block forward reference is rejected", async () => {
  const code = `
(fn broken []
  (let y x)
  (let x 1)
  y)

(broken)
`;

  await assertRejects(
    async () => {
      await transpileToJavascript(code);
    },
    Error,
    "before initialization",
  );
});

Deno.test("Semantic TDZ: reference after declaration is valid", async () => {
  const code = `
(let x 1)
(let y x)
y
`;

  const result = await run(code);
  assertEquals(result, 1);
});
