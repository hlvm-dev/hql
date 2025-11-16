#!/usr/bin/env -S deno run -A

import { walk } from "jsr:@std/fs@1.0.13/walk";
import { readTextFile, exit } from "../core/src/platform/platform.ts";

const projectRoot = new URL("../", import.meta.url);

const skipPatterns = [
  /core\/src\/platform\//,
  /scripts\//,
  /test\//,
  /\.git\//,
  /node_modules\//,
];

const targetPatterns = [
  /\.(ts|tsx)$/,
];

let violations = 0;

for await (const entry of walk(projectRoot, { includeDirs: false })) {
  const relativePath = entry.path.replace(projectRoot.pathname, "");

  if (!targetPatterns.some((pattern) => pattern.test(relativePath))) {
    continue;
  }

  if (skipPatterns.some((pattern) => pattern.test(relativePath))) {
    continue;
  }

  const source = await readTextFile(entry.path);
  if (source.includes("Deno.")) {
    console.error(`Direct Deno.* usage detected in ${relativePath}`);
    violations++;
  }
}

if (violations > 0) {
  console.error(
    `\nFound ${violations} file(s) using Deno.* outside platform adapters.`,
  );
  exit(1);
}

console.log("✅ No direct Deno.* usage found outside platform adapters.");
