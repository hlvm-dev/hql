import { assertEquals } from "jsr:@std/assert";
import {
  decodeVLQ,
  validateSourceMap,
} from "../../src/hql/transpiler/pipeline/source-map-validator.ts";

Deno.test("source-map-validator", async (t) => {
  // --- decodeVLQ tests ---

  await t.step("decodeVLQ - AAAA decodes to [0, 0, 0, 0]", () => {
    assertEquals(decodeVLQ("AAAA"), [0, 0, 0, 0]);
  });

  await t.step("decodeVLQ - AACA decodes to [0, 0, 1, 0]", () => {
    // 'C' = 2 in Base64, no continuation bit → value=2, sign bit=0, result=1
    assertEquals(decodeVLQ("AACA"), [0, 0, 1, 0]);
  });

  await t.step("decodeVLQ - handles negative numbers", () => {
    // 'D' = 3 in Base64, no continuation bit → value=3, sign bit=1, result=-1
    assertEquals(decodeVLQ("D"), [-1]);
    // 'B' = 1 in Base64, no continuation bit → value=1, sign bit=1, result=0? No:
    // value=1, sign bit = 1 & 1 = 1, abs = 1 >> 1 = 0, so -0 = 0
    // Actually 'B' = 1 → sign bit 1, abs = 0, result = -0 = 0
    // Let's test 'F' = 5 → sign bit 1, abs = 2, result = -2
    assertEquals(decodeVLQ("F"), [-2]);
  });

  await t.step("decodeVLQ - handles multi-sextet values", () => {
    // 'g' = 32, continuation bit set (32 & 0x20 = 0x20), data bits = 0
    // 'B' = 1, no continuation, data bits = 1
    // value = 0 + (1 << 5) = 32, sign bit = 0, abs = 16, result = 16
    assertEquals(decodeVLQ("gB"), [16]);
  });

  await t.step("decodeVLQ - throws on invalid character", () => {
    let threw = false;
    try {
      decodeVLQ("AA!A");
    } catch (e) {
      threw = true;
      assertEquals((e as Error).message.includes("Invalid Base64 VLQ character"), true);
    }
    assertEquals(threw, true);
  });

  await t.step("decodeVLQ - throws on truncated input", () => {
    let threw = false;
    try {
      // 'g' has continuation bit set but nothing follows
      decodeVLQ("g");
    } catch (e) {
      threw = true;
      assertEquals((e as Error).message.includes("Truncated"), true);
    }
    assertEquals(threw, true);
  });

  // --- validateSourceMap tests ---

  await t.step("validates a minimal valid source map", () => {
    const result = validateSourceMap({
      version: 3,
      sources: ["input.hql"],
      names: [],
      mappings: "AAAA",
      sourcesContent: ["(+ 1 2)"],
    });
    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
  });

  await t.step("error on missing version", () => {
    const result = validateSourceMap({
      sources: ["a.hql"],
      names: [],
      mappings: "",
    });
    assertEquals(result.valid, false);
    assertEquals(result.errors.some((e) => e.includes("version")), true);
  });

  await t.step("error on wrong version", () => {
    const result = validateSourceMap({
      version: 2,
      sources: ["a.hql"],
      names: [],
      mappings: "",
    });
    assertEquals(result.valid, false);
    assertEquals(result.errors.some((e) => e.includes("version") && e.includes("2")), true);
  });

  await t.step("error on empty sources", () => {
    const result = validateSourceMap({
      version: 3,
      sources: [],
      names: [],
      mappings: "",
    });
    assertEquals(result.valid, false);
    assertEquals(result.errors.some((e) => e.includes("sources") && e.includes("non-empty")), true);
  });

  await t.step("error on invalid VLQ character in mappings", () => {
    const result = validateSourceMap({
      version: 3,
      sources: ["a.hql"],
      names: [],
      mappings: "AA!A",
    });
    assertEquals(result.valid, false);
    assertEquals(result.errors.some((e) => e.includes("Invalid Base64 VLQ")), true);
  });

  await t.step("error on source index out of bounds", () => {
    // AACA = [0, 0, 1, 0] → source index offset = 0, but then
    // we need a segment with source index > 0 to go out of bounds for a 1-source map.
    // AACA = [0, 0, 1, 0] → 4 fields, source index relative = 0
    // ACAA = [0, 1, 0, 0] → 4 fields, source index relative = 1
    // With only 1 source (index 0), absolute source index becomes 1 → out of bounds
    const result = validateSourceMap({
      version: 3,
      sources: ["a.hql"],
      names: [],
      mappings: "ACAA",
    });
    assertEquals(result.valid, false);
    assertEquals(result.errors.some((e) => e.includes("source index") && e.includes("out of bounds")), true);
  });

  await t.step("error on names index out of bounds", () => {
    // AAAAC = [0, 0, 0, 0, 1] → 5 fields, name index relative = 1
    // names = ["foo"] (1 entry), absolute name index = 1 → out of bounds
    const result = validateSourceMap({
      version: 3,
      sources: ["a.hql"],
      names: ["foo"],
      mappings: "AAAAC",
    });
    assertEquals(result.valid, false);
    assertEquals(result.errors.some((e) => e.includes("name index") && e.includes("out of bounds")), true);
  });

  await t.step("warning on sourcesContent length mismatch", () => {
    const result = validateSourceMap({
      version: 3,
      sources: ["a.hql", "b.hql"],
      names: [],
      mappings: "AAAA",
      sourcesContent: ["(+ 1 2)"],
    });
    // The map is still structurally valid; the mismatch is a warning
    assertEquals(result.warnings.some((w) => w.includes("sourcesContent")), true);
  });

  await t.step("validates a complete map with names", () => {
    // AAAAA = [0, 0, 0, 0, 0] → 5 fields, all relative offsets = 0
    // This references source[0] and names[0], both valid
    const result = validateSourceMap({
      version: 3,
      sources: ["input.hql"],
      names: ["myFunc"],
      mappings: "AAAAA",
      sourcesContent: ["(fn myFunc [] 42)"],
      file: "output.js",
    });
    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
  });

  await t.step("rejects non-object input", () => {
    assertEquals(validateSourceMap(null).valid, false);
    assertEquals(validateSourceMap("string").valid, false);
    assertEquals(validateSourceMap(42).valid, false);
    assertEquals(validateSourceMap([]).valid, false);
  });
});
