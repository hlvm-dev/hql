/**
 * Compatibility tests - verify transpiled HQL code works in both Node.js and Deno
 *
 * These tests transpile HQL code and execute it in both runtimes to ensure
 * the self-contained output is truly portable.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import {
  transpileAndRunWithNode,
  transpileAndRunWithDeno,
  transpileCode,
  USE_BINARY
} from "../_shared/binary-helpers.ts";

console.log(`Testing Node/Deno compatibility in ${USE_BINARY ? "BINARY" : "DENO RUN"} mode`);

// Helper to check if Node.js is available
async function hasNode(): Promise<boolean> {
  try {
    const cmd = new Deno.Command("node", { args: ["--version"] });
    const { code } = await cmd.output();
    return code === 0;
  } catch {
    return false;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BASIC ARITHMETIC COMPATIBILITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "compat: arithmetic - same output in Node and Deno",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!await hasNode()) {
      console.log("Skipping: Node.js not available");
      return;
    }

    // Use print to output result (transpiled code doesn't auto-print)
    const code = "(print (+ 1 2 3 4 5))";
    const [nodeResult, denoResult] = await Promise.all([
      transpileAndRunWithNode(code),
      transpileAndRunWithDeno(code),
    ]);

    assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
    assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
    assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
    assertStringIncludes(nodeResult.stdout, "15");
  },
});

Deno.test({
  name: "compat: multiplication - same output in Node and Deno",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!await hasNode()) {
      console.log("Skipping: Node.js not available");
      return;
    }

    const code = "(print (* 2 3 4))";
    const [nodeResult, denoResult] = await Promise.all([
      transpileAndRunWithNode(code),
      transpileAndRunWithDeno(code),
    ]);

    assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
    assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
    assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
    assertStringIncludes(nodeResult.stdout, "24");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STDLIB COMPATIBILITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "compat: map - same output in Node and Deno",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!await hasNode()) {
      console.log("Skipping: Node.js not available");
      return;
    }

    const code = "(print (vec (map (fn [x] (* x 2)) [1 2 3])))";
    const [nodeResult, denoResult] = await Promise.all([
      transpileAndRunWithNode(code),
      transpileAndRunWithDeno(code),
    ]);

    assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
    assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
    assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
  },
});

Deno.test({
  name: "compat: filter - same output in Node and Deno",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!await hasNode()) {
      console.log("Skipping: Node.js not available");
      return;
    }

    const code = "(print (vec (filter (fn [x] (> x 2)) [1 2 3 4 5])))";
    const [nodeResult, denoResult] = await Promise.all([
      transpileAndRunWithNode(code),
      transpileAndRunWithDeno(code),
    ]);

    assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
    assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
    assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
  },
});

Deno.test({
  name: "compat: reduce - same output in Node and Deno",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!await hasNode()) {
      console.log("Skipping: Node.js not available");
      return;
    }

    const code = "(print (reduce add 0 [1 2 3 4 5]))";
    const [nodeResult, denoResult] = await Promise.all([
      transpileAndRunWithNode(code),
      transpileAndRunWithDeno(code),
    ]);

    assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
    assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
    assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
    assertStringIncludes(nodeResult.stdout, "15");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FUNCTION DEFINITION COMPATIBILITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "compat: fn definition - same output in Node and Deno",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!await hasNode()) {
      console.log("Skipping: Node.js not available");
      return;
    }

    const code = `
      (const square (fn [x] (* x x)))
      (print (square 7))
    `;
    const [nodeResult, denoResult] = await Promise.all([
      transpileAndRunWithNode(code),
      transpileAndRunWithDeno(code),
    ]);

    assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
    assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
    assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
    assertStringIncludes(nodeResult.stdout, "49");
  },
});

Deno.test({
  name: "compat: recursive function - same output in Node and Deno",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!await hasNode()) {
      console.log("Skipping: Node.js not available");
      return;
    }

    const code = `
      (const factorial (fn [n]
        (if (lte n 1)
          1
          (* n (factorial (- n 1))))))
      (print (factorial 5))
    `;
    const [nodeResult, denoResult] = await Promise.all([
      transpileAndRunWithNode(code),
      transpileAndRunWithDeno(code),
    ]);

    assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
    assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
    assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
    assertStringIncludes(nodeResult.stdout, "120");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DATA STRUCTURE COMPATIBILITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "compat: object operations - same output in Node and Deno",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!await hasNode()) {
      console.log("Skipping: Node.js not available");
      return;
    }

    const code = '(print (get {"name": "Alice", "age": 30} "name"))';
    const [nodeResult, denoResult] = await Promise.all([
      transpileAndRunWithNode(code),
      transpileAndRunWithDeno(code),
    ]);

    assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
    assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
    assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
    assertStringIncludes(nodeResult.stdout, "Alice");
  },
});

Deno.test({
  name: "compat: nested data - same output in Node and Deno",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!await hasNode()) {
      console.log("Skipping: Node.js not available");
      return;
    }

    const code = '(print (getIn {"user": {"profile": {"name": "Bob"}}} ["user" "profile" "name"]))';
    const [nodeResult, denoResult] = await Promise.all([
      transpileAndRunWithNode(code),
      transpileAndRunWithDeno(code),
    ]);

    assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
    assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
    assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
    assertStringIncludes(nodeResult.stdout, "Bob");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONTROL FLOW COMPATIBILITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "compat: if expression - same output in Node and Deno",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!await hasNode()) {
      console.log("Skipping: Node.js not available");
      return;
    }

    const code = '(print (if (> 5 3) "yes" "no"))';
    const [nodeResult, denoResult] = await Promise.all([
      transpileAndRunWithNode(code),
      transpileAndRunWithDeno(code),
    ]);

    assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
    assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
    assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
    assertStringIncludes(nodeResult.stdout, "yes");
  },
});

Deno.test({
  name: "compat: let binding - same output in Node and Deno",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!await hasNode()) {
      console.log("Skipping: Node.js not available");
      return;
    }

    const code = "(print (let [x 10 y 20] (+ x y)))";
    const [nodeResult, denoResult] = await Promise.all([
      transpileAndRunWithNode(code),
      transpileAndRunWithDeno(code),
    ]);

    assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
    assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
    assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
    assertStringIncludes(nodeResult.stdout, "30");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPLEX PIPELINE COMPATIBILITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "compat: complex pipeline - same output in Node and Deno",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!await hasNode()) {
      console.log("Skipping: Node.js not available");
      return;
    }

    const code = `
      (const numbers [1 2 3 4 5 6 7 8 9 10])
      (const evenDoubled (vec (map (fn [x] (* x 2)) (filter (fn [x] (eq 0 (mod x 2))) numbers))))
      (print (reduce add 0 evenDoubled))
    `;
    const [nodeResult, denoResult] = await Promise.all([
      transpileAndRunWithNode(code),
      transpileAndRunWithDeno(code),
    ]);

    assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
    assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
    assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
    // 2+4+6+8+10 = 30, doubled = 60
    assertStringIncludes(nodeResult.stdout, "60");
  },
});

Deno.test({
  name: "compat: function composition - same output in Node and Deno",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    if (!await hasNode()) {
      console.log("Skipping: Node.js not available");
      return;
    }

    const code = "(print ((comp inc inc inc) 10))";
    const [nodeResult, denoResult] = await Promise.all([
      transpileAndRunWithNode(code),
      transpileAndRunWithDeno(code),
    ]);

    assertEquals(nodeResult.success, true, `Node failed: ${nodeResult.stderr}`);
    assertEquals(denoResult.success, true, `Deno failed: ${denoResult.stderr}`);
    assertEquals(nodeResult.stdout.trim(), denoResult.stdout.trim());
    assertStringIncludes(nodeResult.stdout, "13");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TRANSPILED CODE IS SELF-CONTAINED
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "compat: transpiled code has no imports",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const code = "(vec (map inc [1 2 3]))";
    const { js } = await transpileCode(code);

    // Should not have any import statements
    assertEquals(js.includes("import "), false, "Transpiled code should not contain imports");
    assertEquals(js.includes("require("), false, "Transpiled code should not contain require");

    // Should be executable JavaScript
    assertEquals(js.includes("function"), true, "Should contain function definitions");
  },
});

Deno.test({
  name: "compat: transpiled code includes stdlib",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const code = "(reduce add 0 (map inc [1 2 3]))";
    const { js } = await transpileCode(code);

    // Should include the stdlib functions
    assertStringIncludes(js, "reduce");
    assertStringIncludes(js, "map");
  },
});
