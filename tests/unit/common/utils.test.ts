/**
 * Tests for common utils.
 */

import { assertEquals } from "jsr:@std/assert";
import { findActualFilePath } from "../../../src/common/utils.ts";
import { getPlatform, setPlatform } from "../../../src/platform/platform.ts";

Deno.test(
  "findActualFilePath - fallback uses platform basename for Windows-style input",
  async () => {
    const originalPlatform = getPlatform();
    const fs = originalPlatform.fs;
    const path = originalPlatform.path;
    const tempDir = await fs.makeTempDir({ prefix: "hlvm-find-path-test-" });
    const fallbackPath = path.join(tempDir, "target.hql");

    await fs.writeTextFile(fallbackPath, "(+ 1 2)");

    const windowsAwarePlatform = {
      ...originalPlatform,
      path: {
        ...originalPlatform.path,
        basename: (value: string, ext?: string) =>
          originalPlatform.path.basename(value.replace(/\\/g, "/"), ext),
      },
      process: {
        ...originalPlatform.process,
        cwd: () => tempDir,
      },
    };

    setPlatform(windowsAwarePlatform);
    try {
      const actualPath = await findActualFilePath(
        "missing\\nested\\target.hql",
      );
      assertEquals(actualPath, fallbackPath);
    } finally {
      setPlatform(originalPlatform);
      await fs.remove(tempDir, { recursive: true });
    }
  },
);
