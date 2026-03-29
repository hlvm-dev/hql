import { assertEquals } from "jsr:@std/assert";
import { buildToolJsonSchema } from "../../../src/hlvm/agent/tool-schema.ts";
import type { ToolMetadata } from "../../../src/hlvm/agent/registry.ts";

Deno.test("tool schema: any[] args emit an explicit empty items schema", () => {
  const schema = buildToolJsonSchema({
    fn: () => Promise.resolve(null),
    description: "Test tool",
    args: {
      values: "any[] - Arbitrary values",
      label: "string - Label",
    },
  } satisfies ToolMetadata);

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
