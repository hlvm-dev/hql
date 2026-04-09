import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  archiveFiles,
  type ArchiveFilesArgs,
  copyPath,
  type CopyPathArgs,
  editFile,
  type EditFileArgs,
  emptyTrash,
  type EmptyTrashArgs,
  FILE_TOOLS,
  fileMetadata,
  type FileMetadataArgs,
  listFiles,
  type ListFilesArgs,
  makeDirectory,
  type MakeDirectoryArgs,
  movePath,
  type MovePathArgs,
  moveToTrash,
  type MoveToTrashArgs,
  openPath,
  type OpenPathArgs,
  readFile,
  type ReadFileArgs,
  revealPath,
  type RevealPathArgs,
  setFileToolRuntimeForTest,
  writeFile,
  type WriteFileArgs,
} from "../../../src/hlvm/agent/tools/file-tools.ts";
import { FileStateCache } from "../../../src/hlvm/agent/file-state-cache.ts";
import type { AgentPolicy } from "../../../src/hlvm/agent/policy.ts";
import { getPlatform, setPlatform } from "../../../src/platform/platform.ts";
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

async function writeWorkspaceFile(
  path: string,
  content: string,
): Promise<void> {
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

    const ok = await readFile(
      { path: "test.txt" } as ReadFileArgs,
      TEST_WORKSPACE,
    );
    const truncated = await readFile(
      { path: "big.txt", maxBytes: 5 } as ReadFileArgs,
      TEST_WORKSPACE,
    );
    const missing = await readFile(
      { path: "nonexistent.txt" } as ReadFileArgs,
      TEST_WORKSPACE,
    );
    const directory = await readFile(
      { path: "testdir" } as ReadFileArgs,
      TEST_WORKSPACE,
    );
    const outside = await readFile(
      { path: "../../../etc/passwd" } as ReadFileArgs,
      TEST_WORKSPACE,
    );

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
    const created = await writeFile(
      { path: "newfile.txt", content: "Test content" } as WriteFileArgs,
      TEST_WORKSPACE,
    );
    await writeWorkspaceFile("file.txt", "original");
    const overwritten = await writeFile(
      { path: "file.txt", content: "updated" } as WriteFileArgs,
      TEST_WORKSPACE,
    );
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
    assertEquals(
      await platform().fs.readTextFile(`${TEST_WORKSPACE}/newfile.txt`),
      "Test content",
    );
    assertEquals(
      await platform().fs.readTextFile(`${TEST_WORKSPACE}/file.txt`),
      "updated",
    );
    assertEquals(
      await platform().fs.readTextFile(
        `${TEST_WORKSPACE}/nested/deep/file.txt`,
      ),
      "content",
    );
  });
});

Deno.test("file tools: edit_file supports literal and regex replacement plus failure modes", async () => {
  await withWorkspace(async () => {
    await writeWorkspaceFile("edit.txt", "Hello world! Hello universe!");
    await writeWorkspaceFile(
      "config.txt",
      "value1 = 10\nvalue2 = 20\nvalue3 = 30",
    );
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
    assertEquals(
      await platform().fs.readTextFile(`${TEST_WORKSPACE}/edit.txt`),
      "Goodbye world! Goodbye universe!",
    );
    assertEquals(
      await platform().fs.readTextFile(`${TEST_WORKSPACE}/config.txt`),
      "result = 10\nresult = 20\nresult = 30",
    );
  });
});

Deno.test("file tools: list_files handles sorting recursion pattern maxDepth and non-directory failures", async () => {
  await withWorkspace(async () => {
    await platform().fs.mkdir(`${TEST_WORKSPACE}/subdir`, { recursive: true });
    await platform().fs.mkdir(`${TEST_WORKSPACE}/dir1/dir2/l3`, {
      recursive: true,
    });
    await writeWorkspaceFile("file1.txt", "");
    await writeWorkspaceFile("file2.ts", "");
    await writeWorkspaceFile("file3.js", "");
    await writeWorkspaceFile("readme.md", "");
    await writeWorkspaceFile("dir1/file1.txt", "");
    await writeWorkspaceFile("dir1/dir2/file2.txt", "");
    await writeWorkspaceFile("dir1/dir2/l3/file3.txt", "");

    const top = await listFiles(
      { path: ".", recursive: false } as ListFilesArgs,
      TEST_WORKSPACE,
    );
    const recursive = await listFiles(
      { path: ".", recursive: true } as ListFilesArgs,
      TEST_WORKSPACE,
    );
    const pattern = await listFiles(
      { path: ".", pattern: "*.ts" } as ListFilesArgs,
      TEST_WORKSPACE,
    );
    const maxEntries = await listFiles(
      { path: ".", maxEntries: 1 } as ListFilesArgs,
      TEST_WORKSPACE,
    );
    const maxDepth = await listFiles(
      { path: ".", recursive: true, maxDepth: 2 } as ListFilesArgs,
      TEST_WORKSPACE,
    );
    const nonDir = await listFiles(
      { path: "file1.txt" } as ListFilesArgs,
      TEST_WORKSPACE,
    );
    const outside = await listFiles(
      { path: "../../../etc" } as ListFilesArgs,
      TEST_WORKSPACE,
    );

    assertEquals(top.success, true);
    assertEquals(top.entries?.[0].type, "directory");
    assertEquals(recursive.success, true);
    assert((recursive.count || 0) >= 8);
    assertEquals(pattern.entries?.map((entry) => entry.path), ["file2.ts"]);
    assertEquals(maxEntries.success, true);
    assertEquals(maxEntries.count, 1);
    assertStringIncludes(maxEntries.message || "", "limit");
    assertEquals(
      maxDepth.entries?.some((entry) => entry.path.includes("file3.txt")),
      false,
    );
    assertEquals(nonDir.success, false);
    assertStringIncludes(nonDir.message || "", "not a directory");
    assertEquals(outside.success, false);
  });
});

Deno.test("file tools: list_files recursively traverses allowed roots outside the workspace", async () => {
  await withWorkspace(async () => {
    const globalRoot = await platform().fs.makeTempDir({
      prefix: "hlvm-list-files-global-",
    });
    const nestedDir = `${globalRoot}/nested/deeper`;
    const nestedFile = `${nestedDir}/kept.txt`;
    const escapeTarget = await platform().fs.makeTempDir({
      prefix: "hlvm-list-files-escape-",
    });

    try {
      await platform().fs.mkdir(nestedDir, { recursive: true });
      await platform().fs.writeTextFile(nestedFile, "keep");
      if (platform().build.os !== "windows") {
        await platform().command.output({
          cmd: ["ln", "-s", escapeTarget, `${globalRoot}/nested/escape-link`],
        });
      }

      const policy: AgentPolicy = {
        version: 1,
        pathRules: { roots: [globalRoot] },
      };

      const recursive = await listFiles(
        { path: globalRoot, recursive: true } as ListFilesArgs,
        TEST_WORKSPACE,
        { policy },
      );

      assertEquals(recursive.success, true);
      assertEquals(
        recursive.entries?.some((entry) =>
          entry.path === "nested/deeper/kept.txt"
        ),
        true,
      );
      assertEquals(
        recursive.entries?.some((entry) => entry.path.includes("escape-link")),
        false,
      );
    } finally {
      await platform().fs.remove(globalRoot, { recursive: true }).catch(
        () => {},
      );
      await platform().fs.remove(escapeTarget, { recursive: true }).catch(
        () => {},
      );
    }
  });
});

Deno.test("file tools: recursive listing skips symlinked subdirectories", async () => {
  await withWorkspace(async () => {
    await platform().fs.mkdir(`${TEST_WORKSPACE}/legitimate`, {
      recursive: true,
    });
    await writeWorkspaceFile("legitimate/file1.txt", "legitimate file");
    await writeWorkspaceFile("regular.txt", "regular file");

    const symlinkDir = `${TEST_WORKSPACE}/evil_link`;
    const result = await platform().command.output({
      cmd: ["ln", "-s", "/etc", symlinkDir],
    });
    if (result.code !== 0) {
      return;
    }

    const listed = await listFiles(
      { path: ".", recursive: true } as ListFilesArgs,
      TEST_WORKSPACE,
    );
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
    const openOutside = await openPath(
      { path: "../../../etc" } as OpenPathArgs,
      TEST_WORKSPACE,
    );
    const emptyArchive = await archiveFiles({
      paths: [],
      outputPath: "out.zip",
    } as ArchiveFilesArgs, TEST_WORKSPACE);

    assertEquals(openOutside.success, false);
    assertEquals(emptyArchive.success, false);
    assertStringIncludes(emptyArchive.message || "", "non-empty array");
  });
});

Deno.test("file tools: open_path tolerates Unicode whitespace variants in existing filenames", async () => {
  await withWorkspace(async () => {
    const originalPlatform = getPlatform();
    let openedPath = "";
    setPlatform({
      ...originalPlatform,
      openUrl: async (url: string) => {
        openedPath = url;
      },
    });

    try {
      const unicodeName = "Screenshot 2026-03-11 at 4.16.13 AM.png";
      await writeWorkspaceFile(unicodeName, "png");

      const result = await openPath({
        path: "Screenshot 2026-03-11 at 4.16.13 AM.png",
      } as OpenPathArgs, TEST_WORKSPACE);

      assertEquals(result.success, true);
      assertEquals(openedPath, `${TEST_WORKSPACE}/${unicodeName}`);
      assertEquals(result.openedPath, `${TEST_WORKSPACE}/${unicodeName}`);
    } finally {
      setPlatform(originalPlatform);
    }
  });
});

Deno.test("file tools: move_to_trash validates allowed roots and uses the trash runtime", async () => {
  await withWorkspace(async () => {
    const globalRoot = await platform().fs.makeTempDir({
      prefix: "hlvm-trash-global-",
    });
    const globalFile = `${globalRoot}/outside.txt`;
    const workspaceFile = `${TEST_WORKSPACE}/trash-me.txt`;
    const capturedCalls: string[][] = [];

    await writeWorkspaceFile("trash-me.txt", "remove me");
    await platform().fs.writeTextFile(globalFile, "outside");
    setFileToolRuntimeForTest({
      moveToTrash: async (paths: string[]) => {
        capturedCalls.push([...paths]);
      },
    });

    try {
      const policy: AgentPolicy = {
        version: 1,
        pathRules: { roots: [globalRoot] },
      };

      const result = await moveToTrash(
        { paths: ["trash-me.txt", globalFile] } as MoveToTrashArgs,
        TEST_WORKSPACE,
        { policy },
      );

      assertEquals(result.success, true);
      assertEquals(result.count, 2);
      assertEquals(capturedCalls.length, 1);
      assertEquals(capturedCalls[0], [workspaceFile, globalFile]);
      assertEquals(result.trashedPaths, [workspaceFile, globalFile]);
    } finally {
      setFileToolRuntimeForTest(null);
      await platform().fs.remove(globalRoot, { recursive: true }).catch(
        () => {},
      );
    }
  });
});

Deno.test("file tools: reveal_path handles macOS exact reveal, Windows quiet explorer launches, and Linux fallback", async () => {
  await withWorkspace(async () => {
    await writeWorkspaceFile("notes.txt", "hello");
    await writeWorkspaceFile("notes with spaces.txt", "hello");
    const targetPath = `${TEST_WORKSPACE}/notes.txt`;
    const spacedTargetPath = `${TEST_WORKSPACE}/notes with spaces.txt`;
    const originalPlatform = getPlatform();
    const capturedCommands: string[][] = [];
    const openedUrls: string[] = [];

    setPlatform({
      ...originalPlatform,
      build: { ...originalPlatform.build, os: "darwin" },
      command: {
        ...originalPlatform.command,
        output: async (options) => {
          capturedCommands.push([...options.cmd]);
          return {
            code: 0,
            success: true,
            stdout: new Uint8Array(),
            stderr: new Uint8Array(),
          };
        },
      },
      openUrl: async (url: string) => {
        openedUrls.push(url);
      },
    });

    try {
      const exact = await revealPath(
        { path: "notes.txt" } as RevealPathArgs,
        TEST_WORKSPACE,
      );
      assertEquals(exact.success, true);
      assertEquals(capturedCommands, [["open", "-R", targetPath]]);
      assertEquals(openedUrls.length, 0);
      assertEquals(exact.exact, true);

      capturedCommands.length = 0;
      openedUrls.length = 0;
      setPlatform({
        ...getPlatform(),
        build: { ...getPlatform().build, os: "windows" },
        command: {
          ...getPlatform().command,
          output: async (options) => {
            capturedCommands.push([...options.cmd]);
            return {
              code: 1,
              success: false,
              stdout: new Uint8Array(),
              stderr: new Uint8Array(),
            };
          },
        },
      });

      const windows = await revealPath(
        { path: "notes with spaces.txt" } as RevealPathArgs,
        TEST_WORKSPACE,
      );
      assertEquals(windows.success, true);
      assertEquals(capturedCommands, [[
        "explorer.exe",
        `/select,"${spacedTargetPath.replaceAll("/", "\\")}"`,
      ]]);
      assertEquals(openedUrls.length, 0);
      assertEquals(windows.exact, true);

      capturedCommands.length = 0;
      setPlatform({
        ...getPlatform(),
        build: { ...getPlatform().build, os: "linux" },
      });

      const fallback = await revealPath(
        { path: "notes.txt" } as RevealPathArgs,
        TEST_WORKSPACE,
      );
      assertEquals(fallback.success, true);
      assertEquals(capturedCommands.length, 0);
      assertEquals(openedUrls, [TEST_WORKSPACE]);
      assertEquals(fallback.exact, false);
      assertEquals(fallback.fallbackPath, TEST_WORKSPACE);
    } finally {
      setPlatform(originalPlatform);
    }
  });
});

Deno.test("file tools: empty_trash uses destructive safety and the trash runtime", async () => {
  await withWorkspace(async () => {
    let emptied = 0;
    setFileToolRuntimeForTest({
      emptyTrash: async () => {
        emptied += 1;
      },
    });

    try {
      const result = await emptyTrash(
        {} as EmptyTrashArgs,
        TEST_WORKSPACE,
      );

      assertEquals(result.success, true);
      assertEquals(emptied, 1);
      assertEquals(FILE_TOOLS.move_to_trash.safetyLevel, "L1");
      assertEquals(FILE_TOOLS.empty_trash.safetyLevel, "L2");
    } finally {
      setFileToolRuntimeForTest(null);
    }
  });
});

Deno.test("file tools: make_directory creates folders idempotently and rejects file collisions", async () => {
  await withWorkspace(async () => {
    await writeWorkspaceFile("existing.txt", "hello");

    const created = await makeDirectory(
      { path: "organized/receipts" } as MakeDirectoryArgs,
      TEST_WORKSPACE,
    );
    const repeated = await makeDirectory(
      { path: "organized/receipts" } as MakeDirectoryArgs,
      TEST_WORKSPACE,
    );
    const collision = await makeDirectory(
      { path: "existing.txt" } as MakeDirectoryArgs,
      TEST_WORKSPACE,
    );

    assertEquals(created.success, true);
    assertEquals(created.alreadyExisted, false);
    assertEquals(
      await platform().fs.stat(`${TEST_WORKSPACE}/organized/receipts`).then((
        info,
      ) => info.isDirectory),
      true,
    );
    assertEquals(repeated.success, true);
    assertEquals(repeated.alreadyExisted, true);
    assertEquals(collision.success, false);
    assertStringIncludes(collision.message || "", "not a directory");
  });
});

Deno.test("file tools: move_path renames files and rejects conflicting destinations", async () => {
  await withWorkspace(async () => {
    await writeWorkspaceFile("drafts/plan.txt", "plan");
    await platform().fs.mkdir(`${TEST_WORKSPACE}/organized`, {
      recursive: true,
    });
    await writeWorkspaceFile("organized/existing.txt", "occupied");

    const moved = await movePath(
      {
        sourcePath: "drafts/plan.txt",
        destinationPath: "organized/final-plan.txt",
      } as MovePathArgs,
      TEST_WORKSPACE,
    );
    const conflict = await movePath(
      {
        sourcePath: "organized/final-plan.txt",
        destinationPath: "organized/existing.txt",
      } as MovePathArgs,
      TEST_WORKSPACE,
    );

    assertEquals(moved.success, true);
    assertEquals(
      await platform().fs.exists(`${TEST_WORKSPACE}/drafts/plan.txt`),
      false,
    );
    assertEquals(
      await platform().fs.readTextFile(
        `${TEST_WORKSPACE}/organized/final-plan.txt`,
      ),
      "plan",
    );
    assertEquals(conflict.success, false);
    assertStringIncludes(conflict.message || "", "Destination already exists");
  });
});

Deno.test("file tools: copy_path duplicates files and directories recursively", async () => {
  await withWorkspace(async () => {
    await writeWorkspaceFile("docs/report.txt", "report");
    await writeWorkspaceFile("bundle/nested/inside.txt", "nested");
    await platform().fs.mkdir(`${TEST_WORKSPACE}/copies`, { recursive: true });

    const fileCopy = await copyPath(
      {
        sourcePath: "docs/report.txt",
        destinationPath: "copies/report-copy.txt",
      } as CopyPathArgs,
      TEST_WORKSPACE,
    );
    const dirCopy = await copyPath(
      {
        sourcePath: "bundle",
        destinationPath: "copies/bundle-copy",
      } as CopyPathArgs,
      TEST_WORKSPACE,
    );

    assertEquals(fileCopy.success, true);
    assertEquals(dirCopy.success, true);
    assertEquals(
      await platform().fs.readTextFile(
        `${TEST_WORKSPACE}/copies/report-copy.txt`,
      ),
      "report",
    );
    assertEquals(
      await platform().fs.readTextFile(
        `${TEST_WORKSPACE}/copies/bundle-copy/nested/inside.txt`,
      ),
      "nested",
    );
    assertEquals(
      await platform().fs.readTextFile(
        `${TEST_WORKSPACE}/bundle/nested/inside.txt`,
      ),
      "nested",
    );
  });
});

Deno.test("file tools: descriptions frame general local text work", () => {
  assertStringIncludes(FILE_TOOLS.read_file.description, "notes");
  assertStringIncludes(FILE_TOOLS.edit_file.description, "notes");
  assertStringIncludes(FILE_TOOLS.make_directory.description, "organization");
});

Deno.test("file tools: read_file records full-view state when a file cache is supplied", async () => {
  await withWorkspace(async () => {
    await writeWorkspaceFile("tracked.ts", "export const tracked = true;\n");
    const cache = new FileStateCache();

    const result = await readFile(
      { path: "tracked.ts" } as ReadFileArgs,
      TEST_WORKSPACE,
      { fileStateCache: cache },
    );

    assertEquals(result.success, true);
    assertEquals(
      cache.get(`${TEST_WORKSPACE}/tracked.ts`)?.isPartialView,
      false,
    );
    assertEquals(
      cache.requireFullView(`${TEST_WORKSPACE}/tracked.ts`).ok,
      true,
    );
  });
});

Deno.test("file tools: partial-view cache entries block edit_file until the file is fully re-read", async () => {
  await withWorkspace(async () => {
    await writeWorkspaceFile("partial.ts", "const value = 1;\n");
    const cache = new FileStateCache();
    cache.trackRead({
      path: `${TEST_WORKSPACE}/partial.ts`,
      content: "const value = 1;\n",
      isPartialView: true,
    });

    const result = await editFile(
      {
        path: "partial.ts",
        find: "1",
        replace: "2",
      } as EditFileArgs,
      TEST_WORKSPACE,
      { fileStateCache: cache },
    );

    assertEquals(result.success, false);
    assertStringIncludes(result.message || "", "only partially viewed");
  });
});

Deno.test("file tools: overwriting a changed file requires a re-read in the same session", async () => {
  await withWorkspace(async () => {
    await writeWorkspaceFile("changed.ts", "export const value = 1;\n");
    const cache = new FileStateCache();

    await readFile(
      { path: "changed.ts" } as ReadFileArgs,
      TEST_WORKSPACE,
      { fileStateCache: cache },
    );
    await writeWorkspaceFile("changed.ts", "export const value = 2;\n");

    const result = await writeFile(
      {
        path: "changed.ts",
        content: "export const value = 3;\n",
      } as WriteFileArgs,
      TEST_WORKSPACE,
      { fileStateCache: cache },
    );

    assertEquals(result.success, false);
    assertStringIncludes(result.message || "", "Re-read before");
  });
});

Deno.test("file tools: successful write and edit invalidate stale cached state", async () => {
  await withWorkspace(async () => {
    await writeWorkspaceFile("cached.ts", "const value = 1;\n");
    const writeCache = new FileStateCache();
    const editCache = new FileStateCache();

    await readFile(
      { path: "cached.ts" } as ReadFileArgs,
      TEST_WORKSPACE,
      { fileStateCache: writeCache },
    );
    const writeResult = await writeFile(
      {
        path: "cached.ts",
        content: "const value = 2;\n",
      } as WriteFileArgs,
      TEST_WORKSPACE,
      { fileStateCache: writeCache },
    );

    await readFile(
      { path: "cached.ts" } as ReadFileArgs,
      TEST_WORKSPACE,
      { fileStateCache: editCache },
    );
    const editResult = await editFile(
      {
        path: "cached.ts",
        find: "2",
        replace: "3",
      } as EditFileArgs,
      TEST_WORKSPACE,
      { fileStateCache: editCache },
    );

    assertEquals(writeResult.success, true);
    assertEquals(editResult.success, true);
    assertEquals(writeCache.get(`${TEST_WORKSPACE}/cached.ts`), undefined);
    assertEquals(editCache.get(`${TEST_WORKSPACE}/cached.ts`), undefined);
  });
});

Deno.test("file tools: file_metadata returns size dates and type for files and handles missing paths", async () => {
  await withWorkspace(async () => {
    await writeWorkspaceFile("readme.md", "# Hello\n\nWorld");
    await writeWorkspaceFile("photo.jpg", "fake jpg content");
    await platform().fs.mkdir(`${TEST_WORKSPACE}/subdir`);

    const result = await fileMetadata(
      { paths: ["readme.md", "photo.jpg", "subdir", "missing.txt"] } as FileMetadataArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 4);
    const entries = result.entries!;

    // readme.md — file with size and modified time
    assertEquals(entries[0].path, "readme.md");
    assertEquals(entries[0].exists, true);
    assertEquals(entries[0].isFile, true);
    assertEquals(entries[0].isDirectory, false);
    assert(typeof entries[0].size === "number" && entries[0].size > 0);
    assert(typeof entries[0].modified === "string");

    // photo.jpg — has mimeType
    assertEquals(entries[1].path, "photo.jpg");
    assertEquals(entries[1].exists, true);
    assertEquals(entries[1].isFile, true);
    assertEquals(entries[1].mimeType, "image/jpeg");

    // subdir — directory
    assertEquals(entries[2].path, "subdir");
    assertEquals(entries[2].exists, true);
    assertEquals(entries[2].isDirectory, true);
    assertEquals(entries[2].isFile, false);

    // missing.txt — does not exist
    assertEquals(entries[3].path, "missing.txt");
    assertEquals(entries[3].exists, false);
  });
});

Deno.test("file tools: file_metadata accepts a single path string", async () => {
  await withWorkspace(async () => {
    await writeWorkspaceFile("single.txt", "content");

    const result = await fileMetadata(
      { paths: "single.txt" } as FileMetadataArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 1);
    assertEquals(result.entries![0].exists, true);
    assertEquals(result.entries![0].isFile, true);
  });
});

Deno.test("file tools: file_metadata is registered as L0 read-only", () => {
  assertEquals(FILE_TOOLS.file_metadata.safetyLevel, "L0");
  assertEquals(FILE_TOOLS.file_metadata.category, "read");
});
