// Tests for advanced TypeScript features
// All features are type-level and get erased when compiling to JS
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
// Type Aliases with Advanced Type Operators
// ============================================================================

Deno.test("Type alias: keyof operator", () => {
  const result = hqlToTypeScript(`(deftype PersonKeys "keyof Person")`);
  assertStringIncludes(result, "type PersonKeys = keyof Person;");
});

Deno.test("Type alias: indexed access type", () => {
  const result = hqlToTypeScript(`(deftype NameType "Person['name']")`);
  assertStringIncludes(result, "type NameType = Person['name'];");
});

Deno.test("Type alias: conditional type", () => {
  const result = hqlToTypeScript(`(deftype IsString<T> "T extends string ? true : false")`);
  assertStringIncludes(result, "type IsString<T> = T extends string ? true : false;");
});

Deno.test("Type alias: mapped type", () => {
  const result = hqlToTypeScript(`(deftype "Readonly<T>" "{ readonly [K in keyof T]: T[K] }")`);
  assertStringIncludes(result, "type Readonly<T> = { readonly [K in keyof T]: T[K] };");
});

Deno.test("Type alias: tuple type", () => {
  const result = hqlToTypeScript(`(deftype Point "[number, number]")`);
  assertStringIncludes(result, "type Point = [number, number];");
});

Deno.test("Type alias: named tuple", () => {
  const result = hqlToTypeScript(`(deftype NamedPoint "[x: number, y: number]")`);
  assertStringIncludes(result, "type NamedPoint = [x: number, y: number];");
});

Deno.test("Type alias: readonly array", () => {
  const result = hqlToTypeScript(`(deftype ImmutableList "readonly number[]")`);
  assertStringIncludes(result, "type ImmutableList = readonly number[];");
});

Deno.test("Type alias: template literal type", () => {
  const result = hqlToTypeScript("(deftype EventName \"`on${string}`\")");
  assertStringIncludes(result, "type EventName = `on${string}`;");
});

Deno.test("Type alias: infer keyword", () => {
  const result = hqlToTypeScript(`(deftype "UnpackPromise<T>" "T extends Promise<infer U> ? U : T")`);
  assertStringIncludes(result, "type UnpackPromise<T> = T extends Promise<infer U> ? U : T;");
});

// ============================================================================
// Abstract Classes
// ============================================================================

Deno.test("Abstract class: simple declaration", () => {
  const result = hqlToTypeScript(`
    (abstract-class Animal [
      (abstract-method speak [] :string)
    ])
  `);
  assertStringIncludes(result, "abstract class Animal");
  assertStringIncludes(result, "abstract speak(): string;");
});

Deno.test("Abstract class: with extends", () => {
  const result = hqlToTypeScript(`
    (abstract-class Mammal extends Animal [
      (abstract-method breathe [] :void)
    ])
  `);
  assertStringIncludes(result, "abstract class Mammal extends Animal");
  assertStringIncludes(result, "abstract breathe(): void;");
});

Deno.test("Abstract class: with generics", () => {
  const result = hqlToTypeScript(`
    (abstract-class Container<T> [
      (abstract-method getValue [] :T)
      (abstract-method setValue "value: T" :void)
    ])
  `);
  assertStringIncludes(result, "abstract class Container<T>");
  assertStringIncludes(result, "abstract getValue(): T;");
  assertStringIncludes(result, "abstract setValue(value: T): void;");
});

// ============================================================================
// Function Overloads
// ============================================================================

Deno.test("Function overload: single signature", () => {
  const result = hqlToTypeScript(`
    (fn-overload process "x: string" :string)
  `);
  assertStringIncludes(result, "function process(x: string): string;");
});

Deno.test("Function overload: multiple signatures", () => {
  const result = hqlToTypeScript(`
    (fn-overload process "x: string" :string)
    (fn-overload process "x: number" :number)
  `);
  assertStringIncludes(result, "function process(x: string): string;");
  assertStringIncludes(result, "function process(x: number): number;");
});

Deno.test("Function overload: with generics", () => {
  const result = hqlToTypeScript(`
    (fn-overload "identity<T>" "x: T" :T)
  `);
  assertStringIncludes(result, "function identity<T>(x: T): T;");
});

// ============================================================================
// Declare Statements (Ambient Declarations)
// ============================================================================

Deno.test("Declare: function", () => {
  const result = hqlToTypeScript(`(declare function "greet(name: string): string")`);
  assertStringIncludes(result, "declare function greet(name: string): string;");
});

Deno.test("Declare: var", () => {
  const result = hqlToTypeScript(`(declare var "globalCounter: number")`);
  assertStringIncludes(result, "declare var globalCounter: number;");
});

Deno.test("Declare: const", () => {
  const result = hqlToTypeScript(`(declare const "PI: 3.14159")`);
  assertStringIncludes(result, "declare const PI: 3.14159;");
});

Deno.test("Declare: module", () => {
  const result = hqlToTypeScript(`(declare module "my-module")`);
  assertStringIncludes(result, "declare module my-module;");
});

// ============================================================================
// Namespaces
// ============================================================================

Deno.test("Namespace: simple declaration", () => {
  const result = hqlToTypeScript(`
    (namespace Utils [
      (deftype ID "string")
    ])
  `);
  assertStringIncludes(result, "namespace Utils");
  assertStringIncludes(result, "type ID = string;");
});

Deno.test("Namespace: with interfaces", () => {
  const result = hqlToTypeScript(`
    (namespace Models [
      (interface User "{ id: string; name: string }")
    ])
  `);
  assertStringIncludes(result, "namespace Models");
  assertStringIncludes(result, "interface User");
});

// ============================================================================
// Const Enums
// ============================================================================

Deno.test("Const enum: simple declaration", () => {
  const result = hqlToTypeScript(`(const-enum Direction [North South East West])`);
  assertStringIncludes(result, "const enum Direction");
  assertStringIncludes(result, "North");
  assertStringIncludes(result, "South");
  assertStringIncludes(result, "East");
  assertStringIncludes(result, "West");
});

Deno.test("Const enum: with values", () => {
  const result = hqlToTypeScript(`(const-enum Status [(OK 200) (NotFound 404) (Error 500)])`);
  assertStringIncludes(result, "const enum Status");
  assertStringIncludes(result, "OK = 200");
  assertStringIncludes(result, "NotFound = 404");
  assertStringIncludes(result, "Error = 500");
});

Deno.test("Const enum: with string values", () => {
  const result = hqlToTypeScript(`(const-enum Color [(Red "red") (Green "green") (Blue "blue")])`);
  assertStringIncludes(result, "const enum Color");
  assertStringIncludes(result, 'Red = "red"');
  assertStringIncludes(result, 'Green = "green"');
  assertStringIncludes(result, 'Blue = "blue"');
});

// ============================================================================
// Interface with Advanced Features
// ============================================================================

Deno.test("Interface: readonly properties", () => {
  const result = hqlToTypeScript(`(interface Point "{ readonly x: number; readonly y: number }")`);
  assertStringIncludes(result, "interface Point { readonly x: number; readonly y: number }");
});

Deno.test("Interface: optional properties", () => {
  const result = hqlToTypeScript(`(interface Config "{ debug?: boolean; port?: number }")`);
  assertStringIncludes(result, "interface Config { debug?: boolean; port?: number }");
});

Deno.test("Interface: index signatures", () => {
  const result = hqlToTypeScript(`(interface StringMap "{ [key: string]: string }")`);
  assertStringIncludes(result, "interface StringMap { [key: string]: string }");
});

Deno.test("Interface: call signatures", () => {
  const result = hqlToTypeScript(`(interface Callable "{ (x: number): number }")`);
  assertStringIncludes(result, "interface Callable { (x: number): number }");
});

Deno.test("Interface: construct signatures", () => {
  const result = hqlToTypeScript(`(interface Constructor "{ new (name: string): Person }")`);
  assertStringIncludes(result, "interface Constructor { new (name: string): Person }");
});

// ============================================================================
// Type Guards (via type predicates in function return types)
// ============================================================================

Deno.test("Type alias: type predicate function type", () => {
  const result = hqlToTypeScript(`(deftype IsStringGuard "(x: unknown) => x is string")`);
  assertStringIncludes(result, "type IsStringGuard = (x: unknown) => x is string;");
});

Deno.test("Type alias: asserts type predicate", () => {
  const result = hqlToTypeScript(`(deftype AssertString "(x: unknown) => asserts x is string")`);
  assertStringIncludes(result, "type AssertString = (x: unknown) => asserts x is string;");
});

// ============================================================================
// Complex Type Expressions
// ============================================================================

Deno.test("Type alias: intersection types", () => {
  const result = hqlToTypeScript(`(deftype Combined "A & B & C")`);
  assertStringIncludes(result, "type Combined = A & B & C;");
});

Deno.test("Type alias: utility types", () => {
  const result = hqlToTypeScript(`(deftype PartialPerson "Partial<Person>")`);
  assertStringIncludes(result, "type PartialPerson = Partial<Person>;");
});

Deno.test("Type alias: Pick utility", () => {
  const result = hqlToTypeScript(`(deftype "PersonName" "Pick<Person, 'name' | 'firstName'>")`);
  assertStringIncludes(result, "type PersonName = Pick<Person, 'name' | 'firstName'>;");
});

Deno.test("Type alias: Omit utility", () => {
  const result = hqlToTypeScript(`(deftype PersonWithoutId "Omit<Person, 'id'>")`);
  assertStringIncludes(result, "type PersonWithoutId = Omit<Person, 'id'>;");
});

Deno.test("Type alias: Record utility", () => {
  const result = hqlToTypeScript(`(deftype StringRecord "Record<string, number>")`);
  assertStringIncludes(result, "type StringRecord = Record<string, number>;");
});

Deno.test("Type alias: Exclude utility", () => {
  const result = hqlToTypeScript(`(deftype NonNull "Exclude<T, null | undefined>")`);
  assertStringIncludes(result, "type NonNull = Exclude<T, null | undefined>;");
});

Deno.test("Type alias: Extract utility", () => {
  const result = hqlToTypeScript(`(deftype OnlyStrings "Extract<T, string>")`);
  assertStringIncludes(result, "type OnlyStrings = Extract<T, string>;");
});

Deno.test("Type alias: ReturnType utility", () => {
  const result = hqlToTypeScript(`(deftype FnReturn "ReturnType<typeof myFunction>")`);
  assertStringIncludes(result, "type FnReturn = ReturnType<typeof myFunction>;");
});

Deno.test("Type alias: Parameters utility", () => {
  const result = hqlToTypeScript(`(deftype FnParams "Parameters<typeof myFunction>")`);
  assertStringIncludes(result, "type FnParams = Parameters<typeof myFunction>;");
});

// ============================================================================
// Edge cases
// ============================================================================

Deno.test("Type alias: never type", () => {
  const result = hqlToTypeScript(`(deftype Empty "never")`);
  assertStringIncludes(result, "type Empty = never;");
});

Deno.test("Type alias: unknown type", () => {
  const result = hqlToTypeScript(`(deftype Anything "unknown")`);
  assertStringIncludes(result, "type Anything = unknown;");
});

Deno.test("Type alias: void type", () => {
  const result = hqlToTypeScript(`(deftype NoReturn "void")`);
  assertStringIncludes(result, "type NoReturn = void;");
});
