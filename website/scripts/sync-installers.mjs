import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");
const websiteRoot = resolve(scriptDir, "..");
const outputDir = resolve(websiteRoot, process.argv[2] ?? "out");

await mkdir(outputDir, { recursive: true });

for (const file of ["install.sh", "install.ps1"]) {
  const source = resolve(repoRoot, file);
  const destination = resolve(outputDir, file);
  await cp(source, destination, { force: true });
  process.stdout.write(`Synced ${file} -> ${destination}\n`);
}
