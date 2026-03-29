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
