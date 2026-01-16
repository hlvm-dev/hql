import { assert, assertEquals } from "jsr:@std/assert@1";
import { REPL } from "../mod.ts";
import type { REPLPlugin } from "../mod.ts";

const jsPlugin: REPLPlugin = {
  name: "JavaScript",
  async evaluate(code, context) {
    const exportName = `__repl_line_${context.lineNumber}`;
    await context.appendToModule(`export const ${exportName} = (${code});\n`);
    const module = await context.reimportModule<Record<string, unknown>>();
    return { value: module[exportName] };
  },
};

Deno.test("shared module state persists across evaluations", async () => {
  const repl = new REPL([jsPlugin]);
  const first = await repl.evaluate("1 + 2");
  assertEquals(first?.value, 3);

  const second = await repl.evaluate("5 + 2");
  assertEquals(second?.value, 7);

  await repl.dispose();
});

Deno.test("line numbers increment per evaluation", async () => {
  const observed: number[] = [];
  const trackingPlugin: REPLPlugin = {
    name: "Tracker",
    async evaluate(code, context) {
      observed.push(context.lineNumber);
      await context.appendToModule(`export const __repl_line_${context.lineNumber} = (${code});\n`);
      await context.reimportModule();
      return { value: context.lineNumber };
    },
  };

  const repl = new REPL([trackingPlugin]);
  await repl.evaluate("1");
  await repl.evaluate("2");
  assert(observed.length === 2);
  assert(observed[1] === observed[0] + 1);
  await repl.dispose();
});

Deno.test("plugin state persists", async () => {
  const stateful: REPLPlugin = {
    name: "State",
    async evaluate(_, context) {
      const count = (context.getState<number>("count") ?? 0) + 1;
      context.setState("count", count);
      return { value: count };
    },
  };

  const repl = new REPL([stateful]);
  const first = await repl.evaluate("noop");
  const second = await repl.evaluate("noop");
  assertEquals(first?.value, 1);
  assertEquals(second?.value, 2);
  await repl.dispose();
});
