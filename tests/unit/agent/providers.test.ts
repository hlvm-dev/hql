/**
 * Provider Utility Tests
 *
 * Tests the pure utility functions shared across providers.
 * No network calls needed — all functions are pure transformations.
 */

import { assertEquals } from "jsr:@std/assert";

// ============================================================
// Shared: parseJsonArgs
// ============================================================

import { parseJsonArgs } from "../../../src/hlvm/providers/common.ts";

Deno.test({
  name: "parseJsonArgs: parses valid JSON string",
  fn() {
    const result = parseJsonArgs('{"path": "~/Downloads"}');
    assertEquals(result, { path: "~/Downloads" });
  },
});

Deno.test({
  name: "parseJsonArgs: returns object as-is",
  fn() {
    const obj = { path: "." };
    assertEquals(parseJsonArgs(obj), obj);
  },
});

Deno.test({
  name: "parseJsonArgs: returns {} for malformed JSON",
  fn() {
    assertEquals(parseJsonArgs("{invalid json}"), {});
  },
});

Deno.test({
  name: "parseJsonArgs: returns {} for null/undefined",
  fn() {
    assertEquals(parseJsonArgs(null), {});
    assertEquals(parseJsonArgs(undefined), {});
  },
});

