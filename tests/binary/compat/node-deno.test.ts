import {
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  transpileAndRunWithDeno,
  transpileAndRunWithNode,
  transpileCode,
} from "../_shared/binary-helpers.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

let NODE_AVAILABLE = false;
try {
  const { code } = await getPlatform().command.output({
    cmd: ["node", "--version"],
    stdout: "piped",
    stderr: "piped",
  });
  NODE_AVAILABLE = code === 0;
} catch {
  NODE_AVAILABLE = false;
}

async function assertPortableOutput(
  code: string,
  expectedIncludes?: string,
): Promise<void> {
  const [nodeResult, denoResult] = await Promise.all([
    transpileAndRunWithNode(code),
    transpileAndRunWithDeno(code),
  ]);

  assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
  assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
  assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
  if (expectedIncludes) {
    assertStringIncludes(nodeResult.stdout, expectedIncludes);
  }
}

Deno.test({
  name: "compat: core expressions produce identical output in Node and Deno",
  ignore: !NODE_AVAILABLE,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await assertPortableOutput(`
      (print (js/JSON.stringify [
        (+ 1 2 3 4 5)
        (* 2 3 4)
        (if (> 5 3) "yes" "no")
        (let [x 10 y 20] (+ x y))
      ]))
    `, "30");
  },
});

Deno.test({
  name: "compat: functional stdlib, recursion, and data access stay portable",
  ignore: !NODE_AVAILABLE,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await assertPortableOutput(`
      (const square (fn [x] (* x x)))
      (const factorial (fn [n]
        (if (lte n 1)
          1
          (* n (factorial (- n 1))))))
      (print (js/JSON.stringify [
        (vec (map (fn [x] (* x 2)) [1 2 3]))
        (vec (filter (fn [x] (> x 2)) [1 2 3 4 5]))
        (reduce add 0 [1 2 3 4 5])
        (square 7)
        (factorial 5)
        (get {"name": "Alice", "age": 30} "name")
        (getIn {"user": {"profile": {"name": "Bob"}}} ["user" "profile" "name"])
      ]))
    `, "Alice");
  },
});

Deno.test({
  name: "compat: composed pipelines and higher-order helpers match across runtimes",
  ignore: !NODE_AVAILABLE,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await assertPortableOutput(`
      (const numbers [1 2 3 4 5 6 7 8 9 10])
      (const evenDoubled
        (vec (map (fn [x] (* x 2))
             (filter (fn [x] (eq 0 (mod x 2))) numbers))))
      (print (js/JSON.stringify [
        (reduce add 0 evenDoubled)
        ((comp inc inc inc) 10)
      ]))
    `, "60");
  },
});

Deno.test({
  name: "compat: transpiled output stays self-contained and carries required stdlib helpers",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { js: noImports } = await transpileCode("(vec (map inc [1 2 3]))");
    const { js: withStdlib } = await transpileCode("(reduce add 0 (map inc [1 2 3]))");

    assertEquals(noImports.includes("import "), false);
    assertEquals(noImports.includes("require("), false);
    assertEquals(noImports.includes("function"), true);
    assertStringIncludes(withStdlib, "reduce");
    assertStringIncludes(withStdlib, "map");
  },
});
