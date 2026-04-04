import { assertEquals, assertStrictEquals } from "jsr:@std/assert";
import {
  __resetFileIndexCacheForTest,
  getFileIndex,
  normalizeComparableFilePath,
  prewarmFileIndex,
  searchFiles,
} from "../../../src/hlvm/cli/repl/file-search.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withEnv } from "../../shared/light-helpers.ts";

Deno.test("file search: normalizeComparableFilePath canonicalizes relative, absolute, and escaped paths", () => {
  const platform = getPlatform();
  const expected = platform.path.resolve("docs/features/spec.md");
  assertEquals(normalizeComparableFilePath("docs/features/spec.md"), expected);
  assertEquals(normalizeComparableFilePath(expected), expected);

  const spaced = platform.path.resolve("docs/My File.md");
  assertEquals(normalizeComparableFilePath("docs/My\\ File.md"), spaced);
});

Deno.test("file search: startup prewarm shares the in-flight build and subsequent cache", async () => {
  __resetFileIndexCacheForTest();

  const [warmedIndex, foregroundIndex] = await Promise.all([
    prewarmFileIndex(),
    getFileIndex(),
  ]);

  assertStrictEquals(warmedIndex, foregroundIndex);
  assertStrictEquals(await getFileIndex(), warmedIndex);
});

Deno.test("file search: bare queries surface common home folders", async () => {
  const platform = getPlatform();
  const tempHome = await platform.fs.makeTempDir({ prefix: "hlvm-home-" });
  await platform.fs.mkdir(platform.path.join(tempHome, "Desktop"), {
    recursive: true,
  });

  __resetFileIndexCacheForTest();

  await withEnv("HOME", tempHome, async () => {
    const results = await searchFiles("desk");
    assertEquals(results.some((match) => match.path === "~/Desktop/"), true);
  });
});

Deno.test("file search: known home-folder aliases drill into global folders", async () => {
  const platform = getPlatform();
  const tempHome = await platform.fs.makeTempDir({ prefix: "hlvm-home-" });
  await platform.fs.mkdir(
    platform.path.join(tempHome, "Desktop", "screenshots"),
    { recursive: true },
  );

  __resetFileIndexCacheForTest();

  await withEnv("HOME", tempHome, async () => {
    const results = await searchFiles("desktop/scr");
    assertEquals(
      results.some((match) => match.path.endsWith("/Desktop/screenshots")),
      true,
    );
  });
});

Deno.test("file search: exact directory paths with trailing slash list children for browsing", async () => {
  const platform = getPlatform();
  const tempDir = await platform.fs.makeTempDir({
    prefix: "hlvm-path-browse-",
  });
  const browseDir = platform.path.join(tempDir, "browse-me");
  await platform.fs.mkdir(platform.path.join(browseDir, "nested"), {
    recursive: true,
  });
  await platform.fs.writeTextFile(
    platform.path.join(browseDir, "note.txt"),
    "hello",
  );

  const results = await searchFiles(`${browseDir}/`);

  assertEquals(
    results.some((match) =>
      match.path === `${browseDir}/nested` && match.isDirectory
    ),
    true,
  );
  assertEquals(
    results.some((match) =>
      match.path === `${browseDir}/note.txt` && !match.isDirectory
    ),
    true,
  );
});

Deno.test("file search: tilde-prefixed exact directory browse keeps the tilde display path", async () => {
  const platform = getPlatform();
  const tempHome = await platform.fs.makeTempDir({ prefix: "hlvm-home-" });
  await platform.fs.mkdir(platform.path.join(tempHome, "Desktop"), {
    recursive: true,
  });
  await platform.fs.writeTextFile(
    platform.path.join(tempHome, "Desktop", "todo.txt"),
    "hello",
  );

  await withEnv("HOME", tempHome, async () => {
    const results = await searchFiles("~/Desktop/");
    assertEquals(
      results.some((match) => match.path === "~/Desktop/todo.txt"),
      true,
    );
  });
});
