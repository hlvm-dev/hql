// deno run -A scripts/run-local-examples-all.ts
// Runs every .hql file under doc/examples using the LOCAL HQL CLI

import { cwd, readDir, runCmd, exit, resolve, relative } from "../core/src/platform/platform.ts";

const root = cwd();
const examplesDir = resolve(root, "doc/examples");

async function listHqlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    for await (const entry of readDir(d)) {
      const p = resolve(d, entry.name);
      if (entry.isDirectory) {
        if (entry.name === ".build" || entry.name === ".hql-cache") continue;
        await walk(p);
      } else if (entry.isFile && p.endsWith(".hql")) {
        out.push(p);
      }
    }
  }
  await walk(dir);
  return out.sort();
}

let passed = 0, failed = 0;
console.log("=== LOCAL HQL Full Examples Suite ===\n");

const files = await listHqlFiles(examplesDir);
for (const file of files) {
  const rel = relative(root, file);
  try {
    const proc = runCmd({
      cmd: ["deno", "run", "-A", resolve(root, "core/cli/run.ts"), file],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await proc.status;
    const code = result.code;
    // Note: Platform abstraction doesn't expose stdout/stderr output capture yet
    // This would need to be enhanced to capture output
    const outStr = "";
    const errStr = "";
    if (code === 0) {
      console.log("OK ", rel);
      if (outStr.trim().length) console.log(outStr.trim());
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

console.log(`\nResults: ${passed}/${passed + failed} passed`);
if (failed) exit(1);
