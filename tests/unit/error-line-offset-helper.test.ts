/**
 * Tests for correct line number reporting when helpers are injected
 *
 * When runtime helpers like __hql_get are injected at the top of generated code,
 * they shift all user code down by several lines. The lineOffset in the source map
 * must be correctly applied to report accurate error locations.
 */

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { join } from "../../src/platform/platform.ts";
import hql from "../../mod.ts";
import { RuntimeError } from "../../src/common/error.ts";
import { makeTempDir, writeTextFile, remove } from "../../src/platform/platform.ts";

Deno.test("Line offset: Error location with array access helper injection", async () => {
  // This code will trigger __hql_get helper injection
  // The error is on line 3
  const code = `(let data [1 2 3])
(let result (map (fn [x] (* x 2)) data))
(let bad (/ 10 undefined_var))`;

  const tempDir = await makeTempDir({
    prefix: "hlvm-offset-",
    
  });

  try {
    const filePath = join(tempDir, "test.hql");
    await writeTextFile(filePath, code);

    if (!hql.runFile) {
      throw new Error("hql.runFile is not available");
    }

    const error = await assertRejects(
      async () => await hql.runFile!(filePath),
      RuntimeError,
    );

    if (error instanceof RuntimeError) {
      console.log("Error location:", error.sourceLocation);
      console.log("Expected line: 3, Got line:", error.sourceLocation.line);

      // The error should be on line 3, NOT some inflated number like line 11
      assertEquals(
        error.sourceLocation.line,
        3,
        `Error should be on line 3, but was reported on line ${error.sourceLocation.line}. This indicates lineOffset is not being applied.`
      );
    } else {
      throw error;
    }
  } finally {
    await remove(tempDir, { recursive: true });
  }
});

Deno.test("Line offset: Error location with get/range/map helpers", async () => {
  // This code uses multiple features that inject helpers
  const code = `(let nums [1 2 3 4 5])
(let doubled (map (fn [n] (* n 2)) nums))
(let first (get nums 0))
(let bad_var undefined_thing)`;

  const tempDir = await makeTempDir({
    prefix: "hlvm-offset-",
    
  });

  try {
    const filePath = join(tempDir, "test2.hql");
    await writeTextFile(filePath, code);

    if (!hql.runFile) {
      throw new Error("hql.runFile is not available");
    }

    const error = await assertRejects(
      async () => await hql.runFile!(filePath),
      RuntimeError,
    );

    if (error instanceof RuntimeError) {
      console.log("Error location:", error.sourceLocation);
      console.log("Expected line: 4, Got line:", error.sourceLocation.line);

      // The error should be on line 4
      assertEquals(
        error.sourceLocation.line,
        4,
        `Error should be on line 4, but was reported on line ${error.sourceLocation.line}`
      );
    } else {
      throw error;
    }
  } finally {
    await remove(tempDir, { recursive: true });
  }
});

Deno.test("Line offset: Verify no helpers = no offset issues", async () => {
  // Simple code without helpers - this should already work
  const code = `(let x 10)
(let y 20)
(+ x undefined_var)`;

  const tempDir = await makeTempDir({
    prefix: "hlvm-no-helper-",
    
  });

  try {
    const filePath = join(tempDir, "simple.hql");
    await writeTextFile(filePath, code);

    if (!hql.runFile) {
      throw new Error("hql.runFile is not available");
    }

    const error = await assertRejects(
      async () => await hql.runFile!(filePath),
      RuntimeError,
    );

    if (error instanceof RuntimeError) {
      console.log("Simple case - Error location:", error.sourceLocation);

      // The error should be on line 3
      assertEquals(
        error.sourceLocation.line,
        3,
        `Error should be on line 3, got ${error.sourceLocation.line}`
      );
    } else {
      throw error;
    }
  } finally {
    await remove(tempDir, { recursive: true });
  }
});
