import { assertEquals } from "jsr:@std/assert@1";
import { descriptorToJsonSchema } from "../../../src/hlvm/api/schema-to-json-schema.ts";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Primitive descriptors
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test('"string" → {type: "string"}', () => {
  assertEquals(descriptorToJsonSchema("string"), { type: "string" });
});

Deno.test('"number" → {type: "number"}', () => {
  assertEquals(descriptorToJsonSchema("number"), { type: "number" });
});

Deno.test('"number 1-10" strips hint suffix', () => {
  assertEquals(descriptorToJsonSchema("number 1-10"), { type: "number" });
});

Deno.test('"number grams" strips unit hint', () => {
  assertEquals(descriptorToJsonSchema("number grams"), { type: "number" });
});

Deno.test('"boolean" → {type: "boolean"}', () => {
  assertEquals(descriptorToJsonSchema("boolean"), { type: "boolean" });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Enum descriptor
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test('"a|b|c" → {type: "string", enum: [...]}', () => {
  assertEquals(descriptorToJsonSchema("positive|negative|neutral"), {
    type: "string",
    enum: ["positive", "negative", "neutral"],
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Array descriptors
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test('["string"] → {type: "array", items: {type: "string"}}', () => {
  assertEquals(descriptorToJsonSchema(["string"]), {
    type: "array",
    items: { type: "string" },
  });
});

Deno.test("[{...}] → array of objects", () => {
  assertEquals(descriptorToJsonSchema([{ name: "string", qty: "number" }]), {
    type: "array",
    items: {
      type: "object",
      properties: { name: { type: "string" }, qty: { type: "number" } },
      required: ["name", "qty"],
      additionalProperties: false,
    },
  });
});

Deno.test("[] → {type: array} (no items)", () => {
  assertEquals(descriptorToJsonSchema([]), { type: "array" });
});

Deno.test('"array of strings, exactly 3 items" → array schema with bounds', () => {
  assertEquals(descriptorToJsonSchema("array of strings, exactly 3 items"), {
    type: "array",
    items: { type: "string" },
    minItems: 3,
    maxItems: 3,
  });
});

Deno.test('"array of 3 strings" → array schema with bounds', () => {
  assertEquals(descriptorToJsonSchema("array of 3 strings"), {
    type: "array",
    items: { type: "string" },
    minItems: 3,
    maxItems: 3,
  });
});

Deno.test('"array of objects with fields: ..." → array of inline object schema', () => {
  assertEquals(
    descriptorToJsonSchema(
      "array of objects with fields: text (string), sentiment (positive|negative|neutral)",
    ),
    {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          sentiment: {
            type: "string",
            enum: ["positive", "negative", "neutral"],
          },
        },
        required: ["text", "sentiment"],
        additionalProperties: false,
      },
    },
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Object descriptors
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("nested objects", () => {
  assertEquals(
    descriptorToJsonSchema({
      city: "string",
      coords: { lat: "number", lng: "number" },
    }),
    {
      type: "object",
      properties: {
        city: { type: "string" },
        coords: {
          type: "object",
          properties: { lat: { type: "number" }, lng: { type: "number" } },
          required: ["lat", "lng"],
          additionalProperties: false,
        },
      },
      required: ["city", "coords"],
      additionalProperties: false,
    },
  );
});

Deno.test("empty object → {type: object, properties: {}, required: []}", () => {
  assertEquals(descriptorToJsonSchema({}), {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Complex real-world schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("complex schema (RPG character)", () => {
  const result = descriptorToJsonSchema({
    name: "string",
    race: "human|elf|dwarf",
    level: "number 1-100",
    stats: { str: "number", int: "number" },
    inventory: [{ item: "string", equipped: "boolean" }],
  });
  assertEquals(result.type, "object");
  const props = result.properties as Record<string, Record<string, unknown>>;
  assertEquals(props.name, { type: "string" });
  assertEquals(props.race, { type: "string", enum: ["human", "elf", "dwarf"] });
  assertEquals(props.level, { type: "number" });
  assertEquals((props.stats as Record<string, unknown>).type, "object");
  assertEquals((props.inventory as Record<string, unknown>).type, "array");
});

Deno.test("passes through direct JSON Schema object roots unchanged", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      sentiment: {
        type: "string",
        enum: ["positive", "negative", "neutral"],
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
    },
    required: ["sentiment", "confidence"],
  };

  assertEquals(descriptorToJsonSchema(schema), schema);
});
