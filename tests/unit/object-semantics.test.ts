// test/object-semantics.test.ts
// Tests to verify HQL object null prototype semantics are preserved

import { assertEquals } from "jsr:@std/assert@1";
import hql from "../../mod.ts";

Deno.test("Object semantics: Objects have null prototype", async () => {
  const code = `{x: 1 y: 2}`;
  const result = await hql.run(code);

  // Verify null prototype
  assertEquals(Object.getPrototypeOf(result), null);
});

Deno.test("Object semantics: No inherited properties", async () => {
  const code = `{name: "test"}`;
  const result = await hql.run(code) as any;

  // Should not have Object.prototype methods
  assertEquals('toString' in result, false);
  assertEquals('hasOwnProperty' in result, false);
  assertEquals('constructor' in result, false);
});

Deno.test("Object semantics: for...in only shows own properties", async () => {
  const code = `{a: 1 b: 2}`;
  const result = await hql.run(code) as any;

  const keys: string[] = [];
  for (const key in result) {
    keys.push(key);
  }

  // Should only show own properties, not prototype properties
  assertEquals(keys.sort(), ['a', 'b']);
  assertEquals(keys.length, 2);
});

Deno.test("Object semantics: Nested objects also have null prototype", async () => {
  const code = `{x: 1 y: {z: 3}}`;
  const result = await hql.run(code) as any;

  // Both outer and inner objects should have null prototype
  assertEquals(Object.getPrototypeOf(result), null);
  assertEquals(Object.getPrototypeOf(result.y), null);
});

Deno.test("Object semantics: Empty object has null prototype", async () => {
  const code = `{}`;
  const result = await hql.run(code);

  assertEquals(Object.getPrototypeOf(result), null);
});

Deno.test("Object semantics: Objects in arrays have null prototype", async () => {
  const code = `[{x: 1} {y: 2}]`;
  const result = await hql.run(code) as any[];

  assertEquals(Object.getPrototypeOf(result[0]), null);
  assertEquals(Object.getPrototypeOf(result[1]), null);
});

Deno.test("Object semantics: Object can have property named 'toString'", async () => {
  const code = `{toString: "my-value"}`;
  const result = await hql.run(code) as any;

  // Should be the string value, not the function
  assertEquals(result.toString, "my-value");
  assertEquals(typeof result.toString, "string");
});

Deno.test("Object semantics: Object can have property named 'constructor'", async () => {
  const code = `{constructor: 42}`;
  const result = await hql.run(code) as any;

  // Should be the number, not the constructor function
  assertEquals(result.constructor, 42);
  assertEquals(typeof result.constructor, "number");
});
