// deno run -A scripts/run-local-from-manifest.ts tests/manifest-official.json
// Local CLI runner for a manifest (supports globs via std/fs)

import { expandGlob } from "jsr:@std/fs@1/expand-glob";
import { cwd, readTextFile, runCmd, getEnv, exit, getArgs, resolve, relative } from "../core/src/platform/platform.ts";

const root = cwd();
const manifestPath = getArgs()[0] || "tests/manifest-official.json";
const manifest: string[] = JSON.parse(
  await readTextFile(resolve(root, manifestPath)),
);

async function expandEntries(entries: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.includes("*")) {
      for await (const file of expandGlob(entry)) {
        if (file.isFile && file.path.endsWith(".hql")) {
          out.push(resolve(root, file.path));
        }
      }
    } else {
      out.push(resolve(root, entry));
    }
  }
  return out.sort();
}

let passed = 0, failed = 0;
console.log(`=== LOCAL HQL Suite — manifest: ${manifestPath} ===\n`);

const files = await expandEntries(manifest);
for (const file of files) {
  const rel = relative(root, file);
  console.log("START", rel);
  try {
    const child = runCmd({
      cmd: ["deno", "run", "-A", resolve(root, "core/cli/run.ts"), file],
      env: { HQL_FORCE_REBUILD: "0" },
      stdout: "inherit",
      stderr: "inherit",
    });
    const perFileTimeoutMs = Number(
      getEnv("HQL_TEST_TIMEOUT_MS") || "45000",
    );
    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), perFileTimeoutMs)
    );
    let status;
    try {
      status = await Promise.race([child.status, timer]);
    } catch (e) {
      try {
        child.kill?.();
      } catch {
        // Child already exited; nothing to clean up.
      }
      console.error("FAIL", rel, ":", e?.message || e);
      failed++;
      continue;
    }
    if (status.success) {
      console.log("OK ", rel);
      passed++;
    } else {
      console.error("FAIL", rel, ": exit code", status.code);
      failed++;
    }
  } catch (e) {
    console.error("FAIL", rel, ":", e?.message || e);
    failed++;
  }
}

console.log(`\nResults: ${passed}/${passed + failed} passed`);
// Force exit whether tests pass or fail
exit(failed ? 1 : 0);
