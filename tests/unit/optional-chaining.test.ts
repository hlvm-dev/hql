import {
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { transpile } from "../../src/hql/transpiler/index.ts";
import { run } from "./helpers.ts";

Deno.test("optional chaining: transpilation preserves property, nested, and method chains", async () => {
  const property = await transpile(`
    (let user {})
    (const name user?.name)
  `);
  const nested = await transpile(`
    (let data {})
    (const city data?.user?.address?.city)
  `);
  const mixed = await transpile(`
    (let obj {})
    (const x obj?.a.b?.c)
  `);
  const method = await transpile(`
    (let obj {})
    (const greeting (obj?.greet "World"))
  `);

  assertStringIncludes(property.code, "user?.name");
  assertStringIncludes(nested.code, "data?.user?.address?.city");
  assertStringIncludes(mixed.code, "?.a");
  assertStringIncludes(mixed.code, ".b");
  assertStringIncludes(mixed.code, "?.c");
  assertStringIncludes(method.code, "obj?.greet");
});

Deno.test("optional chaining: nil short-circuits nested property access and supports nullish fallback", async () => {
  const result = await run(`
    (var user nil)
    [user?.name user?.profile?.city (?? user?.name "unknown")]
  `);

  assertEquals(result, [undefined, undefined, "unknown"]);
});

Deno.test("optional chaining: valid objects return nested values through mixed regular and optional access", async () => {
  const result = await run(`
    (var data {user: {address: {city: "Seoul"}}})
    (var obj {a: {b: {c: 42}}})
    [data?.user?.address?.city obj?.a.b?.c]
  `);

  assertEquals(result, ["Seoul", 42]);
});

Deno.test("optional chaining: optional method calls return undefined for nil and real values for live objects", async () => {
  const result = await run(`
    (var none nil)
    (var arr [1 2 3])
    [(none?.toString) (arr?.includes 2)]
  `);

  assertEquals(result, [undefined, true]);
});
