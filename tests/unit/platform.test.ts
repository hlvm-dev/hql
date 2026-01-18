/**
 * Unit tests for Platform Abstraction Layer
 * Tests: ensureDir behavior (especially file-blocks-directory case)
 */

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { getPlatform } from "../../src/platform/platform.ts";

const platform = getPlatform();

// ============================================================================
// ensureDir Tests
// ============================================================================

Deno.test("ensureDir: creates new directory", async () => {
  const tempDir = await platform.fs.makeTempDir({ prefix: "ensureDir-test-" });
  const testDir = platform.path.join(tempDir, "new-dir");

  try {
    await platform.fs.ensureDir(testDir);
    const stat = await platform.fs.stat(testDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    await platform.fs.remove(tempDir, { recursive: true });
  }
});

Deno.test("ensureDir: creates nested directories", async () => {
  const tempDir = await platform.fs.makeTempDir({ prefix: "ensureDir-test-" });
  const testDir = platform.path.join(tempDir, "a", "b", "c");

  try {
    await platform.fs.ensureDir(testDir);
    const stat = await platform.fs.stat(testDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    await platform.fs.remove(tempDir, { recursive: true });
  }
});

Deno.test("ensureDir: is idempotent (existing directory)", async () => {
  const tempDir = await platform.fs.makeTempDir({ prefix: "ensureDir-test-" });
  const testDir = platform.path.join(tempDir, "existing");

  try {
    // Create directory first
    await platform.fs.mkdir(testDir);

    // ensureDir should succeed without error
    await platform.fs.ensureDir(testDir);

    const stat = await platform.fs.stat(testDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    await platform.fs.remove(tempDir, { recursive: true });
  }
});

Deno.test("ensureDir: throws when file blocks directory path", async () => {
  const tempDir = await platform.fs.makeTempDir({ prefix: "ensureDir-test-" });
  const filePath = platform.path.join(tempDir, "blocking-file");

  try {
    // Create a FILE at the path where we want a directory
    await platform.fs.writeTextFile(filePath, "I am a file, not a directory");

    // ensureDir should throw NotADirectory error
    await assertRejects(
      async () => {
        await platform.fs.ensureDir(filePath);
      },
      Error,
      "a file exists at this path",
    );
  } finally {
    await platform.fs.remove(tempDir, { recursive: true });
  }
});

Deno.test("ensureDir: throws when file blocks nested directory path", async () => {
  const tempDir = await platform.fs.makeTempDir({ prefix: "ensureDir-test-" });
  const filePath = platform.path.join(tempDir, "parent");
  const nestedDir = platform.path.join(filePath, "child");

  try {
    // Create a FILE at the parent path
    await platform.fs.writeTextFile(filePath, "I am a file");

    // ensureDir should fail when trying to create nested directory
    await assertRejects(
      async () => {
        await platform.fs.ensureDir(nestedDir);
      },
      Error, // Deno throws NotADirectory when mkdir fails through a file
    );
  } finally {
    await platform.fs.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// exists Tests (sanity checks for platform abstraction)
// ============================================================================

Deno.test("exists: returns true for existing file", async () => {
  const tempDir = await platform.fs.makeTempDir({ prefix: "exists-test-" });
  const filePath = platform.path.join(tempDir, "test.txt");

  try {
    await platform.fs.writeTextFile(filePath, "content");
    const exists = await platform.fs.exists(filePath);
    assertEquals(exists, true);
  } finally {
    await platform.fs.remove(tempDir, { recursive: true });
  }
});

Deno.test("exists: returns false for non-existent path", async () => {
  const exists = await platform.fs.exists("/non/existent/path/12345");
  assertEquals(exists, false);
});

// ============================================================================
// stat Tests
// ============================================================================

Deno.test("stat: correctly identifies file", async () => {
  const tempDir = await platform.fs.makeTempDir({ prefix: "stat-test-" });
  const filePath = platform.path.join(tempDir, "test.txt");

  try {
    await platform.fs.writeTextFile(filePath, "content");
    const stat = await platform.fs.stat(filePath);
    assertEquals(stat.isFile, true);
    assertEquals(stat.isDirectory, false);
  } finally {
    await platform.fs.remove(tempDir, { recursive: true });
  }
});

Deno.test("stat: correctly identifies directory", async () => {
  const tempDir = await platform.fs.makeTempDir({ prefix: "stat-test-" });

  try {
    const stat = await platform.fs.stat(tempDir);
    assertEquals(stat.isFile, false);
    assertEquals(stat.isDirectory, true);
  } finally {
    await platform.fs.remove(tempDir, { recursive: true });
  }
});
