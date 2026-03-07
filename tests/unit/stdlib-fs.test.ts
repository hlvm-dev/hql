// @ts-nocheck: Testing HQL package integration
// Test suite for @hlvm/fs package

import { assertEquals } from "jsr:@std/assert@1";
import { run, withTempDir } from "./helpers.ts";
import { join } from "jsr:@std/path@1";
import { getPlatform } from "../../src/platform/platform.ts";

Deno.test("@hlvm/fs - write and read file", async () => {
  await withTempDir(async (testDir) => {
    const testFile = join(testDir, "test1.txt");
    const code = `
      (import [write, read] from "@hlvm/fs")
      (var _ (write "${testFile}" "hello world"))
      (read "${testFile}")
    `;
    const result = await run(code);
    assertEquals(result, "hello world");
  });
});

Deno.test("@hlvm/fs - exists? returns true", async () => {
  await withTempDir(async (testDir) => {
    const testFile = join(testDir, "test2.txt");
    await getPlatform().fs.writeTextFile(testFile, "content");

    const code = `
      (import [exists?] from "@hlvm/fs")
      (exists? "${testFile}")
    `;
    const result = await run(code);
    assertEquals(result, true);
  });
});

Deno.test("@hlvm/fs - exists? returns false", async () => {
  await withTempDir(async (testDir) => {
    const testFile = join(testDir, "nonexistent.txt");

    const code = `
      (import [exists?] from "@hlvm/fs")
      (exists? "${testFile}")
    `;
    const result = await run(code);
    assertEquals(result, false);
  });
});

Deno.test("@hlvm/fs - remove file", async () => {
  await withTempDir(async (testDir) => {
    const testFile = join(testDir, "test3.txt");
    await getPlatform().fs.writeTextFile(testFile, "to be deleted");

    // First remove the file
    const removeCode = `
      (import [remove] from "@hlvm/fs")
      (remove "${testFile}")
    `;
    await run(removeCode);

    // Then check it doesn't exist
    const existsCode = `
      (import [exists?] from "@hlvm/fs")
      (exists? "${testFile}")
    `;
    const result = await run(existsCode);
    assertEquals(result, false);
  });
});

Deno.test("@hlvm/fs - write overwrites existing", async () => {
  await withTempDir(async (testDir) => {
    const testFile = join(testDir, "test4.txt");
    await getPlatform().fs.writeTextFile(testFile, "old content");

    const code = `
      (import [write, read] from "@hlvm/fs")
      (var _ (write "${testFile}" "new content"))
      (read "${testFile}")
    `;
    const result = await run(code);
    assertEquals(result, "new content");
  });
});

