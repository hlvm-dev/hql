import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { evaluate } from "../../../src/hlvm/cli/repl/evaluator.ts";
import { ReplState } from "../../../src/hlvm/cli/repl/state.ts";
import { initializeRuntime } from "../../../src/common/runtime-initializer.ts";
import { withTempHlvmDir } from "../helpers.ts";

await initializeRuntime({ ai: false });

async function evaluateWithState(code: string, state: ReplState) {
  return await evaluate(code, state);
}

Deno.test("REPL macro state stays inside a single ReplState session", async () => {
  await withTempHlvmDir(async () => {
    const firstSession = new ReplState();
    const secondSession = new ReplState();

    const defineResult = await evaluateWithState(
      `(macro add-one [x]
         \`(+ ~x 1))`,
      firstSession,
    );
    assert(defineResult.success, defineResult.error?.message);

    const sameSessionResult = await evaluateWithState(
      "(add-one 41)",
      firstSession,
    );
    assert(sameSessionResult.success, sameSessionResult.error?.message);
    assertEquals(sameSessionResult.value, 42);

    const differentSessionResult = await evaluateWithState(
      "(add-one 41)",
      secondSession,
    );
    assert(!differentSessionResult.success);
    assertStringIncludes(
      differentSessionResult.error?.message ?? "",
      "add_one",
    );
  });
});

Deno.test("REPL macro redefinition stays scoped to the current session", async () => {
  await withTempHlvmDir(async () => {
    const firstSession = new ReplState();
    const secondSession = new ReplState();

    const initialDefinition = await evaluateWithState(
      `(macro bump [x]
         \`(+ ~x 1))`,
      firstSession,
    );
    assert(initialDefinition.success, initialDefinition.error?.message);

    const redefinition = await evaluateWithState(
      `(macro bump [x]
         \`(+ ~x 2))`,
      firstSession,
    );
    assert(redefinition.success, redefinition.error?.message);

    const redefinedResult = await evaluateWithState("(bump 40)", firstSession);
    assert(redefinedResult.success, redefinedResult.error?.message);
    assertEquals(redefinedResult.value, 42);

    const secondSessionResult = await evaluateWithState(
      "(bump 40)",
      secondSession,
    );
    assert(!secondSessionResult.success);
    assertStringIncludes(
      secondSessionResult.error?.message ?? "",
      "bump",
    );
  });
});
