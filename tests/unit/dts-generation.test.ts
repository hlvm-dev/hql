import { assertEquals } from "jsr:@std/assert";
import { transpile } from "../../src/hql/transpiler/index.ts";

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

Deno.test("DTS Generation: includes JSDoc from comments", async () => {
  const code = `
    /** Adds two numbers together */
    (fn add [a b] (+ a b))
    (export [add])
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("/** Adds two numbers together */"), true);
  assertEquals(result.dts!.includes("export declare function add"), true);
});

Deno.test("DTS Generation: handles multi-line comments", async () => {
  const code = `
    /**
     * This function performs addition.
     * It takes two parameters and returns their sum.
     */
    (fn add [a b] (+ a b))
    (export [add])
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("/**"), true);
  assertEquals(result.dts!.includes("* This function performs addition."), true);
  assertEquals(result.dts!.includes("* It takes two parameters and returns their sum."), true);
  assertEquals(result.dts!.includes("*/"), true);
});

Deno.test("DTS Generation: gracefully handles missing docstrings", async () => {
  const code = `
    (fn add [a b] (+ a b))
    (export [add])
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("export declare function add"), true);
  assertEquals(result.dts!.includes("/**"), false);
});

Deno.test("DTS Generation: JSDoc with export alias", async () => {
  const code = `
    /** Adds two numbers together */
    (fn add [a b] (+ a b))
    (export [add as addition])
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("/** Adds two numbers together */"), true);
  assertEquals(result.dts!.includes("export declare function addition"), true);
});

Deno.test("DTS Generation: preserves JSDoc tags", async () => {
  const code = `
    /**
     * Adds two numbers.
     * @param a First number
     * @param b Second number
     * @returns Sum
     */
    (fn add [a b] (+ a b))
    (export [add])
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("@param a First number"), true);
  assertEquals(result.dts!.includes("@param b Second number"), true);
  assertEquals(result.dts!.includes("@returns Sum"), true);
  assertEquals(result.dts!.includes("export declare function add"), true);
});

Deno.test("DTS Generation: default export preserves docstring", async () => {
  const code = `
    /** The main function */
    (fn main [] "main")
    (export default main)
  `;
  const result = await transpile(code, { baseDir: Deno.cwd(), generateDts: true });
  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("/** The main function */"), true);
  assertEquals(result.dts!.includes("declare function _default"), true);
});
