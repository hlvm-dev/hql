import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { resetGensymCounter } from "../../src/hql/gensym.ts";
import { run } from "./helpers.ts";

async function runRuntime(code: string) {
  return await run(code, { typeCheck: false });
}

Deno.test("gensym: uniqueness and prefixes are stable", async () => {
  resetGensymCounter();
  const result = await runRuntime(`
    [
      (gensym)
      (gensym "temp")
      (gensym "temp")
      (gensym "")
    ]
  `) as string[];

  assertEquals(result[0].startsWith("g_"), true);
  assertEquals(result[1].startsWith("temp_"), true);
  assertNotEquals(result[1], result[2]);
  assertEquals(result[3].includes("_"), true);
});

Deno.test("gensym: hygienic bindings prevent capture in user code", async () => {
  const result = await runRuntime(`
    (macro with-temp [value & body]
      (var tmp (gensym "temp"))
      \`(let (~tmp ~value)
         ~@body))

    (var temp 999)
    (with-temp 100
      temp)
  `);
  assertEquals(result, 999);
});

Deno.test("gensym: macros can safely allocate multiple internal bindings", async () => {
  const result = await runRuntime(`
    (macro swap [a b]
      (var tmp (gensym "swap_tmp"))
      \`(let (~tmp ~a)
         (= ~a ~b)
         (= ~b ~tmp)))

    (macro complex [a b]
      (var tmp1 (gensym "x"))
      (var tmp2 (gensym "y"))
      \`(let (~tmp1 ~a)
         (let (~tmp2 ~b)
           (+ ~tmp1 ~tmp2))))

    (var x 10)
    (var y 20)
    (swap x y)
    [x y (complex 5 7)]
  `);
  assertEquals(result, [20, 10, 12]);
});

Deno.test("gensym: repeated and nested macro expansions stay independent", async () => {
  const result = await runRuntime(`
    (macro add-one [n]
      (var tmp (gensym "x"))
      \`(let (~tmp ~n)
         (+ ~tmp 1)))

    (macro outer [x]
      (var tmp1 (gensym "outer"))
      \`(let (~tmp1 ~x)
         ~tmp1))

    (macro inner [y]
      (var tmp2 (gensym "inner"))
      \`(let (~tmp2 ~y)
         ~tmp2))

    [
      (add-one 10)
      (add-one 20)
      (add-one 30)
      (outer (inner 42))
    ]
  `);
  assertEquals(result, [11, 21, 31, 42]);
});
