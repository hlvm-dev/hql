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
  // ESM-only — Node 18+ supports ESM natively, no CommonJS needed
  scriptModule: false,
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

// Post-build patches
const { readFile, writeFile, copyFile } = await import("node:fs/promises");

// Patch package.json: add types to exports (dnt doesn't do this for ESM-only)
const pkgPath = `${outDir}/package.json`;
const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
pkg.exports = {
  ".": {
    "types": "./esm/mod.d.ts",
    "import": "./esm/mod.js",
  },
  "./agent": {
    "types": "./esm/src/hlvm/agent/sdk.d.ts",
    "import": "./esm/src/hlvm/agent/sdk.js",
  },
};
pkg.types = "./esm/mod.d.ts";
await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// Patch dnt polyfill to handle missing process.argv[1] (e.g. node -e)
const polyfillPath = `${outDir}/esm/_dnt.polyfills.js`;
try {
  let polyfill = await readFile(polyfillPath, "utf-8");
  polyfill = polyfill.replace(
    `process.argv[1].replace(/\\\\/g, "/")`,
    `(process.argv[1] || "").replace(/\\\\/g, "/")`,
  );
  await writeFile(polyfillPath, polyfill);
} catch {
  // polyfill file may not exist in future dnt versions
}

// Copy any additional files needed in the npm package
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
