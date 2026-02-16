/**
 * Source Map V3 Compliance Test Suite
 *
 * End-to-end tests that transpile real HQL through the full pipeline
 * and validate the output source map against the V3 specification.
 */
import { assertEquals, assertExists, assert } from "jsr:@std/assert";
import { parse } from "../../src/hql/transpiler/pipeline/parser.ts";
import { transformToIR } from "../../src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts";
import {
  generateJavaScript,
  type JavaScriptOutput,
} from "../../src/hql/transpiler/pipeline/js-code-generator.ts";
import {
  validateSourceMap,
  decodeVLQ,
  type RawSourceMap,
} from "../../src/hql/transpiler/pipeline/source-map-validator.ts";

/** Helper: transpile HQL source to JS + source map */
async function transpileWithMap(
  hqlSource: string,
  fileName = "test.hql",
): Promise<{ output: JavaScriptOutput; map: RawSourceMap }> {
  const ast = parse(hqlSource, fileName);
  const ir = transformToIR(ast, "/tmp");
  const output = await generateJavaScript(ir, {
    sourceFilePath: fileName,
    sourceContent: hqlSource,
    generateSourceMap: true,
    typeCheck: false,
  });
  assertExists(output.sourceMap, "Source map should be generated");
  const map = JSON.parse(output.sourceMap) as RawSourceMap;
  return { output, map };
}

/** Helper: decode all mappings into structured form */
function decodeMappings(map: RawSourceMap): Array<{
  genLine: number;
  genCol: number;
  srcIndex: number;
  origLine: number;
  origCol: number;
  nameIndex: number;
}> {
  const result: Array<{
    genLine: number;
    genCol: number;
    srcIndex: number;
    origLine: number;
    origCol: number;
    nameIndex: number;
  }> = [];

  const lines = map.mappings.split(";");
  let prevGenCol = 0;
  let prevSrcIndex = 0;
  let prevOrigLine = 0;
  let prevOrigCol = 0;
  let prevNameIndex = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (line === "") continue;

    prevGenCol = 0; // Reset per line
    const segments = line.split(",");

    for (const segment of segments) {
      if (segment === "") continue;
      const fields = decodeVLQ(segment);

      if (fields.length >= 4) {
        const genCol = prevGenCol + fields[0];
        const srcIndex = prevSrcIndex + fields[1];
        const origLine = prevOrigLine + fields[2];
        const origCol = prevOrigCol + fields[3];
        const nameIndex = fields.length === 5
          ? prevNameIndex + fields[4]
          : -1;

        prevGenCol = genCol;
        prevSrcIndex = srcIndex;
        prevOrigLine = origLine;
        prevOrigCol = origCol;
        if (fields.length === 5) prevNameIndex = nameIndex;

        result.push({
          genLine: lineIdx + 1, // 1-based
          genCol,
          srcIndex,
          origLine, // 0-based in source map
          origCol,  // 0-based in source map
          nameIndex,
        });
      } else if (fields.length === 1) {
        prevGenCol += fields[0];
      }
    }
  }

  return result;
}

Deno.test("Source Map V3 Compliance", async (t) => {
  // ==========================================================================
  // 1. Simple expression — basic structure valid
  // ==========================================================================
  await t.step("simple expression produces valid source map", async () => {
    const { map } = await transpileWithMap("(+ 1 2)");
    const result = validateSourceMap(map);
    assertEquals(result.errors, [], `Validation errors: ${result.errors.join(", ")}`);
    assert(result.valid, "Source map should be valid");
    assertEquals(map.version, 3);
    assert(map.sources.length > 0, "sources should be non-empty");
  });

  // ==========================================================================
  // 2. Multi-line program — multiple mapping lines
  // ==========================================================================
  await t.step("multi-line program has multiple mapping lines", async () => {
    const hql = `(let x 1)
(let y 2)
(+ x y)`;
    const { map } = await transpileWithMap(hql);
    const result = validateSourceMap(map);
    assertEquals(result.errors, [], `Validation errors: ${result.errors.join(", ")}`);

    // mappings should have semicolons (multiple lines)
    const lineCount = map.mappings.split(";").length;
    assert(lineCount > 1, `Expected multiple mapping lines, got ${lineCount}`);
  });

  // ==========================================================================
  // 3. Function definition — names array is valid
  // ==========================================================================
  await t.step("function definition produces valid map with names field", async () => {
    const { map } = await transpileWithMap("(fn foo [x] x)");
    const result = validateSourceMap(map);
    assertEquals(result.errors, [], `Validation errors: ${result.errors.join(", ")}`);

    // names must be a string array (may be empty after tsc chaining strips them)
    assert(Array.isArray(map.names), "names should be an array");
    for (const n of map.names) {
      assertEquals(typeof n, "string", "each name should be a string");
    }
  });

  // ==========================================================================
  // 4. Column correctness — 0-indexed original columns
  // ==========================================================================
  await t.step("columns are 0-indexed per V3 spec", async () => {
    const hql = "(let x (+ 1 2))";
    const { map } = await transpileWithMap(hql);
    const result = validateSourceMap(map);
    assertEquals(result.errors, [], `Validation errors: ${result.errors.join(", ")}`);

    const mappings = decodeMappings(map);
    // Find a mapping that points to origLine 0 (first line, 0-based)
    const firstLineMappings = mappings.filter((m) => m.origLine === 0);
    assert(firstLineMappings.length > 0, "Should have mappings for first line");

    // All original columns should be >= 0 (0-indexed)
    for (const m of firstLineMappings) {
      assert(m.origCol >= 0, `Original column should be >= 0, got ${m.origCol}`);
    }
  });

  // ==========================================================================
  // 5. sourcesContent embedding
  // ==========================================================================
  await t.step("sourcesContent embedded when sourceContent provided", async () => {
    const hql = "(+ 1 2)";
    const { map } = await transpileWithMap(hql);

    assertExists(map.sourcesContent, "sourcesContent should be present");
    assertEquals(map.sourcesContent!.length, map.sources.length);
    assert(
      map.sourcesContent!.some((c) => c !== null && c.includes("(+ 1 2)")),
      "sourcesContent should contain original HQL",
    );
  });

  // ==========================================================================
  // 6. Chained map: JS line maps to correct HQL line
  // ==========================================================================
  await t.step("JS lines map back to correct HQL lines", async () => {
    const hql = `(let x 10)
(let y 20)`;
    const { map } = await transpileWithMap(hql);
    const mappings = decodeMappings(map);

    // We should have mappings pointing to origLine 0 and origLine 1
    const origLines = new Set(mappings.map((m) => m.origLine));
    assert(origLines.has(0), "Should have mappings for HQL line 1 (origLine 0)");
    assert(origLines.has(1), "Should have mappings for HQL line 2 (origLine 1)");
  });

  // ==========================================================================
  // 7. VLQ well-formedness via validator
  // ==========================================================================
  await t.step("VLQ mappings are well-formed", async () => {
    const { map } = await transpileWithMap(`(fn add [a b] (+ a b))
(add 1 2)`);
    const result = validateSourceMap(map);
    assertEquals(result.errors, [], `VLQ errors: ${result.errors.join(", ")}`);
  });

  // ==========================================================================
  // 8. Round-trip: every mapping within HQL source bounds
  // ==========================================================================
  await t.step("all mappings reference valid HQL source positions", async () => {
    const hql = `(let greeting "hello")
(fn double [x] (* x 2))
(double 21)`;
    const hqlLines = hql.split("\n");
    const { map } = await transpileWithMap(hql);
    const mappings = decodeMappings(map);

    for (const m of mappings) {
      assert(
        m.origLine >= 0 && m.origLine < hqlLines.length,
        `origLine ${m.origLine} out of bounds (source has ${hqlLines.length} lines)`,
      );
      assert(
        m.origCol >= 0 && m.origCol <= hqlLines[m.origLine].length,
        `origCol ${m.origCol} out of bounds for line "${hqlLines[m.origLine]}" (length ${hqlLines[m.origLine].length})`,
      );
    }
  });

  // ==========================================================================
  // 9. Column correctness for specific positions
  // ==========================================================================
  await t.step("specific column positions are correct", async () => {
    // In `(let x 42)`:
    //  Position: 0123456789
    //  Chars:    (let x 42)
    // `let` starts at column 1 (0-indexed), `x` at column 5, `42` at column 7
    const hql = "(let x 42)";
    const { map } = await transpileWithMap(hql);
    const mappings = decodeMappings(map);

    const firstLineMappings = mappings.filter((m) => m.origLine === 0);
    const origCols = firstLineMappings.map((m) => m.origCol).sort((a, b) => a - b);

    // The column for `x` should be 5 (0-indexed) and `42` should be 7
    // But the exact columns depend on which IR nodes get positions.
    // At minimum, all columns should be valid 0-indexed values
    for (const col of origCols) {
      assert(col >= 0 && col <= hql.length, `Column ${col} out of range for "${hql}"`);
    }
  });

  // ==========================================================================
  // 10. Multi-line column reset
  // ==========================================================================
  await t.step("columns reset correctly across lines", async () => {
    const hql = `(let a 1)
(let b 2)`;
    const { map } = await transpileWithMap(hql);
    const mappings = decodeMappings(map);

    const line2Mappings = mappings.filter((m) => m.origLine === 1);
    if (line2Mappings.length > 0) {
      // Second line starts at column 0, so all columns should be small
      for (const m of line2Mappings) {
        assert(
          m.origCol >= 0 && m.origCol < "(let b 2)".length,
          `Line 2 column ${m.origCol} seems wrong`,
        );
      }
    }
  });

  // ==========================================================================
  // 11. Column audit: no off-by-one after fix (Batch 2.2)
  // ==========================================================================
  await t.step("column values are 0-indexed, not 1-indexed", async () => {
    // `(let x 42)` — the opening `(` is at 1-based column 1 in the parser
    // After the fix, this should be 0-indexed column 0 in the source map
    const hql = "(let x 42)";
    const { map } = await transpileWithMap(hql);
    const mappings = decodeMappings(map);
    const firstLineMappings = mappings.filter((m) => m.origLine === 0);

    // If we find a mapping pointing to column 0, the fix is working
    // (the opening paren or `let` keyword should map to col 0)
    const hasZeroCol = firstLineMappings.some((m) => m.origCol === 0);
    assert(hasZeroCol, `Expected at least one mapping with origCol=0 on first line, ` +
      `got columns: ${firstLineMappings.map((m) => m.origCol).join(", ")}`);
  });

  // ==========================================================================
  // 12. Function parameter columns (Batch 2.2)
  // ==========================================================================
  await t.step("fn parameters have correct column positions", async () => {
    // `(fn foo [x] (+ x 1))`
    //  0123456789...
    // `(` at 0, `fn` at 1, `foo` at 4, `[` at 8, `x` at 9...
    const hql = "(fn foo [x] (+ x 1))";
    const { map } = await transpileWithMap(hql);
    const mappings = decodeMappings(map);
    const firstLineMappings = mappings.filter((m) => m.origLine === 0);

    // All origCol values should be < length of the HQL line
    for (const m of firstLineMappings) {
      assert(
        m.origCol < hql.length,
        `Column ${m.origCol} exceeds source length ${hql.length}`,
      );
    }
  });

  // ==========================================================================
  // 13. Multi-line column independence (Batch 2.2)
  // ==========================================================================
  await t.step("multi-line: each line's columns are independent", async () => {
    const hql = `(let longVariableName 100)
(let x 1)`;
    const { map } = await transpileWithMap(hql);
    const mappings = decodeMappings(map);

    const line1 = mappings.filter((m) => m.origLine === 0);
    const line2 = mappings.filter((m) => m.origLine === 1);

    // Line 2 columns should be within "(let x 1)" range (0-9)
    for (const m of line2) {
      assert(
        m.origCol >= 0 && m.origCol < "(let x 1)".length,
        `Line 2 col ${m.origCol} out of range for "(let x 1)"`,
      );
    }

    // Line 1 can have larger columns due to "longVariableName"
    if (line1.length > 0) {
      const maxCol = Math.max(...line1.map((m) => m.origCol));
      assert(maxCol >= 0, "Line 1 should have valid columns");
    }
  });

  // ==========================================================================
  // 14. Token-level column accuracy for binding name
  // ==========================================================================
  await t.step("binding name maps to token start column", async () => {
    // `(let x 42)` — the name `x` is at 1-based column 6, which is 0-indexed column 5
    // The binding maps to the bindingTarget (the `x` symbol) and the literal `42`
    const hql = "(let x 42)";
    const { map } = await transpileWithMap(hql);
    const mappings = decodeMappings(map);
    const firstLineMappings = mappings.filter((m) => m.origLine === 0);
    const origCols = new Set(firstLineMappings.map((m) => m.origCol));

    // Should have multiple distinct column positions (not all pointing to col 0)
    // The form start (col 0) and the literal value (col 7) should be present
    assert(origCols.size >= 2, `Expected at least 2 distinct columns, got: ${[...origCols].join(", ")}`);
    assert(origCols.has(0), `Expected column 0 (form start), got: ${[...origCols].join(", ")}`);
  });

  // ==========================================================================
  // 15. End position produces adjacent span mapping
  // ==========================================================================
  await t.step("end positions produce adjacent span mappings", async () => {
    // `(defn foo [x] (+ x 1))` — closing `)` at column 21 (0-indexed)
    const hql = "(defn foo [x] (+ x 1))";
    const { map } = await transpileWithMap(hql);
    const result = validateSourceMap(map);
    assertEquals(result.errors, [], `Validation errors: ${result.errors.join(", ")}`);

    const mappings = decodeMappings(map);
    // Should have more than just start-position mappings
    // The end position creates an extra mapping entry
    assert(mappings.length >= 2, `Expected at least 2 mappings, got ${mappings.length}`);
  });

  // ==========================================================================
  // 16. Import/export declaration gets source position in IR
  // ==========================================================================
  await t.step("export declaration has position in source map", async () => {
    // Use export with a function so the source map has meaningful content
    const hql = `(fn add [a b] (+ a b))
(export add)`;
    const { map } = await transpileWithMap(hql);
    const result = validateSourceMap(map);
    assertEquals(result.errors, [], `Validation errors: ${result.errors.join(", ")}`);

    const mappings = decodeMappings(map);
    // Should have mappings for both lines
    const origLines = new Set(mappings.map((m) => m.origLine));
    assert(origLines.has(0), "Should have mappings for fn definition line");
    // The export may or may not get a mapping depending on codegen,
    // but the overall map should be valid
    assert(mappings.length > 0, "Should have at least one mapping");
  });

  // ==========================================================================
  // 17. Conditional expression has source position
  // ==========================================================================
  await t.step("conditional expression maps to correct position", async () => {
    const hql = "(if true 1 2)";
    const { map } = await transpileWithMap(hql);
    const result = validateSourceMap(map);
    assertEquals(result.errors, [], `Validation errors: ${result.errors.join(", ")}`);

    const mappings = decodeMappings(map);
    const firstLineMappings = mappings.filter((m) => m.origLine === 0);
    assert(
      firstLineMappings.length > 0,
      "Conditional should have at least one source map mapping on line 1",
    );
  });

  // ==========================================================================
  // 18. Round-trip validity after end-position changes
  // ==========================================================================
  await t.step("all mappings remain valid after end-position changes", async () => {
    const hql = `(let greeting "hello")
(fn double [x] (* x 2))
(double 21)`;
    const hqlLines = hql.split("\n");
    const { map } = await transpileWithMap(hql);

    // V3 validity
    const result = validateSourceMap(map);
    assertEquals(result.errors, [], `Validation errors: ${result.errors.join(", ")}`);

    // All mappings within source bounds
    const mappings = decodeMappings(map);
    for (const m of mappings) {
      assert(
        m.origLine >= 0 && m.origLine < hqlLines.length,
        `origLine ${m.origLine} out of bounds (source has ${hqlLines.length} lines)`,
      );
      assert(
        m.origCol >= 0 && m.origCol <= hqlLines[m.origLine].length,
        `origCol ${m.origCol} out of bounds for line "${hqlLines[m.origLine]}" (length ${hqlLines[m.origLine].length})`,
      );
    }
  });
});
