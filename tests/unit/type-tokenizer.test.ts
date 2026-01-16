/**
 * Tests for the dedicated TypeScript type tokenizer module
 *
 * This tests the type-tokenizer.ts module which provides:
 * - Type tokenization from source strings
 * - Bracket depth counting
 * - Type normalization (?T → nullable, T[] → Array<T>)
 * - Type extraction from symbols (name:type → {name, type})
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  countAngleBracketDepth,
  countBraceDepth,
  countBracketDepth,
  countParenDepth,
  extractAndNormalizeType,
  extractTypeFromSymbol,
  findTypeAnnotationColon,
  looksLikeTypeAnnotation,
  normalizeType,
  scanBalancedBrackets,
  tokenizeFunctionType,
  tokenizeObjectType,
  tokenizeTupleType,
  tokenizeType,
} from "../../src/hql/transpiler/tokenizer/type-tokenizer.ts";

// ============================================================================
// BRACKET DEPTH COUNTING TESTS
// ============================================================================

Deno.test("countAngleBracketDepth - balanced brackets", () => {
  assertEquals(countAngleBracketDepth("Array<T>"), 0);
  assertEquals(countAngleBracketDepth("Map<K, V>"), 0);
  assertEquals(countAngleBracketDepth("Promise<Array<T>>"), 0);
});

Deno.test("countAngleBracketDepth - unbalanced brackets", () => {
  assertEquals(countAngleBracketDepth("Array<T"), 1);
  assertEquals(countAngleBracketDepth("Map<K, V"), 1); // Only one < in this string
  assertEquals(countAngleBracketDepth("Map<K, Array<V"), 2); // Two < characters
  assertEquals(countAngleBracketDepth("T>"), -1);
});

Deno.test("countBraceDepth - balanced braces", () => {
  assertEquals(countBraceDepth("{name: string}"), 0);
  assertEquals(countBraceDepth("{a: {b: number}}"), 0);
});

Deno.test("countBraceDepth - unbalanced braces", () => {
  assertEquals(countBraceDepth("{name: string"), 1);
  assertEquals(countBraceDepth("name}"), -1);
});

Deno.test("countBracketDepth - balanced", () => {
  assertEquals(countBracketDepth("[string, number]"), 0);
  assertEquals(countBracketDepth("[[a], [b]]"), 0);
});

Deno.test("countParenDepth - balanced", () => {
  assertEquals(countParenDepth("(a: number) => string"), 0);
  assertEquals(countParenDepth("((a))"), 0);
});

// ============================================================================
// LOOKS LIKE TYPE ANNOTATION TESTS
// ============================================================================

Deno.test("looksLikeTypeAnnotation - with colon", () => {
  assertEquals(looksLikeTypeAnnotation("x:number"), true);
  assertEquals(looksLikeTypeAnnotation("data:Array<string>"), true);
});

Deno.test("looksLikeTypeAnnotation - generic patterns", () => {
  assertEquals(looksLikeTypeAnnotation("Array<T>"), true);
  assertEquals(looksLikeTypeAnnotation("Map<string, number>"), true);
});

Deno.test("looksLikeTypeAnnotation - non-type patterns", () => {
  assertEquals(looksLikeTypeAnnotation("x"), false);
  assertEquals(looksLikeTypeAnnotation("myVariable"), false);
  assertEquals(looksLikeTypeAnnotation("<"), false);
});

// ============================================================================
// FIND TYPE ANNOTATION COLON TESTS
// ============================================================================

Deno.test("findTypeAnnotationColon - simple types", () => {
  assertEquals(findTypeAnnotationColon("x:number"), 1);
  assertEquals(findTypeAnnotationColon("name:string"), 4);
  assertEquals(findTypeAnnotationColon("x"), -1);
});

Deno.test("findTypeAnnotationColon - generic types", () => {
  assertEquals(findTypeAnnotationColon("arr:Array<number>"), 3);
  assertEquals(findTypeAnnotationColon("map:Map<string, number>"), 3);
  assertEquals(findTypeAnnotationColon("data:Record<string, Array<number>>"), 4);
});

Deno.test("findTypeAnnotationColon - nested generics with colons inside", () => {
  // The colon inside Record should NOT be matched
  assertEquals(findTypeAnnotationColon("x:Record<string, {key: number}>"), 1);
});

Deno.test("findTypeAnnotationColon - function types", () => {
  assertEquals(findTypeAnnotationColon("cb:(a: number) => string"), 2);
  assertEquals(findTypeAnnotationColon("fn:(x: A, y: B) => C"), 2);
});

// ============================================================================
// SCAN BALANCED BRACKETS TESTS
// ============================================================================

Deno.test("scanBalancedBrackets - angle brackets", () => {
  const input = "Record<string,number> rest";
  // Starting after "Record<" with depth 1
  const result = scanBalancedBrackets(input, 7, 1, 0);
  assertEquals(result, "string,number>");
});

Deno.test("scanBalancedBrackets - nested angle brackets", () => {
  const input = "Map<string,Array<number>> rest";
  const result = scanBalancedBrackets(input, 4, 1, 0);
  assertEquals(result, "string,Array<number>>");
});

Deno.test("scanBalancedBrackets - braces", () => {
  const input = "{name: string} rest";
  const result = scanBalancedBrackets(input, 1, 0, 1);
  assertEquals(result, "name: string}");
});

Deno.test("scanBalancedBrackets - mixed", () => {
  const input = "Map<string,{id: number}> rest";
  const result = scanBalancedBrackets(input, 4, 1, 0);
  assertEquals(result, "string,{id: number}>");
});

Deno.test("scanBalancedBrackets - trailing array", () => {
  const input = "Array<number>[] rest";
  const result = scanBalancedBrackets(input, 6, 1, 0);
  assertEquals(result, "number>[]");
});

// ============================================================================
// TOKENIZE TYPE TESTS
// ============================================================================

Deno.test("tokenizeType - basic types", () => {
  assertEquals(tokenizeType("string ", 0).type, "string");
  assertEquals(tokenizeType("number)", 0).type, "number");
  assertEquals(tokenizeType("boolean]", 0).type, "boolean");
});

Deno.test("tokenizeType - generic types", () => {
  assertEquals(tokenizeType("Array<string> ", 0).type, "Array<string>");
  assertEquals(tokenizeType("Map<string, number> ", 0).type, "Map<string, number>");
  assertEquals(tokenizeType("Promise<void>)", 0).type, "Promise<void>");
});

Deno.test("tokenizeType - nested generics", () => {
  const result = tokenizeType("Map<string, Array<number>> ", 0);
  assertEquals(result.type, "Map<string, Array<number>>");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - nullable types", () => {
  assertEquals(tokenizeType("?string ", 0).type, "?string");
  assertEquals(tokenizeType("?number)", 0).type, "?number");
});

Deno.test("tokenizeType - array types", () => {
  assertEquals(tokenizeType("string[] ", 0).type, "string[]");
  assertEquals(tokenizeType("Array<number>[] ", 0).type, "Array<number>[]");
});

Deno.test("tokenizeType - union types", () => {
  assertEquals(tokenizeType("string | number ", 0).type, "string | number");
  assertEquals(tokenizeType("A | B | C)", 0).type, "A | B | C");
});

Deno.test("tokenizeType - intersection types", () => {
  assertEquals(tokenizeType("A & B ", 0).type, "A & B");
});

Deno.test("tokenizeType - isValid flag", () => {
  assertEquals(tokenizeType("Array<string>", 0).isValid, true);
  assertEquals(tokenizeType("Array<string", 0).isValid, false); // unbalanced
});

// ============================================================================
// TOKENIZE OBJECT TYPE TESTS
// ============================================================================

Deno.test("tokenizeObjectType - simple object", () => {
  const result = tokenizeObjectType("{name: string}", 0);
  assertEquals(result.type, "{name: string}");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeObjectType - multiple properties", () => {
  const result = tokenizeObjectType("{x: number, y: number}", 0);
  assertEquals(result.type, "{x: number, y: number}");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeObjectType - nested object", () => {
  const result = tokenizeObjectType("{user: {name: string}}", 0);
  assertEquals(result.type, "{user: {name: string}}");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeObjectType - with array suffix", () => {
  const result = tokenizeObjectType("{x: number}[] rest", 0);
  assertEquals(result.type, "{x: number}[]");
});

// ============================================================================
// TOKENIZE TUPLE TYPE TESTS
// ============================================================================

Deno.test("tokenizeTupleType - simple tuple", () => {
  const result = tokenizeTupleType("[string, number]", 0);
  assertEquals(result.type, "[string, number]");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeTupleType - nested", () => {
  const result = tokenizeTupleType("[[string], [number]]", 0);
  assertEquals(result.type, "[[string], [number]]");
  assertEquals(result.isValid, true);
});

// ============================================================================
// TOKENIZE FUNCTION TYPE TESTS
// ============================================================================

Deno.test("tokenizeFunctionType - simple function", () => {
  const result = tokenizeFunctionType("(x: number) => string rest", 0);
  assertEquals(result.type, "(x: number)=>string");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeFunctionType - multiple parameters", () => {
  const result = tokenizeFunctionType("(a: number, b: string) => boolean ", 0);
  assertEquals(result.type, "(a: number, b: string)=>boolean");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeFunctionType - void return", () => {
  const result = tokenizeFunctionType("() => void ", 0);
  assertEquals(result.type, "()=>void");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeFunctionType - generic return", () => {
  const result = tokenizeFunctionType("(x: T) => Promise<T> ", 0);
  assertEquals(result.type, "(x: T)=>Promise<T>");
  assertEquals(result.isValid, true);
});

// ============================================================================
// NORMALIZE TYPE TESTS
// ============================================================================

Deno.test("normalizeType - nullable prefix", () => {
  assertEquals(normalizeType("?string"), "(string) | null | undefined");
  assertEquals(normalizeType("?number"), "(number) | null | undefined");
});

Deno.test("normalizeType - array suffix", () => {
  assertEquals(normalizeType("string[]"), "Array<string>");
  assertEquals(normalizeType("number[]"), "Array<number>");
});

Deno.test("normalizeType - nullable array", () => {
  assertEquals(normalizeType("?string[]"), "(Array<string>) | null | undefined");
});

Deno.test("normalizeType - nested array", () => {
  assertEquals(normalizeType("number[][]"), "Array<Array<number>>");
});

Deno.test("normalizeType - passthrough for simple types", () => {
  assertEquals(normalizeType("string"), "string");
  assertEquals(normalizeType("number"), "number");
  assertEquals(normalizeType("Array<T>"), "Array<T>");
});

Deno.test("normalizeType - conditional types NOT transformed", () => {
  const conditionalType = "T extends string ? A : B";
  assertEquals(normalizeType(conditionalType), conditionalType);
});

Deno.test("normalizeType - complex conditional preserved", () => {
  const conditionalType = "T extends Array<U> ? U : never";
  assertEquals(normalizeType(conditionalType), conditionalType);
});

// ============================================================================
// EXTRACT TYPE FROM SYMBOL TESTS
// ============================================================================

Deno.test("extractTypeFromSymbol - simple type", () => {
  const result = extractTypeFromSymbol("x:number");
  assertEquals(result.name, "x");
  assertEquals(result.type, "number");
});

Deno.test("extractTypeFromSymbol - generic type", () => {
  const result = extractTypeFromSymbol("arr:Array<string>");
  assertEquals(result.name, "arr");
  assertEquals(result.type, "Array<string>");
});

Deno.test("extractTypeFromSymbol - complex generic", () => {
  const result = extractTypeFromSymbol("data:Map<string, Array<number>>");
  assertEquals(result.name, "data");
  assertEquals(result.type, "Map<string, Array<number>>");
});

Deno.test("extractTypeFromSymbol - no type", () => {
  const result = extractTypeFromSymbol("x");
  assertEquals(result.name, "x");
  assertEquals(result.type, undefined);
});

Deno.test("extractTypeFromSymbol - function type", () => {
  const result = extractTypeFromSymbol("cb:(a: number) => string");
  assertEquals(result.name, "cb");
  assertEquals(result.type, "(a: number) => string");
});

// ============================================================================
// EXTRACT AND NORMALIZE TYPE TESTS
// ============================================================================

Deno.test("extractAndNormalizeType - nullable", () => {
  const result = extractAndNormalizeType("x:?string");
  assertEquals(result.name, "x");
  assertEquals(result.type, "(string) | null | undefined");
});

Deno.test("extractAndNormalizeType - array", () => {
  const result = extractAndNormalizeType("arr:number[]");
  assertEquals(result.name, "arr");
  assertEquals(result.type, "Array<number>");
});

Deno.test("extractAndNormalizeType - nullable array", () => {
  const result = extractAndNormalizeType("arr:?string[]");
  assertEquals(result.name, "arr");
  assertEquals(result.type, "(Array<string>) | null | undefined");
});

Deno.test("extractAndNormalizeType - no type", () => {
  const result = extractAndNormalizeType("x");
  assertEquals(result.name, "x");
  assertEquals(result.type, undefined);
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

Deno.test("edge case - empty string", () => {
  assertEquals(findTypeAnnotationColon(""), -1);
  assertEquals(countAngleBracketDepth(""), 0);
});

Deno.test("edge case - colon only", () => {
  assertEquals(findTypeAnnotationColon(":"), 0);
});

Deno.test("edge case - nullable object type", () => {
  assertEquals(normalizeType("?{name: string}"), "({name: string}) | null | undefined");
});

Deno.test("edge case - deeply nested generics", () => {
  const deep = "Map<string, Map<string, Map<string, number>>>";
  assertEquals(countAngleBracketDepth(deep), 0);
  const result = tokenizeType(deep + " ", 0);
  assertEquals(result.type, deep);
  assertEquals(result.isValid, true);
});

Deno.test("edge case - whitespace in types", () => {
  // Note: extractTypeFromSymbol trims both name and type
  const result = extractTypeFromSymbol("x: number");
  assertEquals(result.name, "x");
  assertEquals(result.type, "number"); // Trimmed
});

Deno.test("edge case - multiple colons in type", () => {
  // Record<string, {key: value}> has colons inside
  const result = extractTypeFromSymbol("x:Record<string, {key: number}>");
  assertEquals(result.name, "x");
  assertEquals(result.type, "Record<string, {key: number}>");
});

// ============================================================================
// TYPE KEYWORD TESTS - keyof, typeof, readonly, infer
// ============================================================================

Deno.test("tokenizeType - keyof keyword", () => {
  const result = tokenizeType("keyof T ", 0);
  assertEquals(result.type, "keyof T");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - keyof with complex type", () => {
  const result = tokenizeType("keyof typeof obj ", 0);
  assertEquals(result.type, "keyof typeof obj");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - typeof keyword", () => {
  const result = tokenizeType("typeof myVariable ", 0);
  assertEquals(result.type, "typeof myVariable");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - readonly array", () => {
  const result = tokenizeType("readonly string[] ", 0);
  assertEquals(result.type, "readonly string[]");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - readonly tuple", () => {
  const result = tokenizeType("readonly [string, number] ", 0);
  assertEquals(result.type, "readonly [string, number]");
  assertEquals(result.isValid, true);
});

Deno.test("extractTypeFromSymbol - keyof type", () => {
  const result = extractTypeFromSymbol("keys:keyof T");
  assertEquals(result.name, "keys");
  assertEquals(result.type, "keyof T");
});

Deno.test("extractTypeFromSymbol - typeof type", () => {
  const result = extractTypeFromSymbol("value:typeof defaultValue");
  assertEquals(result.name, "value");
  assertEquals(result.type, "typeof defaultValue");
});

Deno.test("extractTypeFromSymbol - readonly array", () => {
  const result = extractTypeFromSymbol("items:readonly string[]");
  assertEquals(result.name, "items");
  assertEquals(result.type, "readonly string[]");
});

// ============================================================================
// CONDITIONAL TYPE TESTS - T extends U ? A : B
// ============================================================================

Deno.test("tokenizeType - simple conditional type", () => {
  const result = tokenizeType("T extends string ? A : B ", 0);
  assertEquals(result.type, "T extends string ? A : B");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - conditional with infer", () => {
  const result = tokenizeType("T extends Array<infer U> ? U : never ", 0);
  assertEquals(result.type, "T extends Array<infer U> ? U : never");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - nested conditional", () => {
  const result = tokenizeType("T extends A ? B extends C ? D : E : F ", 0);
  assertEquals(result.type, "T extends A ? B extends C ? D : E : F");
  assertEquals(result.isValid, true);
});

Deno.test("extractTypeFromSymbol - conditional type", () => {
  const result = extractTypeFromSymbol("x:T extends string ? number : boolean");
  assertEquals(result.name, "x");
  assertEquals(result.type, "T extends string ? number : boolean");
});

Deno.test("extractTypeFromSymbol - infer type", () => {
  const result = extractTypeFromSymbol("unwrapped:T extends Promise<infer U> ? U : T");
  assertEquals(result.name, "unwrapped");
  assertEquals(result.type, "T extends Promise<infer U> ? U : T");
});

// ============================================================================
// TEMPLATE LITERAL TYPE TESTS
// ============================================================================

Deno.test("tokenizeType - simple template literal", () => {
  const result = tokenizeType("`prefix_${string}` ", 0);
  assertEquals(result.type, "`prefix_${string}`");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - template literal with union", () => {
  const result = tokenizeType("`${'a' | 'b'}_suffix` ", 0);
  assertEquals(result.type, "`${'a' | 'b'}_suffix`");
  assertEquals(result.isValid, true);
});

Deno.test("extractTypeFromSymbol - template literal", () => {
  const result = extractTypeFromSymbol("key:`prefix_${string}`");
  assertEquals(result.name, "key");
  assertEquals(result.type, "`prefix_${string}`");
});

// ============================================================================
// MAPPED TYPE TESTS
// ============================================================================

Deno.test("tokenizeType - mapped type with keyof", () => {
  const result = tokenizeType("{[K in keyof T]: T[K]} ", 0);
  assertEquals(result.type, "{[K in keyof T]: T[K]}");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - mapped type with readonly", () => {
  const result = tokenizeType("{readonly [K in keyof T]: T[K]} ", 0);
  assertEquals(result.type, "{readonly [K in keyof T]: T[K]}");
  assertEquals(result.isValid, true);
});

Deno.test("extractTypeFromSymbol - mapped type", () => {
  const result = extractTypeFromSymbol("partial:{[K in keyof T]?: T[K]}");
  assertEquals(result.name, "partial");
  assertEquals(result.type, "{[K in keyof T]?: T[K]}");
});

// ============================================================================
// COMPLEX COMBINED TYPE TESTS
// ============================================================================

Deno.test("tokenizeType - union with keyof", () => {
  const result = tokenizeType("keyof T | keyof U ", 0);
  assertEquals(result.type, "keyof T | keyof U");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - intersection with readonly", () => {
  const result = tokenizeType("readonly string[] & Iterable<string> ", 0);
  assertEquals(result.type, "readonly string[] & Iterable<string>");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - conditional with keyof", () => {
  const result = tokenizeType("K extends keyof T ? T[K] : never ", 0);
  assertEquals(result.type, "K extends keyof T ? T[K] : never");
  assertEquals(result.isValid, true);
});

Deno.test("extractTypeFromSymbol - complex combined", () => {
  const result = extractTypeFromSymbol(
    "getter:<K extends keyof T>(key: K) => T[K]"
  );
  assertEquals(result.name, "getter");
  // Note: The outer function type may need special handling
  assertEquals(result.type, "<K extends keyof T>(key: K) => T[K]");
});

// ============================================================================
// CONSTRUCTOR TYPE TESTS
// ============================================================================

Deno.test("tokenizeType - constructor type", () => {
  const result = tokenizeType("new () => MyClass ", 0);
  assertEquals(result.type, "new () => MyClass");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - constructor with params", () => {
  const result = tokenizeType("new (x: number) => MyClass ", 0);
  assertEquals(result.type, "new (x: number) => MyClass");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - abstract constructor", () => {
  const result = tokenizeType("abstract new () => T ", 0);
  assertEquals(result.type, "abstract new () => T");
  assertEquals(result.isValid, true);
});

// ============================================================================
// TYPE PREDICATE TESTS
// ============================================================================

Deno.test("tokenizeType - type predicate is", () => {
  const result = tokenizeType("x is string ", 0);
  assertEquals(result.type, "x is string");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - asserts predicate", () => {
  const result = tokenizeType("asserts x is T ", 0);
  assertEquals(result.type, "asserts x is T");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - asserts condition", () => {
  const result = tokenizeType("asserts condition ", 0);
  assertEquals(result.type, "asserts condition");
  assertEquals(result.isValid, true);
});

// ============================================================================
// IMPORT TYPE TESTS
// ============================================================================

Deno.test("tokenizeType - import type", () => {
  const result = tokenizeType('import("./mod").Type ', 0);
  assertEquals(result.type, 'import("./mod").Type');
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - typeof import", () => {
  const result = tokenizeType('typeof import("./mod") ', 0);
  assertEquals(result.type, 'typeof import("./mod")');
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - import with path", () => {
  const result = tokenizeType('import("./path/to/module").SomeType ', 0);
  assertEquals(result.type, 'import("./path/to/module").SomeType');
  assertEquals(result.isValid, true);
});

// ============================================================================
// COMPLEX FUNCTION TYPE IN CONDITIONAL TESTS
// ============================================================================

Deno.test("tokenizeType - function type in conditional", () => {
  const result = tokenizeType(
    "T extends (...args: infer A) => infer R ? [A, R] : never ",
    0
  );
  assertEquals(result.type, "T extends (...args: infer A) => infer R ? [A, R] : never");
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - function arrow after balanced parens", () => {
  const result = tokenizeType("(x: number) => string ", 0);
  assertEquals(result.type, "(x: number) => string");
  assertEquals(result.isValid, true);
});

// ============================================================================
// STRING LITERAL TYPE TESTS
// ============================================================================

Deno.test("tokenizeType - string literal with special chars", () => {
  assertEquals(tokenizeType('")" ', 0).type, '")"');
  assertEquals(tokenizeType('"[" ', 0).type, '"["');
  assertEquals(tokenizeType('"a]b" ', 0).type, '"a]b"');
});

Deno.test("tokenizeType - string literal union", () => {
  const result = tokenizeType('")" | "(" ', 0);
  assertEquals(result.type, '")" | "("');
  assertEquals(result.isValid, true);
});

Deno.test("tokenizeType - single quote string literal", () => {
  assertEquals(tokenizeType("')' ", 0).type, "')'");
  assertEquals(tokenizeType("'hello' ", 0).type, "'hello'");
});
