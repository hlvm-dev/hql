import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { run, withTempDir } from "./helpers.ts";
import { getPlatform } from "../../src/platform/platform.ts";

const path = () => getPlatform().path;
const fs = () => getPlatform().fs;

Deno.test("macro imports resolve through re-exported modules", async () => {
  await withTempDir(async (dir) => {
    await fs().writeTextFile(
      path().join(dir, "macro-source.hql"),
      `(macro double [x] \`(* 2 ~x))
(fn triple [x] (* 3 x))
(var magic-number 42)
(export [double, triple, magic-number])
`,
    );
    await fs().writeTextFile(
      path().join(dir, "macro-reexport.hql"),
      `(import [double, triple, magic-number] from "./macro-source.hql")
(macro quadruple [x] \`(double (double ~x)))
(export [double, triple, magic-number, quadruple])
`,
    );

    const result = await run(`
      (import [quadruple, triple, magic-number] from "./macro-reexport.hql")
      [(quadruple 5) (triple 5) magic-number]
    `, {
      baseDir: dir,
      currentFile: path().join(dir, "main.hql"),
    });

    assertEquals(result, [20, 15, 42]);
  });
});

Deno.test("circular macro imports remain illegal with a concrete diagnostic", async () => {
  const error = await assertRejects(
    () =>
      run(`
        (import [func-a] from "./test/fixtures/macro-circular-a.hql")
        (func-a 1)
      `),
  );
  const circularError = error as Error;

  assertStringIncludes(
    circularError.message,
    "Circular import involving macro",
  );
  assertStringIncludes(circularError.message, "macro-a");
});

Deno.test("preserveMacroState keeps REPL macros alive while hermetic runs reset them", async () => {
  await run(
    `
    (macro add-one [x]
      \`(+ ~x 1))
    nil
  `,
    { preserveMacroState: true },
  );

  const preserved = await run(`(add-one 41)`, { preserveMacroState: true });
  assertEquals(preserved, 42);

  const resetError = await assertRejects(() => run(`(add-one 41)`));
  assertStringIncludes((resetError as Error).message, "add_one");
});

Deno.test("syntax-quote hygiene is authoritative through real runtime execution", async () => {
  await withTempDir(async (dir) => {
    await fs().writeTextFile(
      path().join(dir, "bump.hql"),
      `(fn bump [x] (+ x 1))
(export [bump])
`,
    );

    const result = await run(
      `
        (import [bump] from "./bump.hql")
        (macro dup [expr]
          \`(let (tmp ~expr) [tmp tmp]))
        (macro make-id []
          \`((fn [x] x) 7))
        (macro take-pair [pair]
          \`((fn [[a b]] [a b]) ~pair))
        (macro sum-three []
          \`(loop [i 1 acc 0]
              (if (<= i 3)
                (recur (+ i 1) (+ acc i))
                acc)))
        (macro call-bump [x]
          \`(bump ~x))
        [((fn [tmp] (dup (+ tmp 1))) 99)
         (make-id)
         (take-pair [1 2])
         (sum-three)
         ((fn [bump] (call-bump 2)) (fn [n] 1000))]
      `,
      {
        baseDir: dir,
        currentFile: path().join(dir, "main.hql"),
      },
    );

    assertEquals(result, [[100, 100], 7, [1, 2], 6, 3]);
  });
});
