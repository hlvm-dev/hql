import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  archiveFiles,
  type ArchiveFilesArgs,
  editFile,
  type EditFileArgs,
  listFiles,
  type ListFilesArgs,
  openPath,
  type OpenPathArgs,
  readFile,
  type ReadFileArgs,
  writeFile,
  type WriteFileArgs,
} from "../../../src/hlvm/agent/tools/file-tools.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  cleanupWorkspaceDir,
  ensureWorkspaceDir,
} from "./workspace-test-helpers.ts";

const TEST_WORKSPACE = "/tmp/hlvm-agent-test";
const platform = () => getPlatform();

async function withWorkspace(fn: () => Promise<void>): Promise<void> {
  await ensureWorkspaceDir(TEST_WORKSPACE);
  try {
    await fn();
  } finally {
    await cleanupWorkspaceDir(TEST_WORKSPACE);
  }
}

async function writeWorkspaceFile(path: string, content: string): Promise<void> {
  const fullPath = `${TEST_WORKSPACE}/${path}`;
  const dir = platform().path.dirname(fullPath);
  await platform().fs.mkdir(dir, { recursive: true });
  await platform().fs.writeTextFile(fullPath, content);
}

Deno.test("file tools: read_file handles success, truncation, and common failures", async () => {
  await withWorkspace(async () => {
    await writeWorkspaceFile("test.txt", "Hello, world!");
    await platform().fs.mkdir(`${TEST_WORKSPACE}/testdir`);
    await writeWorkspaceFile("big.txt", "0123456789");

    const ok = await readFile({ path: "test.txt" } as ReadFileArgs, TEST_WORKSPACE);
    const truncated = await readFile({ path: "big.txt", maxBytes: 5 } as ReadFileArgs, TEST_WORKSPACE);
    const missing = await readFile({ path: "nonexistent.txt" } as ReadFileArgs, TEST_WORKSPACE);
    const directory = await readFile({ path: "testdir" } as ReadFileArgs, TEST_WORKSPACE);
    const outside = await readFile({ path: "../../../etc/passwd" } as ReadFileArgs, TEST_WORKSPACE);

    assertEquals(ok.success, true);
    assertEquals(ok.content, "Hello, world!");
    assertEquals(ok.size, 13);
    assertEquals(truncated.success, true);
    assertEquals(truncated.content, "01234");
    assertEquals(missing.success, false);
    assertStringIncludes(missing.message || "", "Failed to read");
    assertEquals(directory.success, false);
    assertStringIncludes(directory.message || "", "directory");
    assertEquals(outside.success, false);
  });
});

Deno.test("file tools: write_file handles create overwrite nesting limits and sandboxing", async () => {
  await withWorkspace(async () => {
    const created = await writeFile({ path: "newfile.txt", content: "Test content" } as WriteFileArgs, TEST_WORKSPACE);
    await writeWorkspaceFile("file.txt", "original");
    const overwritten = await writeFile({ path: "file.txt", content: "updated" } as WriteFileArgs, TEST_WORKSPACE);
    const nested = await writeFile({
      path: "nested/deep/file.txt",
      content: "content",
      createDirs: true,
    } as WriteFileArgs, TEST_WORKSPACE);
    const noDirs = await writeFile({
      path: "nested2/file.txt",
      content: "content",
      createDirs: false,
    } as WriteFileArgs, TEST_WORKSPACE);
    const limited = await writeFile({
      path: "too-big.txt",
      content: "0123456789",
      maxBytes: 5,
    } as WriteFileArgs, TEST_WORKSPACE);
    const outside = await writeFile({
      path: "../../../tmp/malicious.txt",
      content: "bad",
    } as WriteFileArgs, TEST_WORKSPACE);

    assertEquals(created.success, true);
    assertEquals(overwritten.success, true);
    assertEquals(nested.success, true);
    assertEquals(noDirs.success, false);
    assertEquals(limited.success, false);
    assertStringIncludes(limited.message || "", "Limit");
    assertEquals(outside.success, false);
    assertEquals(await platform().fs.readTextFile(`${TEST_WORKSPACE}/newfile.txt`), "Test content");
    assertEquals(await platform().fs.readTextFile(`${TEST_WORKSPACE}/file.txt`), "updated");
    assertEquals(await platform().fs.readTextFile(`${TEST_WORKSPACE}/nested/deep/file.txt`), "content");
  });
});

Deno.test("file tools: edit_file supports literal and regex replacement plus failure modes", async () => {
  await withWorkspace(async () => {
    await writeWorkspaceFile("edit.txt", "Hello world! Hello universe!");
    await writeWorkspaceFile("config.txt", "value1 = 10\nvalue2 = 20\nvalue3 = 30");
    await writeWorkspaceFile("big-edit.txt", "0123456789");
    await writeWorkspaceFile("plain.txt", "content");

    const literal = await editFile({
      path: "edit.txt",
      find: "Hello",
      replace: "Goodbye",
      mode: "literal",
    } as EditFileArgs, TEST_WORKSPACE);
    const regex = await editFile({
      path: "config.txt",
      find: "value\\d+",
      replace: "result",
      mode: "regex",
    } as EditFileArgs, TEST_WORKSPACE);
    const notFound = await editFile({
      path: "plain.txt",
      find: "nonexistent",
      replace: "replacement",
    } as EditFileArgs, TEST_WORKSPACE);
    const invalidRegex = await editFile({
      path: "plain.txt",
      find: "[invalid(",
      replace: "replacement",
      mode: "regex",
    } as EditFileArgs, TEST_WORKSPACE);
    const maxBytes = await editFile({
      path: "big-edit.txt",
      find: "0",
      replace: "X",
      maxBytes: 5,
    } as EditFileArgs, TEST_WORKSPACE);

    assertEquals(literal.success, true);
    assertEquals(literal.replacements, 2);
    assertEquals(regex.success, true);
    assertEquals(regex.replacements, 3);
    assertEquals(notFound.success, false);
    assertEquals(notFound.replacements, 0);
    assertEquals(invalidRegex.success, false);
    assertStringIncludes(invalidRegex.message || "", "Invalid regex");
    assertEquals(maxBytes.success, false);
    assertStringIncludes(maxBytes.message || "", "Limit");
    assertEquals(await platform().fs.readTextFile(`${TEST_WORKSPACE}/edit.txt`), "Goodbye world! Goodbye universe!");
    assertEquals(await platform().fs.readTextFile(`${TEST_WORKSPACE}/config.txt`), "result = 10\nresult = 20\nresult = 30");
  });
});

Deno.test("file tools: list_files handles sorting recursion pattern maxDepth and non-directory failures", async () => {
  await withWorkspace(async () => {
    await platform().fs.mkdir(`${TEST_WORKSPACE}/subdir`, { recursive: true });
    await platform().fs.mkdir(`${TEST_WORKSPACE}/dir1/dir2/l3`, { recursive: true });
    await writeWorkspaceFile("file1.txt", "");
    await writeWorkspaceFile("file2.ts", "");
    await writeWorkspaceFile("file3.js", "");
    await writeWorkspaceFile("readme.md", "");
    await writeWorkspaceFile("dir1/file1.txt", "");
    await writeWorkspaceFile("dir1/dir2/file2.txt", "");
    await writeWorkspaceFile("dir1/dir2/l3/file3.txt", "");

    const top = await listFiles({ path: ".", recursive: false } as ListFilesArgs, TEST_WORKSPACE);
    const recursive = await listFiles({ path: ".", recursive: true } as ListFilesArgs, TEST_WORKSPACE);
    const pattern = await listFiles({ path: ".", pattern: "*.ts" } as ListFilesArgs, TEST_WORKSPACE);
    const maxEntries = await listFiles({ path: ".", maxEntries: 1 } as ListFilesArgs, TEST_WORKSPACE);
    const maxDepth = await listFiles({ path: ".", recursive: true, maxDepth: 2 } as ListFilesArgs, TEST_WORKSPACE);
    const nonDir = await listFiles({ path: "file1.txt" } as ListFilesArgs, TEST_WORKSPACE);
    const outside = await listFiles({ path: "../../../etc" } as ListFilesArgs, TEST_WORKSPACE);

    assertEquals(top.success, true);
    assertEquals(top.entries?.[0].type, "directory");
    assertEquals(recursive.success, true);
    assert((recursive.count || 0) >= 8);
    assertEquals(pattern.entries?.map((entry) => entry.path), ["file2.ts"]);
    assertEquals(maxEntries.success, true);
    assertEquals(maxEntries.count, 1);
    assertStringIncludes(maxEntries.message || "", "limit");
    assertEquals(maxDepth.entries?.some((entry) => entry.path.includes("file3.txt")), false);
    assertEquals(nonDir.success, false);
    assertStringIncludes(nonDir.message || "", "not a directory");
    assertEquals(outside.success, false);
  });
});

Deno.test("file tools: recursive listing skips symlinked subdirectories", async () => {
  await withWorkspace(async () => {
    await platform().fs.mkdir(`${TEST_WORKSPACE}/legitimate`, { recursive: true });
    await writeWorkspaceFile("legitimate/file1.txt", "legitimate file");
    await writeWorkspaceFile("regular.txt", "regular file");

    const symlinkDir = `${TEST_WORKSPACE}/evil_link`;
    const result = await platform().command.output({ cmd: ["ln", "-s", "/etc", symlinkDir] });
    if (result.code !== 0) {
      return;
    }

    const listed = await listFiles({ path: ".", recursive: true } as ListFilesArgs, TEST_WORKSPACE);
    const paths = listed.entries?.map((entry) => entry.path) || [];

    assertEquals(listed.success, true);
    assertEquals(paths.includes("regular.txt"), true);
    assertEquals(paths.includes("legitimate"), true);
    assertEquals(paths.includes("legitimate/file1.txt"), true);
    assertEquals(paths.some((path) => path.startsWith("evil_link/")), false);
  });
});

Deno.test("file tools: open_path and archive_files reject sandbox and validation errors", async () => {
  await withWorkspace(async () => {
    const openOutside = await openPath({ path: "../../../etc" } as OpenPathArgs, TEST_WORKSPACE);
    const emptyArchive = await archiveFiles({
      paths: [],
      outputPath: "out.zip",
    } as ArchiveFilesArgs, TEST_WORKSPACE);

    assertEquals(openOutside.success, false);
    assertEquals(emptyArchive.success, false);
    assertStringIncludes(emptyArchive.message || "", "non-empty array");
  });
});
