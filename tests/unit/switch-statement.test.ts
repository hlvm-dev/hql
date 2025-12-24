// Tests for native switch statements
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/transpiler/index.ts";

Deno.test("Switch: basic switch statement", async () => {
  const result = await transpile(`
    (switch x
      (case 1 (console.log "one"))
      (case 2 (console.log "two"))
      (default (console.log "other")))
  `);
  assertStringIncludes(result.code, "switch (x)");
  assertStringIncludes(result.code, "case 1:");
  assertStringIncludes(result.code, "case 2:");
  assertStringIncludes(result.code, "default:");
  assertStringIncludes(result.code, "break;");
});

Deno.test("Switch: with string cases", async () => {
  const result = await transpile(`
    (switch color
      (case "red" (setBackground "#ff0000"))
      (case "green" (setBackground "#00ff00"))
      (case "blue" (setBackground "#0000ff"))
      (default (setBackground "#000000")))
  `);
  assertStringIncludes(result.code, 'case "red"');
  assertStringIncludes(result.code, 'case "green"');
  assertStringIncludes(result.code, 'case "blue"');
});

Deno.test("Switch: fallthrough with :fallthrough keyword", async () => {
  const result = await transpile(`
    (switch grade
      (case "A" :fallthrough)
      (case "B" (console.log "Good"))
      (case "C" (console.log "Average"))
      (default (console.log "Needs work")))
  `);
  // Case A should not have break
  const codeLines = result.code.split("\n");
  const caseAIndex = codeLines.findIndex(line => line.includes('case "A"'));
  const caseBIndex = codeLines.findIndex(line => line.includes('case "B"'));
  // Check that there's no break between case A and case B
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
  assertStringIncludes(result.code, 'case "save"');
  assertStringIncludes(result.code, "const data");
  assertStringIncludes(result.code, "saveToFile");
  assertStringIncludes(result.code, "notify");
});

Deno.test("Switch: with return in case", async () => {
  const result = await transpile(`
    (fn getDescription [code]
      (switch code
        (case 200 (return "OK"))
        (case 404 (return "Not Found"))
        (case 500 (return "Server Error"))
        (default (return "Unknown"))))
  `);
  assertStringIncludes(result.code, "switch (code)");
  assertStringIncludes(result.code, 'return "OK"');
  assertStringIncludes(result.code, 'return "Not Found"');
});

Deno.test("Switch: nested switch", async () => {
  const result = await transpile(`
    (switch category
      (case "food"
        (switch item
          (case "apple" (return "fruit"))
          (case "carrot" (return "vegetable"))))
      (default (return "unknown")))
  `);
  assertStringIncludes(result.code, "switch (category)");
  assertStringIncludes(result.code, "switch (item)");
});
