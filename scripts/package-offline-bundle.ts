#!/usr/bin/env -S deno run -A
/**
 * Package an offline HLVM bundle containing:
 *   - The HLVM binary (with embedded AI engine)
 *   - Pre-pulled fallback model blobs
 *
 * Usage:
 *   deno run -A scripts/package-offline-bundle.ts <binary-path> [output-dir] [bundle-name]
 *
 * The script:
 * 1. Starts the binary's embedded engine with a temp OLLAMA_MODELS dir
 * 2. Pulls the fallback model into that dir
 * 3. Packages binary + models/ into a .tar.gz
 */

import { basename, join } from "https://deno.land/std/path/mod.ts";
import {
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_OLLAMA_HOST,
} from "../src/common/config/types.ts";
import {
  findOllamaModelManifest,
  LOCAL_FALLBACK_MODEL,
} from "../src/hlvm/runtime/bootstrap-manifest.ts";
const ENGINE_STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

async function waitForEngine(): Promise<boolean> {
  const deadline = Date.now() + ENGINE_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(DEFAULT_OLLAMA_ENDPOINT);
      if (resp.ok) return true;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

async function pullModel(modelId: string): Promise<void> {
  console.log(`Pulling ${modelId}...`);
  const resp = await fetch(`${DEFAULT_OLLAMA_ENDPOINT}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelId, stream: true }),
  });

  if (!resp.ok) {
    throw new Error(`Pull failed: ${resp.status} ${await resp.text()}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        if (evt.total && evt.completed) {
          const pct = Math.round((evt.completed / evt.total) * 100);
          Deno.stdout.writeSync(
            new TextEncoder().encode(`\r  ${evt.status ?? "pulling"} ${pct}%`),
          );
        }
        if (evt.error) throw new Error(evt.error);
      } catch (e) {
        if (
          (e as Error).message && !(e as Error).message.startsWith("Unexpected")
        ) throw e;
      }
    }
  }
  console.log(`\n  ${modelId} pulled successfully.`);
}

async function copyDirectory(
  sourceDir: string,
  destDir: string,
): Promise<void> {
  const cp = new Deno.Command("cp", {
    args: ["-R", sourceDir, destDir],
  });
  const result = await cp.output();
  if (!result.success) {
    throw new Error(`Failed to copy ${sourceDir} to ${destDir}`);
  }
}

function resolveCandidateSourceModelsDir(): string[] {
  const candidates: string[] = [];
  const envOverride = Deno.env.get("HLVM_OFFLINE_SOURCE_MODELS_DIR");
  if (envOverride) {
    candidates.push(envOverride);
  }
  const home = Deno.env.get("HOME");
  if (home) {
    candidates.push(join(home, ".hlvm", ".runtime", "models"));
  }
  return candidates;
}

async function seedModelsDirIfAvailable(tmpModels: string): Promise<boolean> {
  for (const candidate of resolveCandidateSourceModelsDir()) {
    const manifest = await findOllamaModelManifest(
      candidate,
      LOCAL_FALLBACK_MODEL,
    );
    if (!manifest) continue;
    console.log(`Using existing verified fallback model from ${candidate}`);
    await Deno.remove(tmpModels, { recursive: true }).catch(() => {});
    await copyDirectory(candidate, tmpModels);
    return true;
  }
  return false;
}

async function main() {
  const binaryPath = Deno.args[0];
  const outputDir = Deno.args[1] ?? ".";
  const explicitBundleName = Deno.args[2];

  if (!binaryPath) {
    console.error(
      "Usage: package-offline-bundle.ts <binary-path> [output-dir] [bundle-name]",
    );
    Deno.exit(1);
  }

  // Create temp model store
  const tmpModels = await Deno.makeTempDir({ prefix: "hlvm-models-" });
  let proc: Deno.ChildProcess | null = null;

  try {
    const seeded = await seedModelsDirIfAvailable(tmpModels);
    if (!seeded) {
      // Start engine only when a preloaded verified model store is unavailable.
      console.log("Starting embedded engine...");
      proc = new Deno.Command(binaryPath, {
        args: ["serve"],
        stdout: "null",
        stderr: "null",
        env: {
          OLLAMA_HOST: DEFAULT_OLLAMA_HOST,
          OLLAMA_MODELS: tmpModels,
        },
      }).spawn();

      if (!(await waitForEngine())) {
        throw new Error("Engine did not start within timeout.");
      }
      console.log("Engine ready.");

      // Pull model
      await pullModel(LOCAL_FALLBACK_MODEL);
    }

    // Read real digest + size from Ollama's on-disk manifest
    const ollamaManifest = await findOllamaModelManifest(
      tmpModels,
      LOCAL_FALLBACK_MODEL,
    );
    if (!ollamaManifest) {
      throw new Error(
        "Model pull completed but Ollama manifest not found on disk. " +
          "The model may not have been saved correctly.",
      );
    }
    console.log(`Model manifest: ${ollamaManifest.path}`);
    console.log(`Model digest: ${ollamaManifest.manifest.digest}`);
    console.log(
      `Model size:   ${
        (ollamaManifest.manifest.totalSize / 1024 / 1024).toFixed(1)
      } MB`,
    );

    // Package: binary + pre-pulled models only.
    // NO manifest.json in the bundle — the installer runs `hlvm bootstrap`
    // which creates a manifest with the correct engine path for this machine.
    // This avoids the impossible task of predicting the engine path at packaging time.
    const binaryName = basename(binaryPath).replace(/\.(exe)?$/, "") || "hlvm";
    const bundleName = explicitBundleName || `${binaryName}-full.tar.gz`;
    const bundlePath = join(outputDir, bundleName);

    // Stage files
    const stageDir = await Deno.makeTempDir({ prefix: "hlvm-bundle-" });
    await Deno.copyFile(binaryPath, join(stageDir, "hlvm"));
    await Deno.chmod(join(stageDir, "hlvm"), 0o755);

    // Copy models
    const cp = new Deno.Command("cp", {
      args: ["-r", tmpModels, join(stageDir, "models")],
    });
    await cp.output();

    // Create tarball
    console.log(`Packaging ${bundlePath}...`);
    const tar = new Deno.Command("tar", {
      args: ["-czf", bundlePath, "-C", stageDir, "."],
    });
    const tarResult = await tar.output();
    if (!tarResult.success) {
      throw new Error("tar command failed");
    }

    const stat = await Deno.stat(bundlePath);
    console.log(
      `Bundle created: ${bundlePath} (${
        (stat.size / 1024 / 1024).toFixed(1)
      } MB)`,
    );

    // Cleanup staging
    await Deno.remove(stageDir, { recursive: true }).catch(() => {});
  } finally {
    // Kill engine
    try {
      proc?.kill("SIGTERM");
    } catch { /* best-effort */ }
    // Cleanup temp models
    await Deno.remove(tmpModels, { recursive: true }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e.message);
  Deno.exit(1);
});
