import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { getPlatform } from "../../src/platform/platform.ts";
import hql from "../../mod.ts";
import {
  invalidateSourceMapCache,
} from "../../src/hql/transpiler/pipeline/source-map-support.ts";
import { withTempDir } from "./helpers.ts";

/**
 * Integration tests for HQL Tooling API and Stability Improvements
 */

// ============================================================================
// TEST 1: CACHE INVALIDATION (Long-Running Process Stability)
// ============================================================================

Deno.test("Tooling: Cache invalidation updates source maps for changed files", async () => {
  await withTempDir(async (tempDir) => {
    const platform = getPlatform();
    const filePath = platform.path.join(tempDir, "dynamic.hql");

    // Create file with Version A
    const codeA = `(print "Version A")
(fn test [] (+ 1 2))
(test)`;
    await platform.fs.writeTextFile(filePath, codeA);

    // Compile Version A
    await hql.runFile!(filePath);
    const resultA = await hql.transpile(codeA, {
      currentFile: filePath,
      generateSourceMap: true
    });

    if (typeof resultA === 'string') throw new Error("Expected object output");

    // Create file with Version B (5 lines inserted at top so 'test' function moves down)
    const codeB = `// New line 1
// New line 2
// New line 3
// New line 4
// New line 5
(print "Version B")
(fn test [] (+ 1 2))
(test)`;
    await platform.fs.writeTextFile(filePath, codeB);

    // Invalidate cache so next compile produces a fresh source map
    invalidateSourceMapCache();

    // Compile Version B
    const resultB = await hql.transpile(codeB, {
      currentFile: filePath,
      generateSourceMap: true
    });

    if (typeof resultB === 'string') throw new Error("Expected object output");

    // Verify maps are different
    assertNotEquals(resultA.sourceMap, resultB.sourceMap, "Source maps should differ after file change");

    const mapA = JSON.parse(resultA.sourceMap!);
    const mapB = JSON.parse(resultB.sourceMap!);
    assertNotEquals(mapA.mappings, mapB.mappings);
  });
});

// ============================================================================
// TEST 2: ZERO-CONFIG DEFAULTS (Ease of Use)
// ============================================================================

Deno.test("Tooling: hql.transpile defaults to generating source maps for string inputs", async () => {
  const code = `(+ 1 2)`;

  const explicitResult = await hql.transpile(code, { generateSourceMap: true });

  if (typeof explicitResult === 'string') {
    throw new Error("hql.transpile(..., {generateSourceMap: true}) returned string, expected object");
  }

  if (!explicitResult.sourceMap) {
    throw new Error("Source map missing even when explicitly requested");
  }

  // Verify map structure
  const map = JSON.parse(explicitResult.sourceMap);
  assertEquals(map.version, 3);
});
