import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

Deno.test("Edge Case Verification: Labeled break across IIFE boundary", async () => {
  const code = `
    (let result "default")
    (label outer
      (for-of [x [1 2 3]]
        (if (=== x 2)
          (break outer)
          (set! result x))))
    result
  `;
  
  try {
    await run(code);
    console.log("SURPRISE: It worked");
  } catch (e: any) {
    console.log("CONFIRMED: It failed as expected.");
    console.log(e.message);
  }
});