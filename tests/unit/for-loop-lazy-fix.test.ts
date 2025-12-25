
import { assertEquals } from "jsr:@std/assert@1";
import { run } from "../../mod.ts";

// 1. Manual Expansion Check (Runtime Fix Verification)
Deno.test("For Loop: __hql_for_each handles large range without OOM (Manual Expansion Check)", async () => {
  const code = `
    (let count 0)
    (__hql_for_each (range 1000000)
      (fn [i]
        (= count (+ count 1))))
    count
  `;
  const result = await run(code, { baseDir: Deno.cwd() });
  assertEquals(result, 1000000);
});

// 2. Macro Integration Check (Environment Fix Verification)
Deno.test("For Loop: Standard macro syntax works (Vector Binding Fix)", async () => {
  const code = `
    (let acc [])
    (for [i (range 5)]
      (= acc (conj acc i)))
    acc
  `;
  // This test verifies that the 'for' macro correctly extracts 'i' from '[i (range 5)]'
  // instead of incorrectly using the 'vector' symbol.
  const result = await run(code, { baseDir: Deno.cwd() });
  assertEquals(result, [0, 1, 2, 3, 4]);
});

// 3. Performance/Optimization Check (End-to-End)
Deno.test("For Loop: Large range with macro syntax works (Zero-Cost Abstraction)", async () => {
  const code = `
    (let count 0)
    (for [i (range 1000000)]
      (= count (+ count 1)))
    count
  `;
  // This confirms that:
  // A) The macro expands correctly (Fix #2)
  // B) The optimizer detects the pattern OR the runtime handles it lazily (Fix #1)
  // C) No OOM occurs
  const result = await run(code, { baseDir: Deno.cwd() });
  assertEquals(result, 1000000);
});
