import { assertEquals } from "jsr:@std/assert@1";
import { schemaToZod } from "../../../src/hlvm/api/schema-to-zod.ts";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Primitive descriptors
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test('schemaToZod: "string" → z.string()', () => {
  const schema = schemaToZod({ name: "string" });
  const result = schema.parse({ name: "hello" });
  assertEquals(result, { name: "hello" });
});

Deno.test('schemaToZod: "number" → z.number()', () => {
  const schema = schemaToZod({ age: "number" });
  const result = schema.parse({ age: 42 });
  assertEquals(result, { age: 42 });
});

Deno.test('schemaToZod: "number 1-10" strips hint suffix', () => {
  const schema = schemaToZod({ rating: "number 1-10" });
  const result = schema.parse({ rating: 7 });
  assertEquals(result, { rating: 7 });
});

Deno.test('schemaToZod: "number grams" strips unit hint', () => {
  const schema = schemaToZod({ weight: "number grams" });
  const result = schema.parse({ weight: 0.5 });
  assertEquals(result, { weight: 0.5 });
});

Deno.test('schemaToZod: "boolean" → z.boolean()', () => {
  const schema = schemaToZod({ active: "boolean" });
  const result = schema.parse({ active: true });
  assertEquals(result, { active: true });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Enum descriptor
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test('schemaToZod: "a|b|c" → z.enum(["a","b","c"])', () => {
  const schema = schemaToZod({ sentiment: "positive|negative|neutral" });
  const result = schema.parse({ sentiment: "positive" });
  assertEquals(result, { sentiment: "positive" });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Array descriptors
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test('schemaToZod: ["string"] → z.array(z.string())', () => {
  const schema = schemaToZod({ tags: ["string"] });
  const result = schema.parse({ tags: ["a", "b"] });
  assertEquals(result, { tags: ["a", "b"] });
});

Deno.test("schemaToZod: [{...}] → z.array(z.object(...))", () => {
  const schema = schemaToZod({
    items: [{ name: "string", qty: "number" }],
  });
  const result = schema.parse({
    items: [
      { name: "apple", qty: 3 },
      { name: "banana", qty: 5 },
    ],
  });
  assertEquals(result, {
    items: [
      { name: "apple", qty: 3 },
      { name: "banana", qty: 5 },
    ],
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Nested objects
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("schemaToZod: nested objects (recursive)", () => {
  const schema = schemaToZod({
    city: "string",
    coordinates: { lat: "number", lng: "number" },
  });
  const result = schema.parse({
    city: "Tokyo",
    coordinates: { lat: 35.6, lng: 139.6 },
  });
  assertEquals(result, {
    city: "Tokyo",
    coordinates: { lat: 35.6, lng: 139.6 },
  });
});

Deno.test("schemaToZod: deeply nested structure", () => {
  const schema = schemaToZod({
    company: "string",
    ceo: {
      name: "string",
      departments: [{
        name: "string",
        employees: [{ name: "string", role: "string" }],
      }],
    },
  });
  const result = schema.parse({
    company: "Acme",
    ceo: {
      name: "Alice",
      departments: [{
        name: "Eng",
        employees: [{ name: "Bob", role: "Dev" }],
      }],
    },
  });
  assertEquals(result.company, "Acme");
  assertEquals(result.ceo.name, "Alice");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Edge cases
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("schemaToZod: empty object", () => {
  const schema = schemaToZod({});
  const result = schema.parse({});
  assertEquals(result, {});
});

Deno.test("schemaToZod: single field object", () => {
  const schema = schemaToZod({ x: "number" });
  const result = schema.parse({ x: 42 });
  assertEquals(result, { x: 42 });
});

Deno.test("schemaToZod: complex real-world schema (RPG character)", () => {
  const schema = schemaToZod({
    name: "string",
    race: "human|elf|dwarf|orc",
    level: "number 1-100",
    stats: {
      strength: "number 1-20",
      intelligence: "number 1-20",
    },
    inventory: [{ item: "string", isEquipped: "boolean" }],
  });
  const result = schema.parse({
    name: "Kael",
    race: "elf",
    level: 18,
    stats: { strength: 14, intelligence: 16 },
    inventory: [{ item: "Dagger", isEquipped: true }],
  });
  assertEquals(result.name, "Kael");
  assertEquals(result.race, "elf");
  assertEquals(result.level, 18);
  assertEquals(result.stats.strength, 14);
  assertEquals(result.inventory[0].isEquipped, true);
});
