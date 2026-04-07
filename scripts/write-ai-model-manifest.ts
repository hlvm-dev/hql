#!/usr/bin/env -S deno run --allow-read --allow-write

import { walk } from "jsr:@std/fs/walk";
import { relative, resolve } from "jsr:@std/path";
import { getPlatform } from "../src/platform/platform.ts";

const rootArg = Deno.args[0];

if (!rootArg) {
  console.error("Usage: scripts/write-ai-model-manifest.ts <ai-model-dir>");
  Deno.exit(1);
}

const platform = getPlatform();
const rootDir = resolve(rootArg);
const manifestPath = platform.path.join(rootDir, "manifest.json");
const files: string[] = [];

for await (
  const entry of walk(rootDir, {
    includeDirs: false,
    followSymlinks: false,
  })
) {
  if (!entry.isFile) continue;
  const relativePath = relative(rootDir, entry.path).replace(/\\/g, "/");
  if (relativePath === "manifest.json") continue;
  files.push(relativePath);
}

files.sort();

await platform.fs.writeTextFile(
  manifestPath,
  JSON.stringify({ modelId: "gemma4:e4b", files }, null, 2),
);

console.log(`Wrote ${files.length} AI model entries to ${manifestPath}`);
