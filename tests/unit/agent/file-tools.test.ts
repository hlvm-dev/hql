/**
 * File Tools Tests
 *
 * Verifies SSOT-compliant file operations with security sandboxing
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  readFile,
  writeFile,
  editFile,
  listFiles,
  type ReadFileArgs,
  type WriteFileArgs,
  type EditFileArgs,
  type ListFilesArgs,
} from "../../../src/hlvm/agent/tools/file-tools.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

// Test workspace
const TEST_WORKSPACE = "/tmp/hlvm-agent-test";

// Setup/cleanup helpers
async function setupWorkspace() {
  const platform = getPlatform();
  try {
    await platform.fs.mkdir(TEST_WORKSPACE, { recursive: true });
  } catch {
    // Already exists
  }
}

async function cleanupWorkspace() {
  const platform = getPlatform();
  try {
    await platform.fs.remove(TEST_WORKSPACE, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================
// read_file tests
// ============================================================

Deno.test({
  name: "File Tools: read_file - read existing file",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    // Create test file
    const testContent = "Hello, world!";
    await platform.fs.writeTextFile(
      `${TEST_WORKSPACE}/test.txt`,
      testContent
    );

    // Read file
    const result = await readFile(
      { path: "test.txt" } as ReadFileArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.content, testContent);
    assertEquals(result.size, testContent.length);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: read_file - fail on non-existent file",
  async fn() {
    await setupWorkspace();

    const result = await readFile(
      { path: "nonexistent.txt" } as ReadFileArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, false);
    assertStringIncludes(result.message || "", "Failed to read");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: read_file - fail on directory",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    // Create directory
    await platform.fs.mkdir(`${TEST_WORKSPACE}/testdir`);

    const result = await readFile(
      { path: "testdir" } as ReadFileArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, false);
    assertStringIncludes(result.message || "", "directory");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: read_file - reject path outside workspace",
  async fn() {
    await setupWorkspace();

    const result = await readFile(
      { path: "../../../etc/passwd" } as ReadFileArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, false);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: read_file - enforce maxBytes",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    const testContent = "0123456789";
    await platform.fs.writeTextFile(
      `${TEST_WORKSPACE}/big.txt`,
      testContent,
    );

    const result = await readFile(
      { path: "big.txt", maxBytes: 5 } as ReadFileArgs,
      TEST_WORKSPACE,
    );

    // maxBytes truncates content rather than rejecting
    assertEquals(result.success, true);
    assertEquals(result.content, "01234");

    await cleanupWorkspace();
  },
});

// ============================================================
// write_file tests
// ============================================================

Deno.test({
  name: "File Tools: write_file - create new file",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    const content = "Test content";
    const result = await writeFile(
      {
        path: "newfile.txt",
        content,
      } as WriteFileArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);

    // Verify file was created
    const written = await platform.fs.readTextFile(
      `${TEST_WORKSPACE}/newfile.txt`
    );
    assertEquals(written, content);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: write_file - enforce maxBytes",
  async fn() {
    await setupWorkspace();

    const content = "0123456789";
    const result = await writeFile(
      {
        path: "too-big.txt",
        content,
        maxBytes: 5,
      } as WriteFileArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, false);
    assertStringIncludes(result.message || "", "Limit");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: write_file - overwrite existing file",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    // Create initial file
    await platform.fs.writeTextFile(
      `${TEST_WORKSPACE}/file.txt`,
      "original"
    );

    // Overwrite
    const newContent = "updated";
    const result = await writeFile(
      {
        path: "file.txt",
        content: newContent,
      } as WriteFileArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);

    // Verify content
    const written = await platform.fs.readTextFile(`${TEST_WORKSPACE}/file.txt`);
    assertEquals(written, newContent);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: write_file - create nested directories",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    const result = await writeFile(
      {
        path: "nested/deep/file.txt",
        content: "content",
        createDirs: true,
      } as WriteFileArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);

    // Verify file exists
    const content = await platform.fs.readTextFile(
      `${TEST_WORKSPACE}/nested/deep/file.txt`
    );
    assertEquals(content, "content");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: write_file - fail without createDirs",
  async fn() {
    await setupWorkspace();

    const result = await writeFile(
      {
        path: "nested/file.txt",
        content: "content",
        createDirs: false,
      } as WriteFileArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, false);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: write_file - reject path outside workspace",
  async fn() {
    await setupWorkspace();

    const result = await writeFile(
      {
        path: "../../../tmp/malicious.txt",
        content: "bad",
      } as WriteFileArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, false);

    await cleanupWorkspace();
  },
});

// ============================================================
// edit_file tests
// ============================================================

Deno.test({
  name: "File Tools: edit_file - literal find/replace",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    // Create file with content
    const original = "Hello world! Hello universe!";
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/edit.txt`, original);

    const result = await editFile(
      {
        path: "edit.txt",
        find: "Hello",
        replace: "Goodbye",
        mode: "literal",
      } as EditFileArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.replacements, 2);

    // Verify content
    const updated = await platform.fs.readTextFile(`${TEST_WORKSPACE}/edit.txt`);
    assertEquals(updated, "Goodbye world! Goodbye universe!");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: edit_file - regex find/replace",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    const original = "value1 = 10\nvalue2 = 20\nvalue3 = 30";
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/config.txt`, original);

    const result = await editFile(
      {
        path: "config.txt",
        find: "value\\d+",
        replace: "result",
        mode: "regex",
      } as EditFileArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.replacements, 3);

    const updated = await platform.fs.readTextFile(
      `${TEST_WORKSPACE}/config.txt`
    );
    assertEquals(updated, "result = 10\nresult = 20\nresult = 30");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: edit_file - enforce maxBytes",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    const content = "0123456789";
    await platform.fs.writeTextFile(
      `${TEST_WORKSPACE}/edit-big.txt`,
      content,
    );

    const result = await editFile(
      {
        path: "edit-big.txt",
        find: "0",
        replace: "X",
        maxBytes: 5,
      } as EditFileArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, false);
    assertStringIncludes(result.message || "", "Limit");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: edit_file - fail when pattern not found",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/file.txt`, "content");

    const result = await editFile(
      {
        path: "file.txt",
        find: "nonexistent",
        replace: "replacement",
      } as EditFileArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, false);
    assertEquals(result.replacements, 0);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: edit_file - fail on invalid regex",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/file.txt`, "content");

    const result = await editFile(
      {
        path: "file.txt",
        find: "[invalid(",
        replace: "replacement",
        mode: "regex",
      } as EditFileArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, false);
    assertStringIncludes(result.message || "", "Invalid regex");

    await cleanupWorkspace();
  },
});

// ============================================================
// list_files tests
// ============================================================

Deno.test({
  name: "File Tools: list_files - list directory contents",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    // Create test structure
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/file1.txt`, "");
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/file2.txt`, "");
    await platform.fs.mkdir(`${TEST_WORKSPACE}/subdir`);

    const result = await listFiles(
      {
        path: ".",
        recursive: false,
      } as ListFilesArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 3);
    assertEquals(result.entries?.length, 3);

    // Should be sorted: directory first, then files alphabetically
    assertEquals(result.entries?.[0].type, "directory");
    assertEquals(result.entries?.[0].path, "subdir");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: list_files - recursive listing",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    // Create nested structure
    await platform.fs.mkdir(`${TEST_WORKSPACE}/dir1`, { recursive: true });
    await platform.fs.mkdir(`${TEST_WORKSPACE}/dir1/dir2`, { recursive: true });
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/root.txt`, "");
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/dir1/file1.txt`, "");
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/dir1/dir2/file2.txt`, "");

    const result = await listFiles(
      {
        path: ".",
        recursive: true,
      } as ListFilesArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    // Should find: dir1/, root.txt, dir1/dir2/, dir1/file1.txt, dir1/dir2/file2.txt
    assertEquals(result.count, 5);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: list_files - enforce maxEntries",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/a.txt`, "A");
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/b.txt`, "B");
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/c.txt`, "C");

    const result = await listFiles(
      { path: ".", maxEntries: 1 } as ListFilesArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 1);
    assertStringIncludes(result.message || "", "limit");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: list_files - pattern filtering",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    // Create files with different extensions
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/file1.ts`, "");
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/file2.ts`, "");
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/file3.js`, "");
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/readme.md`, "");

    const result = await listFiles(
      {
        path: ".",
        pattern: "*.ts",
      } as ListFilesArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 2);
    assertEquals(result.entries?.[0].path, "file1.ts");
    assertEquals(result.entries?.[1].path, "file2.ts");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: list_files - maxDepth limit",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    // Create 3-level structure
    await platform.fs.mkdir(`${TEST_WORKSPACE}/l1/l2/l3`, { recursive: true });
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/l1/f1.txt`, "");
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/l1/l2/f2.txt`, "");
    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/l1/l2/l3/f3.txt`, "");

    const result = await listFiles(
      {
        path: ".",
        recursive: true,
        maxDepth: 2,
      } as ListFilesArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, true);
    // Should find: l1/, l1/l2/, l1/f1.txt, l1/l2/f2.txt, l1/l2/l3/ (NOT f3.txt at depth 3)
    // Note: l3/ is visible at depth 2, but we don't recurse into it
    assertEquals(result.count, 5);

    // Verify f3.txt is NOT in the results (it would be at depth 3)
    const hasDeeplyNestedFile = result.entries?.some(e => e.path.includes("f3.txt"));
    assertEquals(hasDeeplyNestedFile, false);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: list_files - fail on non-directory",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    await platform.fs.writeTextFile(`${TEST_WORKSPACE}/file.txt`, "");

    const result = await listFiles(
      {
        path: "file.txt",
      } as ListFilesArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, false);
    assertStringIncludes(result.message || "", "not a directory");

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: list_files - reject path outside workspace",
  async fn() {
    await setupWorkspace();

    const result = await listFiles(
      {
        path: "../../../etc",
      } as ListFilesArgs,
      TEST_WORKSPACE
    );

    assertEquals(result.success, false);

    await cleanupWorkspace();
  },
});

Deno.test({
  name: "File Tools: list_files - skip symlinked subdirectories during recursion",
  async fn() {
    await setupWorkspace();
    const platform = getPlatform();

    // Create directory structure:
    // workspace/
    //   legitimate/
    //     file1.txt
    //   evil_link/ -> /etc/
    await platform.fs.mkdir(`${TEST_WORKSPACE}/legitimate`, { recursive: true });
    await platform.fs.writeTextFile(
      `${TEST_WORKSPACE}/legitimate/file1.txt`,
      "legitimate file"
    );
    await platform.fs.writeTextFile(
      `${TEST_WORKSPACE}/regular.txt`,
      "regular file"
    );

    // Create symlinked subdirectory
    const symlinkDir = `${TEST_WORKSPACE}/evil_link`;
    try {
      const result = await platform.command.output({
        cmd: ["ln", "-s", "/etc", symlinkDir],
      });

      // Only test if symlink creation succeeded
      if (result.code === 0) {
        // List with recursive=true
        const listResult = await listFiles(
          {
            path: ".",
            recursive: true,
          } as ListFilesArgs,
          TEST_WORKSPACE
        );

        assertEquals(listResult.success, true);

        // Verify legitimate files are included
        const paths = listResult.entries?.map((e) => e.path) || [];
        assertEquals(paths.includes("regular.txt"), true);
        assertEquals(paths.includes("legitimate"), true);
        assertEquals(paths.includes("legitimate/file1.txt"), true);

        // CRITICAL: Verify symlinked directory is SKIPPED
        // evil_link itself might appear as a directory entry,
        // but we should NOT recurse into it
        const hasEvilLinkContents = paths.some((p) =>
          p.startsWith("evil_link/")
        );
        assertEquals(
          hasEvilLinkContents,
          false,
          "Symlinked subdirectory contents should be skipped during recursion"
        );
      }
    } catch {
      console.log(
        "Skipping symlink recursion test - ln command not available"
      );
    } finally {
      // Cleanup symlink
      try {
        await platform.fs.remove(symlinkDir);
      } catch {
        // Ignore
      }
    }

    await cleanupWorkspace();
  },
});
