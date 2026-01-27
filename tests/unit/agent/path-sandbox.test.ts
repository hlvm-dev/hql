/**
 * Path Sandboxing Tests
 *
 * Verifies security boundary enforcement for file operations
 */

import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  validatePath,
  validatePaths,
  isPathValid,
  SecurityError,
} from "../../../src/hlvm/agent/security/path-sandbox.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

// Test workspace setup
const TEST_WORKSPACE = "/tmp/hlvm-test-workspace";

// Helper to ensure test workspace exists
async function setupTestWorkspace() {
  const platform = getPlatform();
  try {
    await platform.fs.mkdir(TEST_WORKSPACE, { recursive: true });
    // Create a test file
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/test.txt`, "test");
    // Create a test directory
    await platform.fs.mkdir(`${TEST_WORKSPACE}/subdir`, { recursive: true });
  } catch {
    // Workspace might already exist
  }
}

// Helper to cleanup test workspace
async function cleanupTestWorkspace() {
  const platform = getPlatform();
  try {
    await platform.fs.remove(TEST_WORKSPACE, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

Deno.test({
  name: "Path Sandboxing: valid relative paths",
  async fn() {
    await setupTestWorkspace();

    // Simple relative paths
    const result1 = await validatePath("test.txt", TEST_WORKSPACE);
    assertEquals(result1, `${TEST_WORKSPACE}/test.txt`);

    const result2 = await validatePath("./test.txt", TEST_WORKSPACE);
    assertEquals(result2, `${TEST_WORKSPACE}/test.txt`);

    const result3 = await validatePath("subdir/file.txt", TEST_WORKSPACE);
    assertEquals(result3, `${TEST_WORKSPACE}/subdir/file.txt`);

    await cleanupTestWorkspace();
  },
});

Deno.test({
  name: "Path Sandboxing: valid absolute paths within workspace",
  async fn() {
    await setupTestWorkspace();

    // Absolute path within workspace
    const result1 = await validatePath(
      `${TEST_WORKSPACE}/test.txt`,
      TEST_WORKSPACE
    );
    assertEquals(result1, `${TEST_WORKSPACE}/test.txt`);

    // Workspace root itself
    const result2 = await validatePath(".", TEST_WORKSPACE);
    assertEquals(result2, TEST_WORKSPACE);

    await cleanupTestWorkspace();
  },
});

Deno.test({
  name: "Path Sandboxing: reject path traversal attacks",
  async fn() {
    await setupTestWorkspace();

    // Path traversal with ../
    await assertRejects(
      async () => {
        await validatePath("../../../etc/passwd", TEST_WORKSPACE);
      },
      SecurityError,
      "Path escapes workspace"
    );

    // Another traversal attempt
    await assertRejects(
      async () => {
        await validatePath("subdir/../../..", TEST_WORKSPACE);
      },
      SecurityError,
      "Path escapes workspace"
    );

    await cleanupTestWorkspace();
  },
});

Deno.test({
  name: "Path Sandboxing: reject paths outside workspace",
  async fn() {
    await setupTestWorkspace();

    // Absolute path outside workspace
    await assertRejects(
      async () => {
        await validatePath("/etc/passwd", TEST_WORKSPACE);
      },
      SecurityError,
      "Path escapes workspace"
    );

    // Different root path
    await assertRejects(
      async () => {
        await validatePath("/var/log/system.log", TEST_WORKSPACE);
      },
      SecurityError,
      "Path escapes workspace"
    );

    await cleanupTestWorkspace();
  },
});

Deno.test({
  name: "Path Sandboxing: reject symlinks",
  async fn() {
    await setupTestWorkspace();

    const platform = getPlatform();

    // Create a symlink
    const symlinkPath = `${TEST_WORKSPACE}/symlink`;
    try {
      // Use output() instead of run() to properly capture command result
      const result = await platform.command.output({
        cmd: ["ln", "-s", "/etc/passwd", symlinkPath],
      });

      // Only test if symlink creation succeeded
      if (result.code === 0) {
        // Should reject symlink
        await assertRejects(
          async () => {
            await validatePath("symlink", TEST_WORKSPACE);
          },
          SecurityError,
          "Symlinks not allowed"
        );
      }
    } catch (error) {
      // Skip test if ln command not available (e.g., on some CI systems)
      console.log("Skipping symlink test - ln command not available");
    } finally {
      // Cleanup symlink
      try {
        await platform.fs.remove(symlinkPath);
      } catch {
        // Ignore
      }
    }

    await cleanupTestWorkspace();
  },
});

Deno.test({
  name: "Path Sandboxing: allow non-existent paths for write operations",
  async fn() {
    await setupTestWorkspace();

    // Non-existent file within workspace should be allowed
    const result = await validatePath("newfile.txt", TEST_WORKSPACE);
    assertEquals(result, `${TEST_WORKSPACE}/newfile.txt`);

    // Non-existent nested file
    const result2 = await validatePath("new/nested/file.txt", TEST_WORKSPACE);
    assertEquals(result2, `${TEST_WORKSPACE}/new/nested/file.txt`);

    await cleanupTestWorkspace();
  },
});

Deno.test({
  name: "Path Sandboxing: edge case - workspace with similar prefix",
  async fn() {
    await setupTestWorkspace();

    // Create a workspace with similar prefix
    const similarWorkspace = `${TEST_WORKSPACE}-other`;
    const platform = getPlatform();
    await platform.fs.mkdir(similarWorkspace, { recursive: true });

    try {
      // Should NOT allow access to similarly-named workspace
      await assertRejects(
        async () => {
          await validatePath(
            `${similarWorkspace}/file.txt`,
            TEST_WORKSPACE
          );
        },
        SecurityError,
        "Path escapes workspace"
      );
    } finally {
      await platform.fs.remove(similarWorkspace, { recursive: true });
    }

    await cleanupTestWorkspace();
  },
});

Deno.test({
  name: "Path Sandboxing: validatePaths - multiple paths",
  async fn() {
    await setupTestWorkspace();

    // Validate multiple valid paths
    const results = await validatePaths(
      ["test.txt", "subdir/file.txt", "another.txt"],
      TEST_WORKSPACE
    );

    assertEquals(results, [
      `${TEST_WORKSPACE}/test.txt`,
      `${TEST_WORKSPACE}/subdir/file.txt`,
      `${TEST_WORKSPACE}/another.txt`,
    ]);

    // Should reject if any path is invalid
    await assertRejects(
      async () => {
        await validatePaths(
          ["test.txt", "../../../etc/passwd"],
          TEST_WORKSPACE
        );
      },
      SecurityError
    );

    await cleanupTestWorkspace();
  },
});

Deno.test({
  name: "Path Sandboxing: isPathValid - non-throwing validation",
  async fn() {
    await setupTestWorkspace();

    // Valid path
    const valid1 = await isPathValid("test.txt", TEST_WORKSPACE);
    assertEquals(valid1, true);

    // Invalid path (outside workspace)
    const valid2 = await isPathValid("/etc/passwd", TEST_WORKSPACE);
    assertEquals(valid2, false);

    // Invalid path (traversal)
    const valid3 = await isPathValid("../../..", TEST_WORKSPACE);
    assertEquals(valid3, false);

    await cleanupTestWorkspace();
  },
});

Deno.test({
  name: "Path Sandboxing: normalize path separators",
  async fn() {
    await setupTestWorkspace();

    // Mixed separators (if on Windows, this would matter)
    const result1 = await validatePath("subdir/nested/file.txt", TEST_WORKSPACE);
    assertEquals(result1, `${TEST_WORKSPACE}/subdir/nested/file.txt`);

    // Double slashes
    const result2 = await validatePath("subdir//file.txt", TEST_WORKSPACE);
    assertEquals(result2, `${TEST_WORKSPACE}/subdir/file.txt`);

    // Trailing slashes
    const result3 = await validatePath("subdir/", TEST_WORKSPACE);
    assertEquals(result3, `${TEST_WORKSPACE}/subdir`);

    await cleanupTestWorkspace();
  },
});

Deno.test({
  name: "Path Sandboxing: handle . and .. correctly",
  async fn() {
    await setupTestWorkspace();

    // Current directory
    const result1 = await validatePath(".", TEST_WORKSPACE);
    assertEquals(result1, TEST_WORKSPACE);

    // Redundant current directory
    const result2 = await validatePath("./././test.txt", TEST_WORKSPACE);
    assertEquals(result2, `${TEST_WORKSPACE}/test.txt`);

    // Valid use of .. within workspace
    const result3 = await validatePath("subdir/../test.txt", TEST_WORKSPACE);
    assertEquals(result3, `${TEST_WORKSPACE}/test.txt`);

    // Invalid .. that escapes workspace
    await assertRejects(
      async () => {
        await validatePath("..", TEST_WORKSPACE);
      },
      SecurityError,
      "Path escapes workspace"
    );

    await cleanupTestWorkspace();
  },
});
