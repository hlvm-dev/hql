import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

Deno.test("Edge Case Verification: Labeled break across IIFE boundary", async () => {
  const code = `
    (let result "default")
    (label outer
      (for-of [x [1 2 3]]
        (if (=== x 2)
          (break outer)
          (= result x))))
    result
  `;

  // Labeled break works correctly:
  // - x=1: else branch runs, sets result=1
  // - x=2: if branch runs, break outer exits the loop
  // - x=3: never reached
  // Result: 1 (the value set on first iteration before break)
  const result = await run(code);
  assertEquals(result, 1);
});