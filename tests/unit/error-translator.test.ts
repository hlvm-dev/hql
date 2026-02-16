import { assertEquals } from "jsr:@std/assert";
import { translateTypeError } from "../../src/hql/transpiler/pipeline/error-translator.ts";

Deno.test("error-translator", async (t) => {
  await t.step("TS2322 - type not assignable", () => {
    assertEquals(
      translateTypeError(2322, "Type 'string' is not assignable to type 'number'"),
      "Cannot use string where number is expected",
    );
  });

  await t.step("TS2304 - cannot find name", () => {
    assertEquals(
      translateTypeError(2304, "Cannot find name 'foo'"),
      "Undefined binding: foo",
    );
  });

  await t.step("TS2345 - argument type mismatch", () => {
    assertEquals(
      translateTypeError(2345, "Argument of type 'string' is not assignable to parameter of type 'number'"),
      "Expected number but got string",
    );
  });

  await t.step("TS2554 - wrong argument count", () => {
    assertEquals(
      translateTypeError(2554, "Expected 2 arguments, but got 3"),
      "Function expected 2 argument(s), got 3",
    );
  });

  await t.step("TS2339 - property does not exist", () => {
    assertEquals(
      translateTypeError(2339, "Property 'foo' does not exist on type 'Bar'"),
      "Property 'foo' does not exist on type 'Bar'",
    );
  });

  await t.step("TS2769 - no overload matches", () => {
    assertEquals(
      translateTypeError(2769, "No overload matches this call"),
      "No matching overload for call",
    );
  });

  await t.step("unknown code passes through", () => {
    assertEquals(
      translateTypeError(9999, "Some unknown error"),
      "Some unknown error",
    );
  });

  await t.step("known code with non-matching message passes through", () => {
    assertEquals(
      translateTypeError(2322, "Some unusual format"),
      "Some unusual format",
    );
  });

  await t.step("TS2551 - did you mean", () => {
    assertEquals(
      translateTypeError(2551, "Property 'naem' does not exist on type 'X'. Did you mean 'name'?"),
      "Did you mean 'name'?",
    );
  });

  await t.step("TS2365 - operator cannot be applied", () => {
    assertEquals(
      translateTypeError(2365, "Operator '+' cannot be applied to types 'string' and 'boolean'"),
      "Operator '+' cannot be applied to types 'string' and 'boolean'",
    );
  });

  await t.step("TS1005 - expected token", () => {
    assertEquals(
      translateTypeError(1005, "';' expected"),
      "Expected ';'",
    );
  });

  await t.step("TS2741 - property is missing", () => {
    assertEquals(
      translateTypeError(2741, "Property 'name' is missing in type 'Foo' but required in type 'Bar'"),
      "Property 'name' is missing",
    );
  });
});
