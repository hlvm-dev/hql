// @ts-nocheck: Testing HQL package integration
// Test suite for @hlvm/fs package

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";
import { join } from "jsr:@std/path@1";

const TEST_DIR = await Deno.makeTempDir({ prefix: "hlvm-fs-test-" });

Deno.test("@hlvm/fs - write and read file", async () => {
  const testFile = join(TEST_DIR, "test1.txt");
  const code = `
    (import [write, read] from "@hlvm/fs")
    (var _ (write "${testFile}" "hello world"))
    (read "${testFile}")
  `;
  const result = await run(code);
  assertEquals(result, "hello world");
});

Deno.test("@hlvm/fs - exists? returns true", async () => {
  const testFile = join(TEST_DIR, "test2.txt");
  await Deno.writeTextFile(testFile, "content");

  const code = `
    (import [exists?] from "@hlvm/fs")
    (exists? "${testFile}")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hlvm/fs - exists? returns false", async () => {
  const testFile = join(TEST_DIR, "nonexistent.txt");

  const code = `
    (import [exists?] from "@hlvm/fs")
    (exists? "${testFile}")
  `;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("@hlvm/fs - remove file", async () => {
  const testFile = join(TEST_DIR, "test3.txt");
  await Deno.writeTextFile(testFile, "to be deleted");

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

Deno.test("@hlvm/fs - write overwrites existing", async () => {
  const testFile = join(TEST_DIR, "test4.txt");
  await Deno.writeTextFile(testFile, "old content");

  const code = `
    (import [write, read] from "@hlvm/fs")
    (var _ (write "${testFile}" "new content"))
    (read "${testFile}")
  `;
  const result = await run(code);
  assertEquals(result, "new content");
});

Deno.test("@hlvm/fs - multiple operations", async () => {
  const testFile = join(TEST_DIR, "test5.txt");

  // Check before write
  const beforeCode = `
    (import [exists?] from "@hlvm/fs")
    (exists? "${testFile}")
  `;
  const beforeWrite = await run(beforeCode);

  // Write file
  const writeCode = `
    (import [write] from "@hlvm/fs")
    (write "${testFile}" "test content")
  `;
  await run(writeCode);

  // Check after write
  const afterCode = `
    (import [exists?] from "@hlvm/fs")
    (exists? "${testFile}")
  `;
  const afterWrite = await run(afterCode);

  // Read content
  const readCode = `
    (import [read] from "@hlvm/fs")
    (read "${testFile}")
  `;
  const content = await run(readCode);

  assertEquals([beforeWrite, afterWrite, content], [false, true, "test content"]);
});

Deno.test("@hlvm/fs - read then use content", async () => {
  const testFile = join(TEST_DIR, "test6.txt");
  await Deno.writeTextFile(testFile, "hello world");

  // Read and verify content
  const readCode = `
    (import [read] from "@hlvm/fs")
    (read "${testFile}")
  `;
  const content = await run(readCode);
  assertEquals(content, "hello world");
});

// Cleanup
Deno.test("@hlvm/fs - cleanup test directory", async () => {
  await Deno.remove(TEST_DIR, { recursive: true });
  const exists = await Deno.stat(TEST_DIR).then(() => true).catch(() => false);
  assertEquals(exists, false);
});
