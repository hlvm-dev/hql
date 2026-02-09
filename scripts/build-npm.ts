/**
 * Build script: Deno → npm package using dnt.
 *
 * Produces an npm-compatible package in ./npm/ that works on Node.js 18+ and Bun.
 * The key transformation: platform.ts (Deno) → platform-node.ts (Node.js).
 *
 * Usage: deno run -A scripts/build-npm.ts
 */

import { build, emptyDir } from "jsr:@deno/dnt";

const outDir = "./npm";
await emptyDir(outDir);

await build({
  entryPoints: [
    { name: ".", path: "./mod.ts" },
    { name: "./agent", path: "./src/hlvm/agent/sdk.ts" },
  ],
  outDir,
  shims: {
    deno: false,
  },
  mappings: {
    "./src/platform/platform.ts": "./src/platform/platform-node.ts",
  },
  package: {
    name: "@hlvm/hql",
    version: Deno.env.get("VERSION") || "0.1.0",
    type: "module",
    license: "MIT",
    description: "HQL transpiler and AI agent SDK",
    engines: { node: ">=18.0.0" },
    repository: { type: "git", url: "https://github.com/nicetool/hql" },
    keywords: ["hql", "lisp", "transpiler", "agent", "ai", "sdk"],
  },
  compilerOptions: {
    target: "ES2022",
    lib: ["ES2022"],
  },
  // dnt runs tests by default; skip for CI speed — we test in Deno
  test: false,
  // Don't type-check — we already type-check in Deno
  typeCheck: false,
  // Filter diagnostics to allow jsr: imports in CLI-only code (not shipped)
  filterDiagnostic: (_diagnostic) => true,
});

// Copy any additional files needed in the npm package
const { copyFile } = await import("node:fs/promises");
try {
  await copyFile("LICENSE", `${outDir}/LICENSE`);
} catch {
  // LICENSE may not exist
}
try {
  await copyFile("README.md", `${outDir}/README.md`);
} catch {
  // README may not exist
}

console.log("npm package built successfully in ./npm/");
