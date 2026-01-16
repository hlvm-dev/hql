// deno run -A scripts/run-local-examples-all.ts
// Runs every .hql file under doc/examples using the LOCAL HLVM CLI

import {
  cwd,
  readDir,
  runCmd,
  exit,
  resolve,
  relative,
  readTextFile,
} from "../src/platform/platform.ts";

const root = cwd();
const examplesDir = resolve(root, "docs/features");

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

async function readStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
): Promise<string> {
  if (!stream) return "";
  return await new Response(stream).text();
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
for (const file of files) {
  const rel = relative(root, file);
  try {
    const source = await readTextFile(file);
    if (!hasActiveAssertions(source)) {
      console.log("SKIP", rel, "(no assertions)");
      skipped++;
      continue;
    }

    const proc = runCmd({
      cmd: ["deno", "run", "-A", resolve(root, "src/hlvm/cli/run.ts"), file],
      stdout: "piped",
      stderr: "piped",
    });
    const [result, outStr, errStr] = await Promise.all([
      proc.status,
      readStream(proc.stdout),
      readStream(proc.stderr),
    ]);
    const code = result.code;
    if (code === 0) {
      console.log("OK ", rel);
      passed++;
    } else {
      console.error("FAIL", rel);
      if (outStr.trim().length) console.log(outStr.trim());
      if (errStr.trim().length) console.error(errStr.trim());
      failed++;
    }
  } catch (e) {
    console.error("FAIL", file, ":", e?.message || e);
    failed++;
  }
}

console.log(`\nResults: ${passed}/${passed + failed} passed, ${skipped} skipped`);
if (failed) exit(1);
