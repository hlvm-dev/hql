import { assertEquals } from "jsr:@std/assert";
import {
  buildToolJsonSchema,
  validateArgsAgainstSchema,
} from "../../../src/hlvm/agent/tool-schema.ts";
import type { ToolMetadata } from "../../../src/hlvm/agent/registry.ts";

Deno.test("tool schema: any[] args emit an explicit empty items schema", () => {
  const schema = buildToolJsonSchema(
    {
      fn: () => Promise.resolve(null),
      description: "Test tool",
      args: {
        values: "any[] - Arbitrary values",
        label: "string - Label",
      },
    } satisfies ToolMetadata,
  );

  assertEquals(schema.properties.values, {
    type: "array",
    description: "any[] - Arbitrary values",
    items: {},
  });
  assertEquals(schema.properties.label, {
    type: "string",
    description: "string - Label",
  });
});

Deno.test("tool schema: Array<object> args emit array-of-object schema", () => {
  const schema = buildToolJsonSchema(
    {
      fn: () => Promise.resolve(null),
      description: "Test tool",
      args: {
        steps: "Array<object> - Ordered plan steps",
        name: "string - Plan name",
      },
    } satisfies ToolMetadata,
  );

  assertEquals(schema.properties.steps, {
    type: "array",
    description: "Array<object> - Ordered plan steps",
    items: { type: "object" },
  });
  assertEquals(schema.properties.name, {
    type: "string",
    description: "string - Plan name",
  });
});

Deno.test("tool schema: native inputSchema takes precedence over string args", () => {
  const schema = buildToolJsonSchema(
    {
      fn: () => Promise.resolve(null),
      description: "Test tool",
      args: {
        mode: "string - Legacy fallback description",
      },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: {
            type: "string",
            enum: ["read", "write"],
            description: "Execution mode",
          },
          count: {
            type: "integer",
            minimum: 1,
            maximum: 5,
          },
        },
        required: ["mode", "count"],
      },
    } satisfies ToolMetadata,
  );

  assertEquals(schema, {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: {
        type: "string",
        enum: ["read", "write"],
        description: "Execution mode",
      },
      count: {
        type: "integer",
        minimum: 1,
        maximum: 5,
      },
    },
    required: ["mode", "count"],
  });
});

Deno.test("tool schema: native inputSchema validation keeps enum and numeric bounds", () => {
  const schema = buildToolJsonSchema(
    {
      fn: () => Promise.resolve(null),
      description: "Test tool",
      args: {},
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: {
            type: "string",
            enum: ["read", "write"],
          },
          count: {
            type: "integer",
            minimum: 1,
            maximum: 5,
          },
        },
        required: ["mode", "count"],
      },
    } satisfies ToolMetadata,
  );

  assertEquals(
    validateArgsAgainstSchema({ mode: "read", count: 3 }, schema),
    [],
  );
  assertEquals(
    validateArgsAgainstSchema({ mode: "delete", count: 3 }, schema).length,
    1,
  );
  assertEquals(
    validateArgsAgainstSchema({ mode: "read", count: 9 }, schema).length,
    1,
  );
});
