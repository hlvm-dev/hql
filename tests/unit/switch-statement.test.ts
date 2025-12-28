// Tests for native switch statements
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/transpiler/index.ts";
import hql from "../../mod.ts";

Deno.test("Switch: basic switch - uses native ternary (optimized)", async () => {
  const result = await transpile(`
    (switch x
      (case 1 (console.log "one"))
      (case 2 (console.log "two"))
      (default (console.log "other")))
  `);
  // Now optimized to chained ternaries instead of IIFE-wrapped switch
  assertStringIncludes(result.code, "x === 1");
  assertStringIncludes(result.code, "x === 2");
  assertStringIncludes(result.code, "?");
});

Deno.test("Switch: with string cases - uses native ternary (optimized)", async () => {
  const result = await transpile(`
    (switch color
      (case "red" (setBackground "#ff0000"))
      (case "green" (setBackground "#00ff00"))
      (case "blue" (setBackground "#0000ff"))
      (default (setBackground "#000000")))
  `);
  // Now optimized to chained ternaries
  assertStringIncludes(result.code, 'color === "red"');
  assertStringIncludes(result.code, 'color === "green"');
  assertStringIncludes(result.code, 'color === "blue"');
});

Deno.test("Switch: fallthrough with :fallthrough keyword", async () => {
  const result = await transpile(`
    (switch grade
      (case "A" :fallthrough)
      (case "B" (console.log "Good"))
      (case "C" (console.log "Average"))
      (default (console.log "Needs work")))
  `);
  // Fallthrough requires native switch (cannot optimize to ternary)
  assertStringIncludes(result.code, "switch");
  assertStringIncludes(result.code, 'case "A"');
  assertStringIncludes(result.code, 'case "B"');
  // Case A should not have break (fallthrough)
  const codeLines = result.code.split("\n");
  const caseAIndex = codeLines.findIndex(line => line.includes('case "A"'));
  const caseBIndex = codeLines.findIndex(line => line.includes('case "B"'));
  const betweenAandB = codeLines.slice(caseAIndex + 1, caseBIndex).join("\n");
  assertEquals(betweenAandB.includes("break"), false);
});

Deno.test("Switch: multiple statements in case body", async () => {
  const result = await transpile(`
    (switch action
      (case "save"
        (const data (getData))
        (saveToFile data)
        (notify "Saved!"))
      (default
        (console.log "Unknown action")))
  `);
  // Multiple statements require native switch (cannot optimize to simple ternary)
  assertStringIncludes(result.code, 'case "save"');
  assertStringIncludes(result.code, "data");
  assertStringIncludes(result.code, "saveToFile");
  assertStringIncludes(result.code, "notify");
});

Deno.test("Switch: with return in case - uses native ternary (optimized)", async () => {
  const result = await transpile(`
    (fn getDescription [code]
      (switch code
        (case 200 (return "OK"))
        (case 404 (return "Not Found"))
        (case 500 (return "Server Error"))
        (default (return "Unknown"))))
  `);
  // Return statements inside switch - optimized to ternaries
  assertStringIncludes(result.code, "code === 200");
  assertStringIncludes(result.code, '"OK"');
  assertStringIncludes(result.code, '"Not Found"');
});

Deno.test("Switch: nested switch - uses native ternaries (optimized)", async () => {
  const result = await transpile(`
    (switch category
      (case "food"
        (switch item
          (case "apple" "fruit")
          (case "carrot" "vegetable")))
      (default "unknown"))
  `);
  // Nested switches - both optimized to ternaries
  assertStringIncludes(result.code, 'category === "food"');
  assertStringIncludes(result.code, 'item === "apple"');
});

// Behavioral tests - verify the runtime behavior
Deno.test("Switch: runtime behavior - returns correct value", async () => {
  const result1 = await hql.run(`(switch 1 (case 1 "one") (case 2 "two") (default "other"))`);
  assertEquals(result1, "one");

  const result2 = await hql.run(`(switch 2 (case 1 "one") (case 2 "two") (default "other"))`);
  assertEquals(result2, "two");

  const result3 = await hql.run(`(switch 99 (case 1 "one") (case 2 "two") (default "other"))`);
  assertEquals(result3, "other");
});

Deno.test("Switch: runtime behavior - no match returns null", async () => {
  const result = await hql.run(`(switch 99 (case 1 "one") (case 2 "two"))`);
  assertEquals(result, null);
});
