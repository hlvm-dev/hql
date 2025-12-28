
import { transpile } from "../../src/transpiler/index.ts";

Deno.test("Inspect Generated JS for Broken Edge Case", async () => {
  const code = `
    (label outer
      (let result
        (for-of [x [1 2 3]]
          (if (=== x 2)
            (break outer) ;; <--- Breaking to 'outer' which is OUTSIDE the IIFE that wraps for-of
            x))))
  `;
  
  const result = await transpile(code);
  console.log("GENERATED CODE:\n", result.code);
});

