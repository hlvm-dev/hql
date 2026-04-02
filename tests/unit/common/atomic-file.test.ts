import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  atomicWriteTextFile,
  atomicWriteTextFileSync,
} from "../../../src/common/atomic-file.ts";
import { getPlatform, setPlatform } from "../../../src/platform/platform.ts";
import type { Platform } from "../../../src/platform/types.ts";
import { withTempDir } from "../helpers.ts";

function permissionBits(mode: number | undefined): number | undefined {
  return mode === undefined ? undefined : mode & 0o777;
}

Deno.test("atomic file: atomic overwrite writes valid content and preserves mode", async () => {
  await withTempDir(async (tempDir) => {
    const platform = getPlatform();
    const filePath = platform.path.join(tempDir, "config.json");

    await platform.fs.writeTextFile(filePath, "before");
    await platform.fs.chmod(filePath, 0o640);

    await atomicWriteTextFile(filePath, "after");

    const content = await platform.fs.readTextFile(filePath);
    const stat = await platform.fs.stat(filePath);

    assertEquals(content, "after");
    assertEquals(permissionBits(stat.mode), 0o640);
  });
});

Deno.test("atomic file: concurrent writes end in one complete payload without temp artifacts", async () => {
  await withTempDir(async (tempDir) => {
    const platform = getPlatform();
    const filePath = platform.path.join(tempDir, "index.jsonl");

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        atomicWriteTextFile(filePath, JSON.stringify({ i })),
      ),
    );

    const content = await platform.fs.readTextFile(filePath);
    assert(/^{"i":\d+}$/.test(content));

    const tempArtifacts: string[] = [];
    for await (const entry of platform.fs.readDir(tempDir)) {
      if (entry.name.includes(".tmp.")) tempArtifacts.push(entry.name);
    }
    assertEquals(tempArtifacts.length, 0);
  });
});

Deno.test("atomic file: cleans temp file on rename failure", async () => {
  await withTempDir(async (tempDir) => {
    const originalPlatform = getPlatform();
    const filePath = originalPlatform.path.join(tempDir, "state.json");
    let renameCalls = 0;

    const mockedPlatform: Platform = {
      ...originalPlatform,
      fs: {
        ...originalPlatform.fs,
        rename: async (_oldPath: string, _newPath: string) => {
          renameCalls++;
          throw new Error("rename failed");
        },
      },
    };

    setPlatform(mockedPlatform);
    try {
      await assertRejects(
        () => atomicWriteTextFile(filePath, "payload"),
        Error,
        "rename failed",
      );
      assertEquals(renameCalls, 1);
    } finally {
      setPlatform(originalPlatform);
    }

    const leftovers: string[] = [];
    for await (const entry of originalPlatform.fs.readDir(tempDir)) {
      leftovers.push(entry.name);
    }
    assertEquals(leftovers, []);
  });
});

Deno.test("atomic file: refuses existing symlink targets", async () => {
  await withTempDir(async (tempDir) => {
    const platform = getPlatform();
    if (platform.build.os === "windows") return;

    const targetPath = platform.path.join(tempDir, "target.txt");
    const symlinkPath = platform.path.join(tempDir, "link.txt");
    await platform.fs.writeTextFile(targetPath, "original");

    const linked = await platform.command.output({
      cmd: ["ln", "-s", targetPath, symlinkPath],
    });
    assertEquals(linked.success, true);

    await assertRejects(
      () => atomicWriteTextFile(symlinkPath, "new"),
      Error,
      "Atomic writes refuse symlink targets",
    );
    assertEquals(await platform.fs.readTextFile(targetPath), "original");
  });
});

Deno.test("atomic file: sync writer preserves mode and content", async () => {
  await withTempDir(async (tempDir) => {
    const platform = getPlatform();
    const filePath = platform.path.join(tempDir, "sync.txt");
    await platform.fs.writeTextFile(filePath, "one");
    await platform.fs.chmod(filePath, 0o600);

    atomicWriteTextFileSync(filePath, "two");

    assertEquals(await platform.fs.readTextFile(filePath), "two");
    assertEquals(permissionBits(platform.fs.statSync(filePath).mode), 0o600);
  });
});
