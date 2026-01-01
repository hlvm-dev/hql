// Tests for native HQL type expressions (not string passthrough)
// These tests verify that HQL can express TypeScript types using native S-expression syntax
import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { generateTypeScript } from "../../src/transpiler/pipeline/ir-to-typescript.ts";
import { transformToIR } from "../../src/transpiler/pipeline/hql-ast-to-hql-ir.ts";
import { parse } from "../../src/transpiler/pipeline/parser.ts";

// Helper to get TypeScript output from HQL
function hqlToTypeScript(hql: string): string {
  const ast = parse(hql);
  const ir = transformToIR(ast, "/tmp");
  const result = generateTypeScript(ir, {});
  return result.code;
}

// ============================================================================
// Type Keyword (new primary keyword)
// ============================================================================

Deno.test("type keyword: simple type alias", () => {
  const result = hqlToTypeScript(`(type MyString string)`);
  assertStringIncludes(result, "type MyString = string;");
});

Deno.test("type keyword: with symbol type", () => {
  const result = hqlToTypeScript(`(type ID number)`);
  assertStringIncludes(result, "type ID = number;");
});

Deno.test("type keyword: with generic parameter", () => {
  const result = hqlToTypeScript(`(type Container<T> T)`);
  assertStringIncludes(result, "type Container<T> = T;");
});

Deno.test("type keyword: string passthrough still works", () => {
  const result = hqlToTypeScript(`(type Complex "Record<string, number>")`);
  assertStringIncludes(result, "type Complex = Record<string, number>;");
});

// ============================================================================
// Backward Compatibility: deftype still works
// ============================================================================

Deno.test("deftype: still works for backward compatibility", () => {
  const result = hqlToTypeScript(`(deftype MyNumber number)`);
  assertStringIncludes(result, "type MyNumber = number;");
});

// ============================================================================
// Native Union Types: (| A B C)
// ============================================================================

Deno.test("Union: two types", () => {
  const result = hqlToTypeScript(`(type StringOrNumber (| string number))`);
  assertStringIncludes(result, "type StringOrNumber = string | number;");
});

Deno.test("Union: three types", () => {
  const result = hqlToTypeScript(`(type Status (| "pending" "active" "done"))`);
  assertStringIncludes(result, 'type Status = "pending" | "active" | "done";');
});

Deno.test("Union: with null and undefined", () => {
  const result = hqlToTypeScript(`(type Nullable (| string null undefined))`);
  assertStringIncludes(result, "type Nullable = string | null | undefined;");
});

// ============================================================================
// Native Intersection Types: (& A B C)
// ============================================================================

Deno.test("Intersection: two types", () => {
  const result = hqlToTypeScript(`(type Combined (& A B))`);
  assertStringIncludes(result, "type Combined = A & B;");
});

Deno.test("Intersection: three types", () => {
  const result = hqlToTypeScript(`(type AllTraits (& Runnable Printable Serializable))`);
  assertStringIncludes(result, "type AllTraits = Runnable & Printable & Serializable;");
});

// ============================================================================
// Native Keyof: (keyof T)
// ============================================================================

Deno.test("Keyof: basic usage", () => {
  const result = hqlToTypeScript(`(type Keys (keyof Person))`);
  assertStringIncludes(result, "type Keys = keyof Person;");
});

Deno.test("Keyof: with generic", () => {
  const result = hqlToTypeScript(`(type Keys<T> (keyof T))`);
  assertStringIncludes(result, "type Keys<T> = keyof T;");
});

// ============================================================================
// Native Indexed Access: (indexed T K) or ([] T K)
// ============================================================================

Deno.test("Indexed access: string literal key", () => {
  const result = hqlToTypeScript(`(type NameType (indexed Person "name"))`);
  assertStringIncludes(result, 'type NameType = Person["name"];');
});

Deno.test("Indexed access: with keyof", () => {
  const result = hqlToTypeScript(`(type Value<T> (indexed T (keyof T)))`);
  assertStringIncludes(result, "type Value<T> = T[keyof T];");
});

// Note: [] syntax is not supported because [] is parsed as empty vector, not a symbol
// Use (indexed T K) syntax instead

// ============================================================================
// Native Conditional Types: (if-extends T U Then Else)
// ============================================================================

Deno.test("Conditional type: basic", () => {
  const result = hqlToTypeScript(`(type IsString<T> (if-extends T string true false))`);
  assertStringIncludes(result, "type IsString<T> = T extends string ? true : false;");
});

Deno.test("Conditional type: with infer", () => {
  const result = hqlToTypeScript(`(type UnwrapPromise<T> (if-extends T (Promise (infer U)) U T))`);
  assertStringIncludes(result, "type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;");
});

Deno.test("Conditional type: nested", () => {
  const result = hqlToTypeScript(`(type Deep<T> (if-extends T string "str" (if-extends T number "num" "other")))`);
  assertStringIncludes(result, 'type Deep<T> = T extends string ? "str" : T extends number ? "num" : "other";');
});

// ============================================================================
// Native Tuple Types: (tuple A B C)
// ============================================================================

Deno.test("Tuple: two elements", () => {
  const result = hqlToTypeScript(`(type Point (tuple number number))`);
  assertStringIncludes(result, "type Point = [number, number];");
});

Deno.test("Tuple: mixed types", () => {
  const result = hqlToTypeScript(`(type Entry (tuple string number boolean))`);
  assertStringIncludes(result, "type Entry = [string, number, boolean];");
});

Deno.test("Tuple: with rest element", () => {
  const result = hqlToTypeScript(`(type Args (tuple string (rest (array number))))`);
  assertStringIncludes(result, "type Args = [string, ...number[]];");
});

// ============================================================================
// Native Array Types: (array T)
// ============================================================================

Deno.test("Array: simple element type", () => {
  const result = hqlToTypeScript(`(type Numbers (array number))`);
  assertStringIncludes(result, "type Numbers = number[];");
});

Deno.test("Array: of union with parentheses", () => {
  const result = hqlToTypeScript(`(type MixedArray (array (| string number)))`);
  assertStringIncludes(result, "type MixedArray = (string | number)[];");
});

Deno.test("Array: of intersection with parentheses", () => {
  const result = hqlToTypeScript(`(type CombinedArray (array (& A B)))`);
  assertStringIncludes(result, "type CombinedArray = (A & B)[];");
});

// ============================================================================
// Native Mapped Types: (mapped K T ValueType)
// ============================================================================

Deno.test("Mapped type: basic", () => {
  const result = hqlToTypeScript(`(type Readonly<T> (mapped K (keyof T) (indexed T K)))`);
  assertStringIncludes(result, "type Readonly<T> = { [K in keyof T]: T[K] };");
});

// ============================================================================
// Native Readonly Type: (readonly T)
// ============================================================================

Deno.test("Readonly: array", () => {
  const result = hqlToTypeScript(`(type ImmutableNumbers (readonly (array number)))`);
  assertStringIncludes(result, "type ImmutableNumbers = readonly number[];");
});

// ============================================================================
// Native Typeof: (typeof expr)
// ============================================================================

Deno.test("Typeof: variable", () => {
  const result = hqlToTypeScript(`(type MyType (typeof myVar))`);
  assertStringIncludes(result, "type MyType = typeof myVar;");
});

// ============================================================================
// Native Infer: (infer T)
// ============================================================================

Deno.test("Infer: in conditional", () => {
  const result = hqlToTypeScript(`(type ArrayElement<T> (if-extends T (array (infer E)) E never))`);
  assertStringIncludes(result, "type ArrayElement<T> = T extends (infer E)[] ? E : never;");
});

// ============================================================================
// Utility Type Application: (Utility Arg)
// ============================================================================

Deno.test("Utility type: Partial", () => {
  const result = hqlToTypeScript(`(type PartialPerson (Partial Person))`);
  assertStringIncludes(result, "type PartialPerson = Partial<Person>;");
});

Deno.test("Utility type: Required", () => {
  const result = hqlToTypeScript(`(type RequiredConfig (Required Config))`);
  assertStringIncludes(result, "type RequiredConfig = Required<Config>;");
});

Deno.test("Utility type: Pick with two args", () => {
  const result = hqlToTypeScript(`(type PickedPerson (Pick Person (| "name" "age")))`);
  assertStringIncludes(result, 'type PickedPerson = Pick<Person, "name" | "age">;');
});

Deno.test("Utility type: Record", () => {
  const result = hqlToTypeScript(`(type StringRecord (Record string number))`);
  assertStringIncludes(result, "type StringRecord = Record<string, number>;");
});

// ============================================================================
// Precedence and Complex Nested Types
// ============================================================================

Deno.test("Precedence: intersection inside union", () => {
  const result = hqlToTypeScript(`(type T (| (& A B) C))`);
  assertStringIncludes(result, "type T = (A & B) | C;");
});

Deno.test("Precedence: union inside array", () => {
  const result = hqlToTypeScript(`(type T (array (| A B)))`);
  assertStringIncludes(result, "type T = (A | B)[];");
});

Deno.test("Complex nested: union with intersection, tuple, and array", () => {
  const result = hqlToTypeScript(`(type ComplexType (| (& A B) (tuple number string) (array (| C D))))`);
  assertStringIncludes(result, "type ComplexType = (A & B) | [number, string] | (C | D)[];");
});

Deno.test("Complex nested: conditional with union", () => {
  const result = hqlToTypeScript(`(type Flatten<T> (if-extends T (array (infer U)) U T))`);
  assertStringIncludes(result, "type Flatten<T> = T extends (infer U)[] ? U : T;");
});

// ============================================================================
// Literal Types
// ============================================================================

Deno.test("Literal type: number in conditional", () => {
  const result = hqlToTypeScript(`(type IsZero<T> (if-extends T 0 true false))`);
  assertStringIncludes(result, "type IsZero<T> = T extends 0 ? true : false;");
});
