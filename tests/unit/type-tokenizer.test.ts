import { assertEquals } from "jsr:@std/assert";
import {
  countAngleBracketDepth,
  countBraceDepth,
  countBracketDepth,
  countParenDepth,
  extractAndNormalizeType,
  extractEffect,
  extractTypeFromSymbol,
  findTypeAnnotationColon,
  normalizeType,
  splitEffectTypeParams,
  tokenizeFunctionType,
  tokenizeObjectType,
  tokenizeTupleType,
  tokenizeType,
} from "../../src/hql/transpiler/tokenizer/type-tokenizer.ts";

Deno.test("Type tokenizer: depth counters distinguish balanced and unbalanced forms", () => {
  assertEquals(countAngleBracketDepth("Promise<Array<T>>"), 0);
  assertEquals(countAngleBracketDepth("Map<K, Array<V"), 2);
  assertEquals(countBraceDepth("{a: {b: number}}"), 0);
  assertEquals(countBraceDepth("{name: string"), 1);
  assertEquals(countBracketDepth("[[a], [b]]"), 0);
  assertEquals(countParenDepth("(a: number) => string"), 0);
});

Deno.test("Type tokenizer: finds annotation colon only at top level", () => {
  assertEquals(findTypeAnnotationColon("x:number"), 1);
  assertEquals(findTypeAnnotationColon("arr:Array<number>"), 3);
  assertEquals(findTypeAnnotationColon("cb:(a: number) => string"), 2);
  assertEquals(findTypeAnnotationColon("x:Record<string, {key: number}>"), 1);
  assertEquals(findTypeAnnotationColon("x"), -1);
});

Deno.test("Type tokenizer: tokenizes core type forms", () => {
  const generic = tokenizeType("Map<string, Array<number>> ", 0);
  const conditional = tokenizeType("T extends Array<infer U> ? U : never ", 0);
  const template = tokenizeType("`prefix_${string}` ", 0);
  const mapped = tokenizeType("{[K in keyof T]: T[K]} ", 0);
  const constructor = tokenizeType("new (x: number) => MyClass ", 0);
  const predicate = tokenizeType("asserts x is T ", 0);
  const importType = tokenizeType('import("./mod").Type ', 0);

  assertEquals(generic.type, "Map<string, Array<number>>");
  assertEquals(generic.isValid, true);
  assertEquals(conditional.type, "T extends Array<infer U> ? U : never");
  assertEquals(template.type, "`prefix_${string}`");
  assertEquals(mapped.type, "{[K in keyof T]: T[K]}");
  assertEquals(constructor.type, "new (x: number) => MyClass");
  assertEquals(predicate.type, "asserts x is T");
  assertEquals(importType.type, 'import("./mod").Type');
});

Deno.test("Type tokenizer: object, tuple, and function tokenizers preserve structured forms", () => {
  const objectType = tokenizeObjectType("{user: {name: string}}[] rest", 0);
  const tupleType = tokenizeTupleType("[[string], [number]]", 0);
  const fnType = tokenizeFunctionType("(a: number, b: string) => boolean ", 0);

  assertEquals(objectType.type, "{user: {name: string}}[]");
  assertEquals(objectType.isValid, true);
  assertEquals(tupleType.type, "[[string], [number]]");
  assertEquals(tupleType.isValid, true);
  assertEquals(fnType.type, "(a: number, b: string)=>boolean");
  assertEquals(fnType.isValid, true);
});

Deno.test("Type tokenizer: symbol extraction preserves names and complex raw types", () => {
  const plain = extractTypeFromSymbol("x:number");
  const fn = extractTypeFromSymbol("cb:(a: number) => string");
  const conditional = extractTypeFromSymbol("x:T extends string ? number : boolean");
  const template = extractTypeFromSymbol("key:`prefix_${string}`");
  const mapped = extractTypeFromSymbol("partial:{[K in keyof T]?: T[K]}");
  const none = extractTypeFromSymbol("bare");

  assertEquals(plain, { name: "x", type: "number" });
  assertEquals(fn, { name: "cb", type: "(a: number) => string" });
  assertEquals(conditional.type, "T extends string ? number : boolean");
  assertEquals(template.type, "`prefix_${string}`");
  assertEquals(mapped.type, "{[K in keyof T]?: T[K]}");
  assertEquals(none, { name: "bare", type: undefined });
});

Deno.test("Type tokenizer: normalization covers nullable, generic, effect, and Swift shorthand types", () => {
  assertEquals(normalizeType("?string"), "(string) | null | undefined");
  assertEquals(normalizeType("String?"), "(string) | null | undefined");
  assertEquals(normalizeType("number[][]"), "Array<Array<number>>");
  assertEquals(normalizeType("Array<Map<String, Bool>>"), "Array<Map<string, boolean>>");
  assertEquals(normalizeType("(Pure Int Int)"), "(arg0: number) => number");
  assertEquals(normalizeType("(fx (fn [number] string) number)"), "(arg0: (arg0: number) => string) => number");
  assertEquals(normalizeType("[String: [Int]]"), "Map<string, Array<number>>");
  assertEquals(normalizeType("(Int, String)"), "[number, string]");
  assertEquals(normalizeType("Optional<Array<Int>>"), "(Array<number>) | null | undefined");
  assertEquals(normalizeType("Int | String | Bool"), "number | string | boolean");
});

Deno.test("Type tokenizer: extractAndNormalizeType applies normalization to symbol annotations", () => {
  assertEquals(extractAndNormalizeType("x:?string"), {
    effect: undefined,
    name: "x",
    type: "(string) | null | undefined",
  });
  assertEquals(extractAndNormalizeType("arr:[Int]"), {
    effect: undefined,
    name: "arr",
    type: "Array<number>",
  });
  assertEquals(extractAndNormalizeType("m:[String: Int]"), {
    effect: undefined,
    name: "m",
    type: "Map<string, number>",
  });
  assertEquals(extractAndNormalizeType("pair:(Int, String)"), {
    effect: undefined,
    name: "pair",
    type: "[number, string]",
  });
  assertEquals(extractAndNormalizeType("x"), { name: "x", type: undefined });
});

Deno.test("Type tokenizer: effect extraction and splitting preserve callable metadata", () => {
  const pure = extractEffect("(Pure (fn [number] string) number)");
  const plainFunction = extractEffect("(fn [number] string)");

  assertEquals(pure.effect, "Pure");
  assertEquals(pure.innerType, "(fn [number] string) number");
  assertEquals(plainFunction.effect, undefined);
  assertEquals(plainFunction.innerType, "(fn [number] string)");
  assertEquals(splitEffectTypeParams("(fn [number] string) number"), [
    "(fn [number] string)",
    "number",
  ]);
});
