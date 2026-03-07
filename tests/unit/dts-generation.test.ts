import { assertEquals } from "jsr:@std/assert";
import { transpile } from "../../src/hql/transpiler/index.ts";
import { getPlatform } from "../../src/platform/platform.ts";

Deno.test("dts generation: named function and variable exports emit declarations", async () => {
  const result = await transpile(`
    (fn add [a b] (+ a b))
    (const PI 3.14159)
    (export [add PI])
  `, {
    baseDir: getPlatform().process.cwd(),
    generateDts: true,
  });

  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("export declare function add"), true);
  assertEquals(result.dts!.includes("a: any"), true);
  assertEquals(result.dts!.includes("b: any"), true);
  assertEquals(result.dts!.includes("export declare const PI: any"), true);
});

Deno.test("dts generation: default exports and mixed export forms emit the expected declarations", async () => {
  const result = await transpile(`
    (fn helper [] 1)
    (fn main [args] (helper))
    (export [helper])
    (export default main)
  `, {
    baseDir: getPlatform().process.cwd(),
    generateDts: true,
  });

  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("export declare function helper"), true);
  assertEquals(result.dts!.includes("declare function _default"), true);
  assertEquals(result.dts!.includes("export default _default"), true);
});

Deno.test("dts generation: async functions and classes retain their declaration shapes", async () => {
  const result = await transpile(`
    (async fn fetchData [url] (await (fetch url)))
    (class Calculator
      (constructor [baseValue]
        baseValue)
      (fn add [x]
        x)
      (fn multiply [x y]
        (* x y)))
    (export [fetchData Calculator])
  `, {
    baseDir: getPlatform().process.cwd(),
    generateDts: true,
  });

  assertEquals(result.dts !== undefined, true);
  assertEquals(result.dts!.includes("export declare async function fetchData"), true);
  assertEquals(result.dts!.includes("export declare class Calculator"), true);
  assertEquals(result.dts!.includes("constructor(baseValue: any)"), true);
  assertEquals(result.dts!.includes("add(x: any): any"), true);
  assertEquals(result.dts!.includes("multiply(x: any, y: any): any"), true);
});

Deno.test("dts generation: docstrings and tags are preserved, including aliases and default exports", async () => {
  const aliased = await transpile(`
    /**
     * Adds two numbers.
     * @param a First number
     * @param b Second number
     * @returns Sum
     */
    (fn add [a b] (+ a b))
    (export [add as addition])
  `, {
    baseDir: getPlatform().process.cwd(),
    generateDts: true,
  });
  const defaultExport = await transpile(`
    /** The main function */
    (fn main [] "main")
    (export default main)
  `, {
    baseDir: getPlatform().process.cwd(),
    generateDts: true,
  });

  assertEquals(aliased.dts !== undefined, true);
  assertEquals(aliased.dts!.includes("/**"), true);
  assertEquals(aliased.dts!.includes("@param a First number"), true);
  assertEquals(aliased.dts!.includes("@returns Sum"), true);
  assertEquals(aliased.dts!.includes("export declare function addition"), true);

  assertEquals(defaultExport.dts !== undefined, true);
  assertEquals(defaultExport.dts!.includes("/** The main function */"), true);
  assertEquals(defaultExport.dts!.includes("export default _default"), true);
});

Deno.test("dts generation: generateDts is opt-in and empty modules emit export {}", async () => {
  const disabled = await transpile(`
    (fn add [a b] (+ a b))
    (export [add])
  `, {
    baseDir: getPlatform().process.cwd(),
  });
  const emptyModule = await transpile(`
    (const x 1)
  `, {
    baseDir: getPlatform().process.cwd(),
    generateDts: true,
  });

  assertEquals(disabled.dts, undefined);
  assertEquals(emptyModule.dts !== undefined, true);
  assertEquals(emptyModule.dts!.includes("export {}"), true);
});
