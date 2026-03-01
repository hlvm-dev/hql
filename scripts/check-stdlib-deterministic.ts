#!/usr/bin/env -S deno run -A
/**
 * check-stdlib-deterministic.ts
 *
 * Ensures `deno task stdlib:build` is deterministic by comparing
 * artifacts from two consecutive builds.
 */

const OUTPUT_FILES = [
  "src/hql/lib/stdlib/js/self-hosted.js",
  "src/hql/lib/stdlib/js/self-hosted.d.ts",
];

async function runBuild() {
  const command = new Deno.Command("deno", {
    args: ["task", "stdlib:build"],
    stdout: "inherit",
    stderr: "inherit",
  });
  const output = await command.output();
  if (!output.success) {
    Deno.exit(output.code);
  }
}

async function snapshot(files: string[]) {
  const result = new Map<string, string>();
  for (const file of files) {
    result.set(file, await Deno.readTextFile(file));
  }
  return result;
}

function compare(a: Map<string, string>, b: Map<string, string>) {
  const mismatches: string[] = [];
  for (const [file, textA] of a.entries()) {
    if (textA !== b.get(file)) {
      mismatches.push(file);
    }
  }
  return mismatches;
}

async function main() {
  console.log("Running stdlib build (pass 1)...");
  await runBuild();
  const pass1 = await snapshot(OUTPUT_FILES);

  console.log("Running stdlib build (pass 2)...");
  await runBuild();
  const pass2 = await snapshot(OUTPUT_FILES);

  const mismatches = compare(pass1, pass2);
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
