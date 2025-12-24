// Tests for TypeScript type declarations (type aliases and interfaces)
// Note: Type declarations are erased when compiling to JS, so we test the TS output
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

// Type Alias Tests
Deno.test("Type alias: simple type", () => {
  const result = hqlToTypeScript(`(deftype MyString "string")`);
  assertStringIncludes(result, "type MyString = string;");
});

Deno.test("Type alias: union type", () => {
  const result = hqlToTypeScript(`(deftype StringOrNumber "string | number")`);
  assertStringIncludes(result, "type StringOrNumber = string | number;");
});

Deno.test("Type alias: object type", () => {
  const result = hqlToTypeScript(`(deftype User "{ name: string; age: number }")`);
  assertStringIncludes(result, "type User = { name: string; age: number };");
});

Deno.test("Type alias: with generic parameter", () => {
  const result = hqlToTypeScript(`(deftype Container<T> "{ value: T }")`);
  assertStringIncludes(result, "type Container<T> = { value: T };");
});

Deno.test("Type alias: with multiple generic parameters", () => {
  // Use space-separated generics since comma is a token separator in HQL
  const result = hqlToTypeScript(`(deftype "Pair<A, B>" "{ first: A; second: B }")`);
  assertStringIncludes(result, "type Pair<A, B> = { first: A; second: B };");
});

Deno.test("Type alias: array type", () => {
  const result = hqlToTypeScript(`(deftype NumberArray "number[]")`);
  assertStringIncludes(result, "type NumberArray = number[];");
});

Deno.test("Type alias: function type", () => {
  const result = hqlToTypeScript(`(deftype Callback "(x: number) => void")`);
  assertStringIncludes(result, "type Callback = (x: number) => void;");
});

// Interface Tests
Deno.test("Interface: simple interface", () => {
  const result = hqlToTypeScript(`(interface Person "{ name: string; age: number }")`);
  assertStringIncludes(result, "interface Person { name: string; age: number }");
});

Deno.test("Interface: with methods", () => {
  const result = hqlToTypeScript(`(interface Greeter "{ greet(): string; sayHello(name: string): void }")`);
  assertStringIncludes(result, "interface Greeter { greet(): string; sayHello(name: string): void }");
});

Deno.test("Interface: with generic parameter", () => {
  const result = hqlToTypeScript(`(interface Box<T> "{ value: T; getValue(): T }")`);
  assertStringIncludes(result, "interface Box<T> { value: T; getValue(): T }");
});

Deno.test("Interface: with extends", () => {
  const result = hqlToTypeScript(`(interface Employee extends Person "{ salary: number }")`);
  assertStringIncludes(result, "interface Employee extends Person { salary: number }");
});

Deno.test("Interface: with multiple extends", () => {
  const result = hqlToTypeScript(`(interface Manager extends Person Serializable "{ department: string }")`);
  assertStringIncludes(result, "interface Manager extends Person, Serializable { department: string }");
});

Deno.test("Interface: generic with extends", () => {
  const result = hqlToTypeScript(`(interface Repository<T> extends BaseRepository "{ find(id: string): T }")`);
  assertStringIncludes(result, "interface Repository<T> extends BaseRepository { find(id: string): T }");
});

Deno.test("Interface: optional properties", () => {
  const result = hqlToTypeScript(`(interface Config "{ debug?: boolean; timeout?: number }")`);
  assertStringIncludes(result, "interface Config { debug?: boolean; timeout?: number }");
});

Deno.test("Interface: readonly properties", () => {
  const result = hqlToTypeScript(`(interface Point "{ readonly x: number; readonly y: number }")`);
  assertStringIncludes(result, "interface Point { readonly x: number; readonly y: number }");
});
