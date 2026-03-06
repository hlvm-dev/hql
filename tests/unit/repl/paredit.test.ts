import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  barfBackward,
  barfForward,
  killSexp,
  raiseSexp,
  slurpBackward,
  slurpForward,
  spliceSexp,
  transposeSexp,
  wrapSexp,
} from "../../../src/hlvm/cli/repl/paredit.ts";

function expectEdit(
  result: { newValue: string; newCursor: number } | null,
  newValue: string,
  newCursor?: number,
) {
  assertExists(result);
  assertEquals(result.newValue, newValue);
  if (newCursor !== undefined) {
    assertEquals(result.newCursor, newCursor);
  }
}

Deno.test("slurpForward pulls the next sexp into the enclosing list", () => {
  expectEdit(slurpForward("(foo) bar", 3), "(foo bar)", 3);
});

Deno.test("slurpBackward pulls the previous sexp into the enclosing list", () => {
  expectEdit(slurpBackward("foo (bar)", 9), "(foo bar)", 6);
});

Deno.test("barfForward ejects the trailing sexp from the enclosing list", () => {
  expectEdit(barfForward("(foo (bar))", 2), "(foo) (bar)");
});

Deno.test("barfBackward ejects the leading sexp from the enclosing list", () => {
  expectEdit(barfBackward("((foo) bar)", 11), "(foo) (bar)");
});

Deno.test("wrapSexp wraps the current sexp with the requested delimiter", () => {
  expectEdit(wrapSexp("foo bar", 4, "["), "foo [bar]", 5);
});

Deno.test("spliceSexp removes the enclosing list while preserving siblings", () => {
  expectEdit(spliceSexp("(a (b c) d)", 8), "(a b c d)", 7);
});

Deno.test("raiseSexp replaces the parent sexp with the current element", () => {
  expectEdit(raiseSexp("(foo (bar) baz)", 5), "(bar)", 0);
});

Deno.test("killSexp deletes the current sexp and normalizes whitespace", () => {
  expectEdit(killSexp("foo (bar) baz", 4), "foo baz", 4);
});

Deno.test("transposeSexp swaps adjacent sexps regardless of shape", () => {
  expectEdit(transposeSexp("foo (bar)", 4), "(bar) foo", 9);
});

Deno.test("operations return null when the edit is structurally inapplicable", () => {
  const cases = [
    ["slurpForward", slurpForward("(foo)", 3)],
    ["slurpBackward", slurpBackward("(foo) bar", 2)],
    ["barfForward", barfForward("(foo)", 2)],
    ["barfBackward", barfBackward("(foo)", 2)],
    ["spliceSexp", spliceSexp("foo bar", 2)],
    ["raiseSexp", raiseSexp("foo bar", 2)],
    ["transposeSexp", transposeSexp("foo bar", 0)],
  ] as const;

  for (const [name, result] of cases) {
    assertEquals(result, null, name);
  }
});

Deno.test("operations return null when no sexp exists at the cursor", () => {
  const cases = [
    ["slurpForward empty", slurpForward("", 0)],
    ["slurpBackward empty", slurpBackward("", 0)],
    ["barfForward empty", barfForward("", 0)],
    ["barfBackward empty", barfBackward("", 0)],
    ["wrapSexp empty", wrapSexp("", 0)],
    ["spliceSexp empty", spliceSexp("", 0)],
    ["raiseSexp empty", raiseSexp("", 0)],
    ["killSexp empty", killSexp("", 0)],
    ["transposeSexp empty", transposeSexp("", 0)],
    ["slurpForward whitespace", slurpForward("   ", 1)],
    ["wrapSexp whitespace", wrapSexp("   ", 1)],
    ["killSexp whitespace", killSexp("   ", 1)],
  ] as const;

  for (const [name, result] of cases) {
    assertEquals(result, null, name);
  }
});
