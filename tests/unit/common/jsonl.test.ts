import { assert, assertEquals } from "jsr:@std/assert";
import { atomicWriteTextFile } from "../../../src/common/jsonl.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

Deno.test("atomicWriteTextFile: avoids temp-path collisions under concurrent writes", async () => {
  const platform = getPlatform();
  const tempDir = await platform.fs.makeTempDir({ prefix: "hlvm-jsonl-atomic-" });
  const filePath = platform.path.join(tempDir, "index.jsonl");
  const originalNow = Date.now;

  try {
    // Force identical timestamps to simulate the previous collision scenario.
    Object.defineProperty(Date, "now", {
      value: () => 1700000000000,
      configurable: true,
    });

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        atomicWriteTextFile(filePath, JSON.stringify({ i })),
      ),
    );

    const content = await platform.fs.readTextFile(filePath);
    assert(content.length > 0);

    const tempArtifacts: string[] = [];
    for await (const entry of platform.fs.readDir(tempDir)) {
      if (entry.name.includes(".tmp.")) {
        tempArtifacts.push(entry.name);
      }
    }
    assertEquals(tempArtifacts.length, 0);
  } finally {
    Object.defineProperty(Date, "now", {
      value: originalNow,
      configurable: true,
    });
    await platform.fs.remove(tempDir, { recursive: true });
  }
});
