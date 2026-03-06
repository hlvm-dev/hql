import { assertEquals } from "jsr:@std/assert@1";
import { inferNodeKind, parseValueKind } from "../../../src/hql/transpiler/pipeline/effects/effect-receiver.ts";
import { IRNodeType } from "../../../src/hql/transpiler/type/hql_ir.ts";
import type {
  IRArrayExpression,
  IRBooleanLiteral,
  IRCallExpression,
  IRIdentifier,
  IRNewExpression,
  IRNumericLiteral,
  IRStringLiteral,
} from "../../../src/hql/transpiler/type/hql_ir.ts";

Deno.test("EffectReceiver: parseValueKind recognizes built-in receiver families", () => {
  assertEquals(parseValueKind("Array<number>"), "Array");
  assertEquals(parseValueKind("number[]"), "Array");
  assertEquals(parseValueKind("string"), "String");
  assertEquals(parseValueKind("Map<K,V>"), "Map");
  assertEquals(parseValueKind("Set<number>"), "Set");
  assertEquals(parseValueKind("number"), "Number");
  assertEquals(parseValueKind("boolean"), "Boolean");
  assertEquals(parseValueKind("RegExp"), "RegExp");
  assertEquals(parseValueKind("Promise<number>"), "Promise");
});

Deno.test("EffectReceiver: parseValueKind treats empty, function, and generic annotations as untyped", () => {
  assertEquals(parseValueKind(undefined), "Untyped");
  assertEquals(parseValueKind(""), "Untyped");
  assertEquals(parseValueKind("(Pure number number)"), "Untyped");
  assertEquals(parseValueKind("(x: number) => string"), "Untyped");
  assertEquals(parseValueKind("T"), "Untyped");
});

Deno.test("EffectReceiver: parseValueKind fails closed for unknown user-defined types", () => {
  assertEquals(parseValueKind("DatabaseConnection"), "Unknown");
});

Deno.test("EffectReceiver: inferNodeKind recognizes literal and constructor-backed receiver kinds", () => {
  const arrayNode: IRArrayExpression = { type: IRNodeType.ArrayExpression, elements: [] };
  const stringNode: IRStringLiteral = { type: IRNodeType.StringLiteral, value: "hello" };
  const numberNode: IRNumericLiteral = { type: IRNodeType.NumericLiteral, value: 42 };
  const booleanNode: IRBooleanLiteral = { type: IRNodeType.BooleanLiteral, value: true };
  const mapNode: IRNewExpression = {
    type: IRNodeType.NewExpression,
    callee: { type: IRNodeType.Identifier, name: "Map" } as IRIdentifier,
    arguments: [],
  };

  assertEquals(inferNodeKind(arrayNode), "Array");
  assertEquals(inferNodeKind(stringNode), "String");
  assertEquals(inferNodeKind(numberNode), "Number");
  assertEquals(inferNodeKind(booleanNode), "Boolean");
  assertEquals(inferNodeKind(mapNode), "Map");
});

Deno.test("EffectReceiver: inferNodeKind leaves unknown constructors and call results untyped", () => {
  const customCtor: IRNewExpression = {
    type: IRNodeType.NewExpression,
    callee: { type: IRNodeType.Identifier, name: "CustomThing" } as IRIdentifier,
    arguments: [],
  };
  const callNode: IRCallExpression = {
    type: IRNodeType.CallExpression,
    callee: { type: IRNodeType.Identifier, name: "foo" } as IRIdentifier,
    arguments: [],
  };

  assertEquals(inferNodeKind(customCtor), "Untyped");
  assertEquals(inferNodeKind(callNode), "Untyped");
});
