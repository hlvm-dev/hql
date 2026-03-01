#!/usr/bin/env -S deno run -A
/**
 * check-stdlib-generated.ts
 *
 * Ensures generated stdlib artifacts are up to date with stdlib.hql.
 * Fails if `deno task stdlib:build` produces uncommitted changes.
 */

const GENERATED_FILES = [
  "src/hql/lib/stdlib/js/self-hosted.js",
  "src/hql/lib/stdlib/js/self-hosted.d.ts",
];

async function run(args: string[], options: {
  stdout?: "inherit" | "piped";
  stderr?: "inherit" | "piped";
} = {}) {
  const stdoutMode = options.stdout ?? "piped";
  const stderrMode = options.stderr ?? "piped";
  const command = new Deno.Command(args[0], {
    args: args.slice(1),
    stdout: stdoutMode,
    stderr: stderrMode,
  });
  const output = await command.output();
  const stdout = stdoutMode === "piped"
    ? new TextDecoder().decode(output.stdout)
    : "";
  const stderr = stderrMode === "piped"
    ? new TextDecoder().decode(output.stderr)
    : "";
  return { success: output.success, code: output.code, stdout, stderr };
}

async function main() {
  console.log("Rebuilding stdlib artifacts...");
  const build = await run(["deno", "task", "stdlib:build"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!build.success) {
    Deno.exit(build.code);
  }

  const diff = await run([
    "git",
    "diff",
    "--name-only",
    "--",
    ...GENERATED_FILES,
  ]);

  const changed = diff.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

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
