// tests/unit/effects/effect-receiver.test.ts
// Unit tests for parseValueKind and inferNodeKind

import { assertEquals } from "jsr:@std/assert@1";
import { parseValueKind, inferNodeKind } from "../../../src/hql/transpiler/pipeline/effects/effect-receiver.ts";
import { IRNodeType } from "../../../src/hql/transpiler/type/hql_ir.ts";
import type { IRArrayExpression, IRStringLiteral, IRNumericLiteral, IRBooleanLiteral, IRNewExpression, IRIdentifier, IRCallExpression } from "../../../src/hql/transpiler/type/hql_ir.ts";

// ============================================================================
// parseValueKind
// ============================================================================

Deno.test("parseValueKind: undefined → Untyped", () => {
  assertEquals(parseValueKind(undefined), "Untyped");
});

Deno.test("parseValueKind: empty string → Untyped", () => {
  assertEquals(parseValueKind(""), "Untyped");
});

Deno.test("parseValueKind: 'Array' → Array", () => {
  assertEquals(parseValueKind("Array"), "Array");
});

Deno.test("parseValueKind: 'Array<number>' → Array", () => {
  assertEquals(parseValueKind("Array<number>"), "Array");
});

Deno.test("parseValueKind: 'number[]' → Array", () => {
  assertEquals(parseValueKind("number[]"), "Array");
});

Deno.test("parseValueKind: 'string' → String", () => {
  assertEquals(parseValueKind("string"), "String");
});

Deno.test("parseValueKind: 'Map<K,V>' → Map", () => {
  assertEquals(parseValueKind("Map<K,V>"), "Map");
});

Deno.test("parseValueKind: 'Set<number>' → Set", () => {
  assertEquals(parseValueKind("Set<number>"), "Set");
});

Deno.test("parseValueKind: 'number' → Number", () => {
  assertEquals(parseValueKind("number"), "Number");
});

Deno.test("parseValueKind: 'boolean' → Boolean", () => {
  assertEquals(parseValueKind("boolean"), "Boolean");
});

Deno.test("parseValueKind: 'RegExp' → RegExp", () => {
  assertEquals(parseValueKind("RegExp"), "RegExp");
});

Deno.test("parseValueKind: 'Promise<number>' → Promise", () => {
  assertEquals(parseValueKind("Promise<number>"), "Promise");
});

Deno.test("parseValueKind: '(Pure number number)' → Untyped (function type)", () => {
  assertEquals(parseValueKind("(Pure number number)"), "Untyped");
});

Deno.test("parseValueKind: 'T' (generic param) → Untyped", () => {
  assertEquals(parseValueKind("T"), "Untyped");
});

Deno.test("parseValueKind: 'DatabaseConnection' → Unknown", () => {
  assertEquals(parseValueKind("DatabaseConnection"), "Unknown");
});

Deno.test("parseValueKind: arrow function type → Untyped", () => {
  assertEquals(parseValueKind("(x: number) => string"), "Untyped");
});

// ============================================================================
// inferNodeKind
// ============================================================================

Deno.test("inferNodeKind: ArrayExpression → Array", () => {
  const node: IRArrayExpression = { type: IRNodeType.ArrayExpression, elements: [] };
  assertEquals(inferNodeKind(node), "Array");
});

Deno.test("inferNodeKind: StringLiteral → String", () => {
  const node: IRStringLiteral = { type: IRNodeType.StringLiteral, value: "hello" };
  assertEquals(inferNodeKind(node), "String");
});

Deno.test("inferNodeKind: NumericLiteral → Number", () => {
  const node: IRNumericLiteral = { type: IRNodeType.NumericLiteral, value: 42 };
  assertEquals(inferNodeKind(node), "Number");
});

Deno.test("inferNodeKind: BooleanLiteral → Boolean", () => {
  const node: IRBooleanLiteral = { type: IRNodeType.BooleanLiteral, value: true };
  assertEquals(inferNodeKind(node), "Boolean");
});

Deno.test("inferNodeKind: NewExpression with Map → Map", () => {
  const node: IRNewExpression = {
    type: IRNodeType.NewExpression,
    callee: { type: IRNodeType.Identifier, name: "Map" } as IRIdentifier,
    arguments: [],
  };
  assertEquals(inferNodeKind(node), "Map");
});

Deno.test("inferNodeKind: NewExpression with unknown ctor → Untyped", () => {
  const node: IRNewExpression = {
    type: IRNodeType.NewExpression,
    callee: { type: IRNodeType.Identifier, name: "CustomThing" } as IRIdentifier,
    arguments: [],
  };
  assertEquals(inferNodeKind(node), "Untyped");
});

Deno.test("inferNodeKind: CallExpression → Untyped (can't infer return type)", () => {
  const node: IRCallExpression = {
    type: IRNodeType.CallExpression,
    callee: { type: IRNodeType.Identifier, name: "foo" } as IRIdentifier,
    arguments: [],
  };
  assertEquals(inferNodeKind(node), "Untyped");
});
