import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  findSymbolByName,
  formatSExpValue,
  run,
  withTempDir,
} from "../../../helpers.ts";
import { getMeta, type SExp } from "../../../../../src/hql/s-exp/types.ts";
import { getPlatform } from "../../../../../src/platform/platform.ts";

const path = () => getPlatform().path;

Deno.test("macro syntax: quote returns runtime S-expression values", async () => {
  await withTempDir(async (dir) => {
    const result = await run(`
      [(quote x) (quote null) (quote ()) (quote (a (b c) d))]
    `, {
      baseDir: dir,
      currentFile: path().join(dir, "quote-runtime.hql"),
    }) as SExp[];

    assertEquals(result[0].type, "symbol");
    assertEquals((result[0] as { name?: string }).name, "x");
    assertEquals(result[1].type, "symbol");
    assertEquals((result[1] as { name?: string }).name, "null");
    assertEquals(formatSExpValue(result[2]), "()");
    assertEquals(formatSExpValue(result[3]), "(a (b c) d)");
  });
});

Deno.test("macro syntax: quasiquote interpolates into raw runtime S-expressions", async () => {
  await withTempDir(async (dir) => {
    const result = await run(`
      (var x 10)
      (var nums [1 2 3])
      (quasiquote (a (unquote x) (unquote-splicing nums) z))
    `, {
      baseDir: dir,
      currentFile: path().join(dir, "quasiquote-runtime.hql"),
    }) as SExp;

    assertEquals(formatSExpValue(result), "(a 10 1 2 3 z)");
    const rawA = findSymbolByName(result, "a");
    assertExists(rawA);
    assertEquals(getMeta(rawA)?.resolvedBinding, undefined);
  });
});

Deno.test("macro syntax: backtick runtime syntax-quote preserves resolved binding metadata", async () => {
  await withTempDir(async (dir) => {
    const result = await run(`
      (var x 42)
      ` + "`" + `(+ ~x 1)
    `, {
      baseDir: dir,
      currentFile: path().join(dir, "syntax-quote-runtime.hql"),
    }) as SExp;

    assertEquals(formatSExpValue(result), "(+ 42 1)");
    const plus = findSymbolByName(result, "+");
    assertExists(plus);
    assertEquals(getMeta(plus)?.resolvedBinding?.modulePath, "<builtin>");
  });
});

Deno.test("macro syntax: macros built with quasiquote and unquote expand correctly", async () => {
  const result = await run(`
    (macro when [condition body]
      ` + "`" + `(if ~condition ~body null))
    (var x 10)
    (when (> x 5) "x is greater than 5")
  `);

  assertEquals(result, "x is greater than 5");
});

Deno.test("macro syntax: variadic macro bodies splice forms into the expansion", async () => {
  const result = await run(`
    (macro do-all [items]
      ` + "`" + `(do ~@items))
    (do-all ((var a 1) (var b 2) (+ a b)))
  `);

  assertEquals(result, 3);
});
