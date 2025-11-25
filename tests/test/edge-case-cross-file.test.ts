// Cross-file edge case tests for macro imports
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

// Test 1: Mixed import (macro + function + constant) from actual file
Deno.test("Edge Case: Cross-file mixed macro + function + constant import", async () => {
  const code = `
(import [double, triple, magic-number] from "./test/fixtures/macro-source.hql")

(var r1 (double 5))
(var r2 (triple 5))
(var r3 magic-number)

[r1, r2, r3]
`;

  const result = await run(code);
  assertEquals(result, [10, 15, 42]);
});

// Test 2: Re-export with macros
Deno.test("Edge Case: Re-export macros through intermediate file", async () => {
  const code = `
(import [double, triple, magic-number, quadruple] from "./test/fixtures/macro-reexport.hql")

(var r1 (double 5))
(var r2 (triple 5))
(var r3 magic-number)
(var r4 (quadruple 5))

[r1, r2, r3, r4]
`;

  const result = await run(code);
  assertEquals(result, [10, 15, 42, 20]); // quadruple = double(double(5)) = 20
});

// Test 3: Circular imports with macros (should throw clear error)
Deno.test("Edge Case: Circular imports with macros should throw error", async () => {
  const code = `
(import [macro-a, func-a] from "./test/fixtures/macro-circular-a.hql")

(var r1 (macro-a 5))
(var r2 (func-a 5))

[r1, r2]
`;

  // Should throw a clear error about circular macro imports
  await assertRejects(
    async () => await run(code),
    Error,
    "Circular import involving macro",
  );
});

// Test 4: Import macro that uses another imported macro
Deno.test("Edge Case: Transitive macro dependencies", async () => {
  const code = `
;; Define base macro
(macro base (x) \`(* ~x 3))

;; Define macro that uses base
(macro derived (x) \`(+ (base ~x) 1))

;; Use derived (which internally uses base)
(derived 5)
`;

  const result = await run(code);
  assertEquals(result, 16); // (5 * 3) + 1 = 16
});

// Test 5: Import macro with rest parameters
Deno.test("Edge Case: Macro with rest parameters", async () => {
  const code = `
(macro sum-all (& nums)
  \`(+ ~@nums))

(sum-all 1 2 3 4 5)
`;

  const result = await run(code);
  assertEquals(result, 15);
});
