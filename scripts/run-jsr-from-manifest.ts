// deno run -A scripts/run-jsr-from-manifest.ts tests/manifest-official.json
// Execute a manifest of HQL files using the local workspace build only.

import { expandGlob } from "jsr:@std/fs@1/expand-glob";
import { cwd, readTextFile, runCmd, getEnv, exit, getArgs, resolve, isAbsolute, relative } from "../core/src/platform/platform.ts";

const root = cwd();

async function inferWorkspaceVersion(): Promise<string | undefined> {
  try {
    const projectManifest = JSON.parse(
      await readTextFile(resolve(root, "deno.json")),
    );
    const version = projectManifest?.version;
    return typeof version === "string" ? version : undefined;
  } catch (_err) {
    return undefined;
  }
}

const workspaceVersion = await inferWorkspaceVersion();

const manifestPath = getArgs()[0] ?? "tests/manifest-official.json";
const manifest = JSON.parse(
  await readTextFile(resolve(root, manifestPath)),
) as string[];

function toAbsolute(rel: string): string {
  return isAbsolute(rel) ? rel : resolve(root, rel);
}

async function expandEntries(entries: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.includes("*")) {
      for await (const file of expandGlob(entry)) {
        if (file.isFile && file.path.endsWith(".hql")) {
          out.push(toAbsolute(file.path));
        }
      }
    } else {
      out.push(toAbsolute(entry));
    }
  }
  return out.sort();
}

async function runWithWorkspaceCli(file: string): Promise<void> {
  const child = runCmd({
    cmd: [
      "deno",
      "run",
      "-A",
      resolve(root, "core/cli/run.ts"),
      file,
    ],
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
  } catch (error) {
    try {
      child.kill?.();
    } catch (_killErr) {
      // ignore kill errors
    }
    throw error instanceof Error ? error : new Error(String(error));
  }

  if (!status.success) {
    throw new Error(`exit code ${status.code}`);
  }
}

const files = await expandEntries(manifest);
let passed = 0;
let failed = 0;

const bannerVersion = workspaceVersion ?? "workspace";
console.log(
  `=== HQL Suite (workspace) — manifest: ${manifestPath} (v${bannerVersion}) ===\n`,
);

for (const file of files) {
  const rel = relative(root, file);
  console.log("START", rel);
  let success = false;

  try {
    await runWithWorkspaceCli(file);
    console.log("OK   ", rel);
    success = true;
  } catch (error) {
    console.error(
      "FAIL ",
      rel,
      ":",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (success) {
    passed++;
  } else {
    failed++;
  }
}

console.log(`\nResults: ${passed}/${passed + failed} passed`);
exit(failed ? 1 : 0);
