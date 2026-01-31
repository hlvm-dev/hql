import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { selectHqlForm, splitTopLevelHqlForms } from "../../src/common/hql-selection.ts";

Deno.test("selectHqlForm returns full range including closing paren", () => {
  const code = "(+ 1 2)";
  const range = selectHqlForm(code, 0);
  assertEquals(range, { start: 0, end: 7 });
});

Deno.test("selectHqlForm returns top-level form containing cursor", () => {
  const code = "(+ 1 2)\n(* 2 3)";
  const range = selectHqlForm(code, 10);
  assertEquals(range, { start: 8, end: 15 });
});

Deno.test("splitTopLevelHqlForms returns ranges for each form", () => {
  const code = "(+ 1 2)\n(* 2 3)\n(inc 1)";
  const ranges = splitTopLevelHqlForms(code);
  assertEquals(ranges, [
    { start: 0, end: 7 },
    { start: 8, end: 15 },
    { start: 16, end: 23 },
  ]);
});
