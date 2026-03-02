#!/usr/bin/env -S deno run -A

export const STDLIB_GENERATED_FILES = [
  "src/hql/lib/stdlib/js/self-hosted.js",
  "src/hql/lib/stdlib/js/self-hosted.d.ts",
] as const;

interface RunOptions {
  stdout?: "inherit" | "piped";
  stderr?: "inherit" | "piped";
}

interface RunResult {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

const textDecoder = new TextDecoder();

export async function runCommand(
  args: [string, ...string[]],
  options: RunOptions = {},
): Promise<RunResult> {
  const stdoutMode = options.stdout ?? "piped";
  const stderrMode = options.stderr ?? "piped";
  const command = new Deno.Command(args[0], {
    args: args.slice(1),
    stdout: stdoutMode,
    stderr: stderrMode,
  });
  const output = await command.output();
  const stdout = stdoutMode === "piped"
    ? textDecoder.decode(output.stdout)
    : "";
  const stderr = stderrMode === "piped"
    ? textDecoder.decode(output.stderr)
    : "";
  return { success: output.success, code: output.code, stdout, stderr };
}

export async function runStdlibBuild(): Promise<RunResult> {
  return await runCommand(
    ["deno", "task", "stdlib:build"],
    { stdout: "inherit", stderr: "inherit" },
  );
}

export function parseChangedFiles(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function snapshotFiles(
  files: readonly string[],
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    files.map(async (file) => [file, await Deno.readTextFile(file)] as const),
  );
  return new Map(entries);
}

export function compareSnapshots(
  first: ReadonlyMap<string, string>,
  second: ReadonlyMap<string, string>,
): string[] {
  const mismatches: string[] = [];
  for (const [file, firstContent] of first.entries()) {
    if (firstContent !== second.get(file)) {
      mismatches.push(file);
    }
  }
  return mismatches;
}
