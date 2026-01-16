/**
 * CRITICAL TEST: Verify error on middle line (not last line)
 * This tests if the fix is a real fix or just a heuristic that caps to file length
 */

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { join } from "../../src/platform/platform.ts";
import hql from "../../mod.ts";
import { RuntimeError } from "../../src/common/error.ts";
import { makeTempDir, writeTextFile, remove } from "../../src/platform/platform.ts";

Deno.test("CRITICAL: Error on line 2 of 4-line file", async () => {
  const code = `(let x 10)
(let bad undefined_var)
(let y 20)
(let z 30)`;

  const tempDir = await makeTempDir({
    prefix: "hlvm-middle-",
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
      console.log("Expected: 2");

      // The error should be on line 2, NOT capped to line 4
      assertEquals(
        error.sourceLocation.line,
        2,
        `If this fails with line=${error.sourceLocation.line}, then the fix is just capping to file length, not a real fix!`
      );
    } else {
      throw error;
    }
  } finally {
    await remove(tempDir, { recursive: true });
  }
});
