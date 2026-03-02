/**
 * Tests for hlvm-cache-tracker import rewriting behavior.
 */

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  getImportMapping,
  processJavaScriptFile,
} from "../../../src/common/hlvm-cache-tracker.ts";

Deno.test(
  "processJavaScriptFile - rewrites local http.ts imports and preserves remote URL imports",
  async () => {
    const platform = getPlatform();
    const tempDir = await platform.fs.makeTempDir({
      prefix: "hlvm-cache-tracker-test-",
    });
    const entryPath = platform.path.join(tempDir, "entry.js");
    const localTsPath = platform.path.join(tempDir, "http.ts");

    try {
      await platform.fs.writeTextFile(localTsPath, "export default 42;\n");
      await platform.fs.writeTextFile(
        entryPath,
        [
          'import remote from "https://example.com/mod.ts";',
          'import local from "http.ts";',
          "export { remote, local };",
        ].join("\n"),
      );

      await processJavaScriptFile(entryPath);

      const cachedEntryPath = getImportMapping(entryPath);
      assert(cachedEntryPath, "Expected cached path to be registered");

      const cachedContent = await platform.fs.readTextFile(cachedEntryPath);
      assertStringIncludes(
        cachedContent,
        'import remote from "https://example.com/mod.ts";',
      );
      assert(
        /import local from ".*\.hlvm-cache.*http\.ts";/.test(cachedContent),
        `Expected local import to be rewritten to cached path, got:\n${cachedContent}`,
      );
      assertEquals(
        cachedContent.includes('import local from "http.ts";'),
        false,
      );
    } finally {
      await platform.fs.remove(tempDir, { recursive: true });
    }
  },
);
