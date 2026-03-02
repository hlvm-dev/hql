#!/usr/bin/env -S deno run -A
/**
 * check-stdlib-deterministic.ts
 *
 * Ensures `deno task stdlib:build` is deterministic by comparing
 * artifacts from two consecutive builds.
 */

import {
  compareSnapshots,
  runStdlibBuild,
  snapshotFiles,
  STDLIB_GENERATED_FILES,
} from "./stdlib-check-helpers.ts";

async function main() {
  console.log("Running stdlib build (pass 1)...");
  const pass1Build = await runStdlibBuild();
  if (!pass1Build.success) {
    Deno.exit(pass1Build.code);
  }
  const pass1 = await snapshotFiles(STDLIB_GENERATED_FILES);

  console.log("Running stdlib build (pass 2)...");
  const pass2Build = await runStdlibBuild();
  if (!pass2Build.success) {
    Deno.exit(pass2Build.code);
  }
  const pass2 = await snapshotFiles(STDLIB_GENERATED_FILES);

  const mismatches = compareSnapshots(pass1, pass2);
  if (mismatches.length > 0) {
    console.error(
      [
        "Non-deterministic stdlib build detected.",
        "Files changed between consecutive builds:",
        ...mismatches.map((file) => `  - ${file}`),
      ].join("\n"),
    );
    Deno.exit(1);
  }

  console.log("OK: stdlib build is deterministic.");
}

if (import.meta.main) {
  await main();
}
