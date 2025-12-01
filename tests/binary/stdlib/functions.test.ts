/**
 * Binary tests for stdlib function operations
 * Tests: comp, partial, apply, identity
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { runExpression, USE_BINARY } from "../_shared/binary-helpers.ts";

console.log(`Testing stdlib functions in ${USE_BINARY ? "BINARY" : "DENO RUN"} mode`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMP (Function Composition)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: comp - composes two functions",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("((comp inc inc) 5)");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "7");
  },
});

Deno.test({
  name: "stdlib binary: comp - composes three functions",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("((comp inc inc inc) 10)");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "13");
  },
});

Deno.test({
  name: "stdlib binary: comp - with custom functions",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("((comp (fn [x] (* x 2)) inc) 5)");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "12");  // (5 + 1) * 2 = 12
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PARTIAL (Partial Application)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: partial - partially applies first arg",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("((partial add 10) 5)");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "15");
  },
});

Deno.test({
  name: "stdlib binary: partial - partially applies multiple args",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Use inline function to avoid def scoping issues
    const result = await runExpression("((partial (fn [a b c] (+ a b c)) 1 2) 3)");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "6");
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// APPLY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test({
  name: "stdlib binary: apply - applies function to args list",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(apply add [1 2])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "3");
  },
});

Deno.test({
  name: "stdlib binary: apply - with larger args list",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await runExpression("(apply (fn [a b c] (+ a b c)) [1 2 3])");
    assertEquals(result.success, true, result.stderr);
    assertStringIncludes(result.stdout, "6");
  },
});
