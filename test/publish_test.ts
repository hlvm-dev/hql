// test/publish_test.ts
import { publishNpm } from "../modules/publish_npm.ts";
import { exists } from "https://deno.land/std@0.170.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.170.0/path/mod.ts";

// Create a temporary directory for testing.
const tempDir = await Deno.makeTempDir();
console.log("Using temporary directory:", tempDir);

// Write a sample add.hql file into tempDir.
const sampleHQL = `(defn add [a b]
  (+ a b))
(export "add" add)`;
const addHqlPath = join(tempDir, "add.hql");
await Deno.writeTextFile(addHqlPath, sampleHQL);
console.log("Created sample HQL module at:", addHqlPath);

// Set DRY_RUN_PUBLISH so that npm publish runs in dry-run mode.
Deno.env.set("DRY_RUN_PUBLISH", "1");
// Also set a test npm username.
Deno.env.set("NPM_USERNAME", "testuser");

// Call publishNpm.
await publishNpm({ what: tempDir, name: "add" });

// Verify that essential files exist.
const pkgJsonPath = join(tempDir, "package.json");
const versionPath = join(tempDir, "VERSION");
const readmePath = join(tempDir, "README.md");
const compiledPath = join(tempDir, "add.hql.js");

if (!(await exists(pkgJsonPath))) {
  throw new Error("package.json was not created.");
}
if (!(await exists(versionPath))) {
  throw new Error("VERSION file was not created.");
}
if (!(await exists(readmePath))) {
  throw new Error("README.md was not created.");
}
if (!(await exists(compiledPath))) {
  throw new Error("Compiled JS file was not created.");
}

console.log("Publish test completed successfully. (Dry run mode)");
