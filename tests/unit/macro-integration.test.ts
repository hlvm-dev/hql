import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { run } from "./helpers.ts";

Deno.test("macro imports resolve through re-exported modules", async () => {
  const result = await run(`
    (import [quadruple, triple, magic-number] from "./test/fixtures/macro-reexport.hql")
    [(quadruple 5) (triple 5) magic-number]
  `);

  assertEquals(result, [20, 15, 42]);
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

  assertStringIncludes(circularError.message, "Circular import involving macro");
  assertStringIncludes(circularError.message, "macro-a");
});

Deno.test("preserveMacroState keeps REPL macros alive while hermetic runs reset them", async () => {
  await run(`
    (macro add-one [x]
      \`(+ ~x 1))
    nil
  `, { preserveMacroState: true });

  const preserved = await run(`(add-one 41)`, { preserveMacroState: true });
  assertEquals(preserved, 42);

  const resetError = await assertRejects(() => run(`(add-one 41)`));
  assertStringIncludes((resetError as Error).message, "add_one");
});
