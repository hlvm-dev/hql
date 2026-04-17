import { assertEquals } from "jsr:@std/assert";
import { validateValue } from "../../../src/common/config/types.ts";

Deno.test("config validation accepts auto as a model value", () => {
  assertEquals(validateValue("model", "auto"), { valid: true });
});
