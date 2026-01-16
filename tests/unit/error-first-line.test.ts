/**
 * Test error on first line
 */

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { join } from "../../src/platform/platform.ts";
import hql from "../../mod.ts";
import { RuntimeError } from "../../src/common/error.ts";
import { makeTempDir, writeTextFile, remove } from "../../src/platform/platform.ts";

Deno.test("Error on line 1 of multi-line file", async () => {
  const code = `(let bad undefined_var)
(let x 10)
(let y 20)`;

  const tempDir = await makeTempDir({
    prefix: "hlvm-first-",
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
      console.log("Error reported on line:", error.sourceLocation.line);
      console.log("Expected: 1");

      assertEquals(
        error.sourceLocation.line,
        1,
        `Error should be on line 1, got ${error.sourceLocation.line}`
      );
    } else {
      throw error;
    }
  } finally {
    await remove(tempDir, { recursive: true });
  }
});
