import { assertEquals } from "jsr:@std/assert";
import { FileStateCache } from "../../../src/hlvm/agent/file-state-cache.ts";

Deno.test("file state cache: tracks full and partial reads and enforces full-view requirement", () => {
  const cache = new FileStateCache();

  const full = cache.trackRead({
    path: "/workspace/a.ts",
    content: "export const a = 1;\n",
    mtimeMs: 100,
  });
  const partial = cache.trackRead({
    path: "/workspace/b.ts",
    content: "partial content",
    mtimeMs: 200,
    isPartialView: true,
  });

  assertEquals(cache.get("/workspace/a.ts")?.contentHash, full.contentHash);
  assertEquals(cache.get("/workspace/b.ts")?.content, undefined);
  assertEquals(partial.isPartialView, true);
  assertEquals(cache.requireFullView("/workspace/a.ts").ok, true);
  assertEquals(cache.requireFullView("/workspace/b.ts").ok, false);
  assertEquals(cache.requireFullView("/workspace/missing.ts").ok, false);
});

Deno.test("file state cache: checkConflict detects unchanged and changed content", () => {
  const cache = new FileStateCache();
  cache.trackRead({
    path: "/workspace/a.ts",
    content: "export const a = 1;\n",
    mtimeMs: 100,
  });

  assertEquals(cache.checkConflict("/workspace/a.ts", {
    content: "export const a = 1;\n",
    mtimeMs: 100,
  }).ok, true);
  assertEquals(cache.checkConflict("/workspace/a.ts", {
    content: "export const a = 2;\n",
    mtimeMs: 100,
  }).ok, false);
  assertEquals(cache.checkConflict("/workspace/a.ts", {
    content: "export const a = 1;\n",
    mtimeMs: 101,
  }).ok, false);
});

Deno.test("file state cache: invalidate removes tracked entries", () => {
  const cache = new FileStateCache();
  cache.trackRead({
    path: "/workspace/a.ts",
    content: "export const a = 1;\n",
  });

  cache.invalidate("/workspace/a.ts");

  assertEquals(cache.get("/workspace/a.ts"), undefined);
});

Deno.test("file state cache: evicts least-recently used entries by entry count", () => {
  const cache = new FileStateCache({ maxEntries: 2 });

  cache.trackRead({ path: "/workspace/a.ts", content: "a" });
  cache.trackRead({ path: "/workspace/b.ts", content: "b" });
  cache.get("/workspace/a.ts");
  cache.trackRead({ path: "/workspace/c.ts", content: "c" });

  assertEquals(cache.get("/workspace/a.ts") !== undefined, true);
  assertEquals(cache.get("/workspace/b.ts"), undefined);
  assertEquals(cache.get("/workspace/c.ts") !== undefined, true);
});

Deno.test("file state cache: evicts entries by byte budget and restoration hints skip partial views", () => {
  const cache = new FileStateCache({ maxBytes: 10 });
  cache.trackRead({
    path: "/workspace/partial.ts",
    content: "0123456789",
    isPartialView: true,
  });
  cache.trackRead({
    path: "/workspace/full-a.ts",
    content: "abcdefghij",
  });
  cache.trackRead({
    path: "/workspace/full-b.ts",
    content: "ABCDEFGHIJ",
  });

  const hints = cache.buildRestorationHints(100_000);

  assertEquals(cache.get("/workspace/partial.ts"), undefined);
  assertEquals(cache.get("/workspace/full-a.ts"), undefined);
  assertEquals(cache.get("/workspace/full-b.ts") !== undefined, true);
  assertEquals(hints.map((hint) => hint.path), ["/workspace/full-b.ts"]);
});
