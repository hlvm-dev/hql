/**
 * Binary tests for stdlib arithmetic and comparison functions
 * Tests: add, sub, mul, div, mod, inc, dec, eq, neq, lt, gt, lte, gte, isNil
 */

import {
  binaryTest, runExpression, assertSuccessWithOutput, USE_BINARY
} from "../_shared/binary-helpers.ts";

console.log(`Testing stdlib arithmetic in ${USE_BINARY ? "BINARY" : "DENO RUN"} mode`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BASIC ARITHMETIC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

binaryTest("stdlib binary: add - adds two numbers", async () => {
  assertSuccessWithOutput(await runExpression("(add 2 3)"), "5");
});

binaryTest("stdlib binary: add - adds multiple numbers", async () => {
  assertSuccessWithOutput(await runExpression("(+ 1 2 3 4 5)"), "15");
});

binaryTest("stdlib binary: sub - subtracts two numbers", async () => {
  assertSuccessWithOutput(await runExpression("(sub 10 3)"), "7");
});

binaryTest("stdlib binary: sub - subtracts multiple numbers", async () => {
  assertSuccessWithOutput(await runExpression("(- 100 20 10 5)"), "65");
});

binaryTest("stdlib binary: mul - multiplies two numbers", async () => {
  assertSuccessWithOutput(await runExpression("(mul 6 7)"), "42");
});

binaryTest("stdlib binary: mul - multiplies multiple numbers", async () => {
  assertSuccessWithOutput(await runExpression("(* 2 3 4)"), "24");
});

binaryTest("stdlib binary: div - divides two numbers", async () => {
  assertSuccessWithOutput(await runExpression("(div 20 4)"), "5");
});

binaryTest("stdlib binary: mod - returns remainder", async () => {
  assertSuccessWithOutput(await runExpression("(mod 17 5)"), "2");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INCREMENT / DECREMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

binaryTest("stdlib binary: inc - increments number", async () => {
  assertSuccessWithOutput(await runExpression("(inc 5)"), "6");
});

binaryTest("stdlib binary: dec - decrements number", async () => {
  assertSuccessWithOutput(await runExpression("(dec 5)"), "4");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPARISON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

binaryTest("stdlib binary: eq - equal values", async () => {
  assertSuccessWithOutput(await runExpression("(eq 5 5)"), "true");
});

binaryTest("stdlib binary: eq - unequal values", async () => {
  assertSuccessWithOutput(await runExpression("(eq 5 6)"), "false");
});

binaryTest("stdlib binary: neq - not equal", async () => {
  assertSuccessWithOutput(await runExpression("(neq 5 6)"), "true");
});

binaryTest("stdlib binary: lt - less than", async () => {
  assertSuccessWithOutput(await runExpression("(lt 3 5)"), "true");
});

binaryTest("stdlib binary: gt - greater than", async () => {
  assertSuccessWithOutput(await runExpression("(gt 5 3)"), "true");
});

binaryTest("stdlib binary: lte - less than or equal", async () => {
  assertSuccessWithOutput(await runExpression("(lte 5 5)"), "true");
});

binaryTest("stdlib binary: gte - greater than or equal", async () => {
  assertSuccessWithOutput(await runExpression("(gte 5 5)"), "true");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PREDICATES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

binaryTest("stdlib binary: isNil - null is nil", async () => {
  assertSuccessWithOutput(await runExpression("(isNil null)"), "true");
});

binaryTest("stdlib binary: isNil - number is not nil", async () => {
  assertSuccessWithOutput(await runExpression("(isNil 5)"), "false");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEQUENCE PREDICATES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

binaryTest("stdlib binary: some - finds matching element", async () => {
  // some returns the first matching element, not true/false
  assertSuccessWithOutput(await runExpression("(some (fn [x] (> x 3)) [1 2 3 4 5])"), "4");
});

binaryTest("stdlib binary: every - all match", async () => {
  assertSuccessWithOutput(await runExpression("(every (fn [x] (> x 0)) [1 2 3 4 5])"), "true");
});

binaryTest("stdlib binary: every - not all match", async () => {
  assertSuccessWithOutput(await runExpression("(every (fn [x] (> x 3)) [1 2 3 4 5])"), "false");
});

binaryTest("stdlib binary: notAny - none match", async () => {
  assertSuccessWithOutput(await runExpression("(notAny (fn [x] (> x 10)) [1 2 3 4 5])"), "true");
});

binaryTest("stdlib binary: notEvery - not all match", async () => {
  assertSuccessWithOutput(await runExpression("(notEvery (fn [x] (> x 3)) [1 2 3 4 5])"), "true");
});
