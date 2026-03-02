#!/usr/bin/env -S deno run -A
/**
 * check-stdlib-generated.ts
 *
 * Ensures generated stdlib artifacts are up to date with stdlib.hql.
 * Fails if `deno task stdlib:build` produces uncommitted changes.
 */

import {
  parseChangedFiles,
  runCommand,
  runStdlibBuild,
  STDLIB_GENERATED_FILES,
} from "./stdlib-check-helpers.ts";

async function main() {
  console.log("Rebuilding stdlib artifacts...");
  const build = await runStdlibBuild();
  if (!build.success) {
    Deno.exit(build.code);
  }

  const diff = await runCommand([
    "git",
    "diff",
    "--name-only",
    "--",
    ...STDLIB_GENERATED_FILES,
  ]);

  const changed = parseChangedFiles(diff.stdout);

  if (changed.length > 0) {
    console.error(
      [
        "Generated stdlib artifacts are out of date.",
        "Run `deno task stdlib:build` and commit regenerated files:",
        ...changed.map((file) => `  - ${file}`),
      ].join("\n"),
    );
    Deno.exit(1);
  }

  console.log("OK: stdlib generated artifacts are up to date.");
}

if (import.meta.main) {
  await main();
}
