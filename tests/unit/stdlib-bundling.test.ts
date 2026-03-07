import {
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "jsr:@std/assert";
import { getPlatform } from "../../src/platform/platform.ts";
import { withTempDir } from "./helpers.ts";
import {
  BINARY_PATH,
  CLI_PATH,
  ensureBinaryCompiled,
  USE_BINARY,
} from "../binary/_shared/binary-helpers.ts";

async function runTranspileCLI(
  inputPath: string,
  outputPath: string,
): Promise<{ success: boolean; stderr: string }> {
  await ensureBinaryCompiled();
  const platform = getPlatform();

  const cmd = USE_BINARY
    ? [BINARY_PATH, "hql", "compile", inputPath, "--target", "js", "-o", outputPath]
    : ["deno", "run", "-A", CLI_PATH, "hql", "compile", inputPath, "--target", "js", "-o", outputPath];

  const { success, stderr } = await platform.command.output({
    cmd,
    stdout: "piped",
    stderr: "piped",
  });
  return { success, stderr: new TextDecoder().decode(stderr) };
}

async function withCompiledHql<T>(
  hqlCode: string,
  fn: (outputPath: string) => Promise<T>,
): Promise<T> {
  const platform = getPlatform();

  return await withTempDir(async (tempDir) => {
    const inputPath = platform.path.join(tempDir, "test.hql");
    const outputPath = platform.path.join(tempDir, "test.js");

    await platform.fs.writeTextFile(inputPath, hqlCode);

    const transpileResult = await runTranspileCLI(inputPath, outputPath);
    if (!transpileResult.success) {
      throw new Error(`Transpilation failed: ${transpileResult.stderr}`);
    }

    return await fn(outputPath);
  });
}

async function transpileHql(hqlCode: string): Promise<string> {
  const platform = getPlatform();
  return await withCompiledHql(hqlCode, (outputPath) => platform.fs.readTextFile(outputPath));
}

async function transpileAndRun(
  hqlCode: string,
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  return await withCompiledHql(hqlCode, async (outputPath) => {
    const platform = getPlatform();
    const { success, stdout, stderr } = await platform.command.output({
      cmd: ["deno", "run", outputPath],
      stdout: "piped",
      stderr: "piped",
    });

    return {
      success,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    };
  });
}

Deno.test({
  name: "stdlib bundling: compiled output is self-contained with no external imports",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const output = await transpileHql(`(print (first [1 2 3]))`);

    assertEquals(output.match(/^import\s+/gm), null);
    assertEquals(output.match(/require\s*\(/g), null);
  },
});

Deno.test({
  name: "stdlib bundling: bundled sequence primitives run standalone after compilation",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`
      (print [
        (first [10 20 30])
        (rest [1 2 3])
        (doall (map (fn (x) (* x 2)) [1 2 3]))
        (doall (filter (fn (x) (> x 2)) [1 2 3 4 5]))
        (reduce (fn (a b) (+ a b)) 0 [1 2 3 4 5])
        (doall (take 3 [1 2 3 4 5]))
        (doall (drop 2 [1 2 3 4 5]))
      ])
    `);

    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertStringIncludes(result.stdout, "10");
    assertMatch(result.stdout, /2.*3/);
    assertMatch(result.stdout, /2.*4.*6/);
    assertMatch(result.stdout, /3.*4.*5/);
    assertStringIncludes(result.stdout, "15");
  },
});

Deno.test({
  name: "stdlib bundling: bundled collection-building helpers run standalone after compilation",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await transpileAndRun(`
      (print [
        (doall (concat [1 2] [3 4]))
        (cons 0 [1 2 3])
        (doall (distinct [1 2 2 3 3 3]))
        (doall (flatten [[1 2] [3 4]]))
      ])
    `);

    assertEquals(result.success, true, `Execution should succeed. stderr: ${result.stderr}`);
    assertMatch(result.stdout, /1.*2.*3.*4/);
    assertMatch(result.stdout, /0.*1.*2.*3/);
    assertMatch(result.stdout, /1.*2.*3/);
    assertMatch(result.stdout, /1.*2.*3.*4/);
  },
});
