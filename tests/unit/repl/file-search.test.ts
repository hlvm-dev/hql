import { assertEquals, assertStrictEquals } from "jsr:@std/assert";
import {
  __resetFileIndexCacheForTest,
  getFileIndex,
  normalizeComparableFilePath,
  prewarmFileIndex,
} from "../../../src/hlvm/cli/repl/file-search.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

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
