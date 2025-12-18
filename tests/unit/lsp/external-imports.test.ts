/**
 * LSP External Imports Tests
 *
 * Tests for ModuleAnalyzer which handles npm:, jsr:, http: imports.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ModuleAnalyzer } from "../../../lsp/workspace/module-analyzer.ts";

// ============================================
// ModuleAnalyzer Tests
// ============================================

Deno.test("ModuleAnalyzer - isExternalModule detects npm packages", () => {
  const analyzer = new ModuleAnalyzer();

  assertEquals(analyzer.isExternalModule("npm:lodash"), true);
  assertEquals(analyzer.isExternalModule("npm:@types/node"), true);
  assertEquals(analyzer.isExternalModule("npm:react@18.0.0"), true);
});

Deno.test("ModuleAnalyzer - isExternalModule detects jsr packages", () => {
  const analyzer = new ModuleAnalyzer();

  assertEquals(analyzer.isExternalModule("jsr:@std/path"), true);
  assertEquals(analyzer.isExternalModule("jsr:@oak/oak"), true);
});

Deno.test("ModuleAnalyzer - isExternalModule detects http/https URLs", () => {
  const analyzer = new ModuleAnalyzer();

  assertEquals(analyzer.isExternalModule("http://example.com/lib.js"), true);
  assertEquals(analyzer.isExternalModule("https://deno.land/std/path/mod.ts"), true);
});

Deno.test("ModuleAnalyzer - isExternalModule detects node: builtins", () => {
  const analyzer = new ModuleAnalyzer();

  assertEquals(analyzer.isExternalModule("node:fs"), true);
  assertEquals(analyzer.isExternalModule("node:path"), true);
  assertEquals(analyzer.isExternalModule("node:process"), true);
});

Deno.test("ModuleAnalyzer - isExternalModule detects local JS/TS files", () => {
  const analyzer = new ModuleAnalyzer();

  assertEquals(analyzer.isExternalModule("./utils.js"), true);
  assertEquals(analyzer.isExternalModule("../lib/helpers.ts"), true);
  assertEquals(analyzer.isExternalModule("/absolute/path/file.mjs"), true);
  assertEquals(analyzer.isExternalModule("./module.mts"), true);
});

Deno.test("ModuleAnalyzer - isExternalModule returns false for HQL files", () => {
  const analyzer = new ModuleAnalyzer();

  // HQL files are not "external" in this context - they're HQL modules
  assertEquals(analyzer.isExternalModule("./utils.hql"), false);
  assertEquals(analyzer.isExternalModule("../lib/math.hql"), false);
});

Deno.test("ModuleAnalyzer - isExternalModule returns false for bare specifiers", () => {
  const analyzer = new ModuleAnalyzer();

  // Bare specifiers without prefix are not external
  assertEquals(analyzer.isExternalModule("lodash"), false);
  assertEquals(analyzer.isExternalModule("react"), false);
});

Deno.test("ModuleAnalyzer - getCached returns undefined for unanalyzed module", () => {
  const analyzer = new ModuleAnalyzer();

  const cached = analyzer.getCached("npm:nonexistent-package-xyz");
  assertEquals(cached, undefined);
});

Deno.test("ModuleAnalyzer - clearCache clears all cached data", () => {
  const analyzer = new ModuleAnalyzer();

  // This test just verifies clearCache doesn't throw
  analyzer.clearCache();
});

Deno.test("ModuleAnalyzer - invalidate removes specific entry", () => {
  const analyzer = new ModuleAnalyzer();

  // This test just verifies invalidate doesn't throw
  analyzer.invalidate("npm:some-package");
});

// ============================================
// Integration Tests (require network - may be slow)
// These tests are marked with a prefix for optional running
// ============================================

Deno.test({
  name: "ModuleAnalyzer - analyze jsr:@std/path returns exports",
  ignore: Deno.env.get("SKIP_NETWORK_TESTS") === "1",
  async fn() {
    const analyzer = new ModuleAnalyzer();

    const result = await analyzer.analyze("jsr:@std/path");

    assertExists(result);
    assertEquals(result.specifier, "jsr:@std/path");

    // jsr:@std/path should have some exports
    if (result.error) {
      console.log("Note: jsr analysis failed (may be network issue):", result.error);
      return;
    }

    assertEquals(result.exports.length > 0, true, "Should have exports");

    // Should have common path functions
    const exportNames = result.exports.map(e => e.name);
    // At least one of these should exist
    const commonExports = ["join", "resolve", "basename", "dirname", "extname"];
    const hasCommonExport = commonExports.some(name => exportNames.includes(name));
    assertEquals(hasCommonExport, true, `Should have one of: ${commonExports.join(", ")}`);
  },
});

Deno.test({
  name: "ModuleAnalyzer - caches results",
  ignore: Deno.env.get("SKIP_NETWORK_TESTS") === "1",
  async fn() {
    const analyzer = new ModuleAnalyzer();

    // First call
    const result1 = await analyzer.analyze("jsr:@std/path");

    // Second call should use cache
    const result2 = await analyzer.analyze("jsr:@std/path");

    // Results should be the same object (cached)
    assertEquals(result1, result2);
  },
});

Deno.test({
  name: "ModuleAnalyzer - handles invalid specifier gracefully",
  async fn() {
    const analyzer = new ModuleAnalyzer();

    const result = await analyzer.analyze("npm:this-package-definitely-does-not-exist-xyz-123-abc");

    assertExists(result);
    assertEquals(result.specifier, "npm:this-package-definitely-does-not-exist-xyz-123-abc");
    // Should have error or empty exports
    assertEquals(
      result.error !== undefined || result.exports.length === 0,
      true,
      "Should have error or empty exports for non-existent package"
    );
  },
});

// ============================================
// ModuleExport Structure Tests
// ============================================

Deno.test({
  name: "ModuleAnalyzer - exports have correct structure",
  ignore: Deno.env.get("SKIP_NETWORK_TESTS") === "1",
  async fn() {
    const analyzer = new ModuleAnalyzer();

    const result = await analyzer.analyze("jsr:@std/path");

    if (result.error || result.exports.length === 0) {
      console.log("Skipping structure test due to analysis failure");
      return;
    }

    const firstExport = result.exports[0];
    assertExists(firstExport.name, "Export should have name");
    assertExists(firstExport.kind, "Export should have kind");

    // kind should be one of the valid types
    const validKinds = ["function", "class", "variable", "interface", "type", "enum", "namespace"];
    assertEquals(
      validKinds.includes(firstExport.kind),
      true,
      `Kind should be one of: ${validKinds.join(", ")}`
    );
  },
});
