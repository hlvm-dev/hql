import { assertEquals } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  assertSuccessWithOutput,
  assertSuccessWithOutputs,
  binaryTest,
  runCLI,
  runExpression,
  withTempDir,
} from "../_shared/binary-helpers.ts";

const platform = getPlatform();

async function writeBundledEntryFixture(dir: string): Promise<{
  tsEntry: string;
  jsEntry: string;
}> {
  const libDir = `${dir}/lib`;
  await platform.fs.mkdir(libDir, { recursive: true });

  await platform.fs.writeTextFile(`${libDir}/check.hql`, `
    (import [assertEqual] from "@hlvm/assert")
    (fn affirm [x]
      (do
        (assertEqual x 7 "x should be 7")
        x))
    (export [affirm])
  `);

  await platform.fs.writeTextFile(`${libDir}/math.hql`, `
    (import [affirm] from "./check.hql")
    (fn add2 [x]
      (affirm (+ x 2)))
    (export [add2])
  `);

  const tsEntry = `${dir}/app.ts`;
  const jsEntry = `${dir}/app.js`;

  await platform.fs.writeTextFile(
    tsEntry,
    `import { add2 } from "./lib/math.hql";\nconsole.log(add2(5));\n`,
  );
  await platform.fs.writeTextFile(
    jsEntry,
    `import { add2 } from "./lib/math.hql";\nconsole.log(add2(5));\n`,
  );

  return { tsEntry, jsEntry };
}

binaryTest("CLI run: inline expressions auto-print results", async () => {
  const result = await runExpression("(+ 1 2 3)");
  assertSuccessWithOutput(result, "6");
});

binaryTest("CLI run: executes HQL files end-to-end", async () => {
  await withTempDir(async (dir) => {
    const filePath = `${dir}/test.hql`;
    await platform.fs.writeTextFile(filePath, `
      (const x 10)
      (const y 20)
      (print (+ x y))
    `);

    const result = await runCLI("run", [filePath]);
    assertSuccessWithOutput(result, "30");
  });
});

binaryTest("CLI run: stdlib pipelines work through the command", async () => {
  const result = await runExpression('(print [(first [1 2 3]) (vec (map (fn [x] (* x 2)) [1 2 3])) (reduce add 0 [1 2 3 4 5])])');
  assertSuccessWithOutputs(result, "1", "2", "4", "6", "15");
});

binaryTest("CLI run: TypeScript entry points bundle nested HQL imports and embedded packages", async () => {
  await withTempDir(async (dir) => {
    const { tsEntry } = await writeBundledEntryFixture(dir);
    const result = await runCLI("run", [tsEntry]);
    assertSuccessWithOutput(result, "7");
  });
});

binaryTest("CLI run: JavaScript entry points bundle nested HQL imports and embedded packages", async () => {
  await withTempDir(async (dir) => {
    const { jsEntry } = await writeBundledEntryFixture(dir);
    const result = await runCLI("run", [jsEntry]);
    assertSuccessWithOutput(result, "7");
  });
});

binaryTest("CLI run: reports failures for missing files and invalid syntax", async () => {
  const missingFile = await runCLI("run", ["/nonexistent/file.hql"]);
  assertEquals(missingFile.success, false);
  assertEquals(Boolean(missingFile.stdout || missingFile.stderr), true);

  const invalidSyntax = await runExpression("(const x");
  assertEquals(invalidSyntax.success, false);
  assertEquals(Boolean(invalidSyntax.stdout || invalidSyntax.stderr), true);
});
