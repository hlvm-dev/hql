// deno run -A scripts/run-local-examples-all.ts
// Runs every .hql file under doc/examples using the local runtime path
import { getPlatform } from "../src/platform/platform.ts";

const p = () => getPlatform();
const cwd = () => p().process.cwd();
const readDir = (path: string) => p().fs.readDir(path);
const runCmd = (options: { cmd: string[]; stdout?: "piped"; stderr?: "piped" }) =>
  p().command.output(options);
const exit = (code: number) => p().process.exit(code);
const resolve = (...paths: string[]) => p().path.resolve(...paths);
const relative = (from: string, to: string) => p().path.relative(from, to);
const readTextFile = (path: string) => p().fs.readTextFile(path);
const textDecoder = new TextDecoder();

const root = cwd();
const examplesDir = resolve(root, "docs/features");
const DEFAULT_EXAMPLE_PARALLELISM = Math.max(
  1,
  Math.min(8, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1),
);

async function listHqlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    for await (const entry of readDir(d)) {
      const p = resolve(d, entry.name);
      if (entry.isDirectory) {
        if (entry.name === ".build" || entry.name === ".hlvm-cache") continue;
        await walk(p);
      } else if (entry.isFile && p.endsWith(".hql")) {
        out.push(p);
      }
    }
  }
  await walk(dir);
  return out.sort();
}

function hasActiveAssertions(source: string): boolean {
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(";")) continue;
    const code = trimmed.split(";")[0];
    if (code.includes("(assert")) {
      return true;
    }
  }
  return false;
}

let passed = 0, failed = 0, skipped = 0;
console.log("=== LOCAL HLVM HQL Examples Suite ===\n");

const files = await listHqlFiles(examplesDir);
const parallelism = DEFAULT_EXAMPLE_PARALLELISM;
const queue = [...files];

async function runExample(file: string): Promise<void> {
  const rel = relative(root, file);
  try {
    const source = await readTextFile(file);
    if (!hasActiveAssertions(source)) {
      console.log("SKIP", rel, "(no assertions)");
      skipped++;
      return;
    }

    const result = await runCmd({
      // Docs examples are executable runtime samples. Run them through the
      // runtime path with type checking disabled so known static-analysis gaps
      // in some feature areas do not mask real syntax/runtime regressions.
      cmd: [
        "deno",
        "eval",
        "--ext=ts",
        `
import hql from ${JSON.stringify(resolve(root, "mod.ts"))};

const file = ${JSON.stringify(file)};
const code = await Deno.readTextFile(file);
const lastSeparator = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\\\"));
const baseDir = lastSeparator >= 0 ? file.slice(0, lastSeparator) : Deno.cwd();

await hql.run(code, {
  typeCheck: false,
  baseDir,
  currentFile: file,
});
        `,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    if (result.code === 0) {
      console.log("OK ", rel);
      passed++;
    } else {
      const outStr = textDecoder.decode(result.stdout);
      const errStr = textDecoder.decode(result.stderr);
      console.error("FAIL", rel);
      if (outStr.trim().length) console.log(outStr.trim());
      if (errStr.trim().length) console.error(errStr.trim());
      failed++;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("FAIL", file, ":", message);
    failed++;
  }
}

async function worker(): Promise<void> {
  while (true) {
    const next = queue.shift();
    if (!next) return;
    await runExample(next);
  }
}

await Promise.all(
  Array.from({ length: parallelism }, () => worker()),
);

console.log(`\nResults: ${passed}/${passed + failed} passed, ${skipped} skipped`);
if (failed) exit(1);
