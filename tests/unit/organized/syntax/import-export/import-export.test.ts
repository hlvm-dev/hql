import { assertEquals } from "jsr:@std/assert";
import { run } from "../../../helpers.ts";

Deno.test("ImportExport: local HQL imports support named, alias, namespace, and multi-module composition", async () => {
  const result = await run(`
(import [add as sum, multiply] from "./test/fixtures/math.hql")
(import math from "./test/fixtures/math.hql")
(import [double] from "./test/fixtures/utils.hql")
(import [PI, counter] from "./test/fixtures/constants.hql")
[
  (+ (sum 5 3) (multiply 2 4) (math.add 10 20) (double 5))
  counter
  (* PI 2)
]
`);

  assertEquals(result[0], 56);
  assertEquals(result[1], 0);
  assertEquals(Math.round(result[2] * 100000) / 100000, 6.28318);
});

Deno.test("ImportExport: re-exported bindings resolve through intermediary modules", async () => {
  const result = await run(`
(import [greet, farewell, secretValue] from "./test/fixtures/reexport/middleware.hql")
[(greet "Alice") (farewell "Bob") secretValue]
`);

  assertEquals(result, ["Hello, Alice!", "Goodbye, Bob!", 42]);
});

Deno.test({
  name: "ImportExport: TypeScript module imports resolve functions and constants",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await run(`
(import [tsMultiply, tsAdd, TS_CONSTANT] from "./test/fixtures/ts-module.ts")
[(tsMultiply 4) (tsAdd 10 20) TS_CONSTANT]
`);

    assertEquals(result, [12, 30, "TypeScript works!"]);
  },
});

Deno.test({
  name: "ImportExport: jsr imports resolve package specifiers",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await run(`
(import [assertEquals, assertExists] from "jsr:@std/assert")
(assertEquals 1 1)
(assertExists "hello")
"test-passed"
`);

    assertEquals(result, "test-passed");
  },
});

Deno.test({
  name: "ImportExport: https imports resolve remote URLs",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await run(`
(import [assertEquals, assertNotEquals] from "https://deno.land/std@0.208.0/assert/mod.ts")
(assertEquals 1 1)
(assertNotEquals 1 2)
"test-passed"
`);

    assertEquals(result, "test-passed");
  },
});

Deno.test({
  name: "ImportExport: npm default imports resolve CommonJS/ESM defaults",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await run(`
(import [default] from "npm:ms@2.1.3")
(var ms default)
ms
`);

    assertEquals(typeof result, "function");
  },
});
