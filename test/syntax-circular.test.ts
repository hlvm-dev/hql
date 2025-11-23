/**
 * Test: Circular Imports
 * Verifies that circular dependencies between modules are handled correctly
 */

import { assertEquals } from "jsr:@std/assert";
import { run } from "./helpers.ts";

// =============================================================================
// CIRCULAR IMPORTS
// =============================================================================

Deno.test({
  name: "Circular: basic circular dependency",
  sanitizeResources: false,
  sanitizeOps: false,
  ignore: false,
  async fn() {
    const code = `
(import [circularFunction] from "./test/fixtures/circular/a.hql")
(circularFunction)
`;
    const result = await run(code);
    // a.hql: circularValue = 10
    // b.hql: incrementCircular(value) = value + circularValue = value + 10
    // circularFunction() calls incrementCircular(10) = 10 + 10 = 20
    assertEquals(result, 20);
  },
});

Deno.test({
  name: "Circular: multi-hop circular dependency (A→B→C→A)",
  sanitizeResources: false,
  sanitizeOps: false,
  ignore: false,
  async fn() {
    const code = `
(import [aFunc] from "./test/fixtures/circular/multihop-a.hql")
(aFunc)
`;
    const result = await run(code);
    // a.hql: aBase = 1, aFunc() = aBase + bFunc()
    // b.hql: bFunc() = 2 + cFunc()
    // c.hql: cFunc() = 3 + aBase
    // Result: 1 + (2 + (3 + 1)) = 1 + 2 + 3 + 1 = 7
    assertEquals(result, 7);
  },
});

Deno.test({
  name: "Circular: direct value access from circular import",
  sanitizeResources: false,
  sanitizeOps: false,
  ignore: false,
  async fn() {
    const code = `
(import [circularValue] from "./test/fixtures/circular/a.hql")
circularValue
`;
    const result = await run(code);
    // Should be able to directly access circularValue from a.hql
    // even though a.hql imports from b.hql which imports back from a.hql
    assertEquals(result, 10);
  },
});
