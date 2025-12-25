import { assertEquals } from "jsr:@std/assert";
import { transpile } from "../../src/transpiler/index.ts";

Deno.test("DTS Generation: named function export", async () => {
  const code = `
    (fn add [a b] (+ a b))
    (export [add])
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("export declare function add"), true);
  assertEquals(result.dts!.includes("a: any"), true);
  assertEquals(result.dts!.includes("b: any"), true);
});

Deno.test("DTS Generation: multiple function exports", async () => {
  const code = `
    (fn add [a b] (+ a b))
    (fn multiply [x y] (* x y))
    (export [add multiply])
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("export declare function add"), true);
  assertEquals(result.dts!.includes("export declare function multiply"), true);
});

Deno.test("DTS Generation: variable export", async () => {
  const code = `
    (const PI 3.14159)
    (export [PI])
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("export declare const PI: any"), true);
});

Deno.test("DTS Generation: export default function", async () => {
  const code = `
    (fn main [args] (print "Hello"))
    (export default main)
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("declare function _default"), true);
  assertEquals(result.dts!.includes("export default _default"), true);
});

Deno.test("DTS Generation: export default with named exports", async () => {
  const code = `
    (fn helper [] 1)
    (fn main [] (helper))
    (export [helper])
    (export default main)
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("export declare function helper"), true);
  assertEquals(result.dts!.includes("export default _default"), true);
});

Deno.test("DTS Generation: empty module exports empty declaration", async () => {
  const code = `
    (const x 1)
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("export {}"), true);
});

Deno.test("DTS Generation: disabled by default", async () => {
  const code = `
    (fn add [a b] (+ a b))
    (export [add])
  `;
  const result = await transpile(code, { baseDir: Deno.cwd() });
  assertEquals(result.dts, undefined);
});

Deno.test("DTS Generation: async function", async () => {
  const code = `
    (async fn fetchData [url] (await (fetch url)))
    (export [fetchData])
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("export declare async function fetchData"), true);
});

Deno.test("DTS Generation: class with constructor and methods", async () => {
  const code = `
    (class Calculator
      (constructor [baseValue]
        (= this.baseValue baseValue))
      (fn add [x]
        (+ this.baseValue x))
      (fn multiply [x y]
        (* x y)))
    (export [Calculator])
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("export declare class Calculator"), true);
  assertEquals(result.dts!.includes("constructor(baseValue: any)"), true);
  assertEquals(result.dts!.includes("add(x: any): any"), true);
  assertEquals(result.dts!.includes("multiply(x: any, y: any): any"), true);
});
