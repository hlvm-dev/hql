// Debug test - simulate EXACTLY what hql.run does
import hql from "./mod.ts";
import { initializeRuntime } from "./src/common/runtime-initializer.ts";
import { toFileUrl, basename, resolve, dirname, mkdir, writeTextFile } from "./src/platform/platform.ts";

const code = `
(let nums (iterate (fn [x] (+ x 1)) 0))
(first nums)
`;

console.log("Transpiling...");
const result = await hql.transpile(code, {
  generateSourceMap: false,
});
console.log("Transpiled code:");
console.log(result);

console.log("\nInitializing runtime (full)...");
await initializeRuntime();
console.log("Runtime initialized");

// Write to temp file and import
const tempDir = "/tmp/hql-debug";
await mkdir(tempDir, { recursive: true });
const tempFile = `${tempDir}/test-${Date.now()}.mjs`;

// Wrap the code to export the result - add return for last expression
const wrappedCode = `
export default (async () => {
let nums;
(nums = iterate((x) => (x + 1), 0));
return first(nums);
})();
`;

console.log("Writing to:", tempFile);
await writeTextFile(tempFile, wrappedCode);

console.log("Importing...");
const module = await import(toFileUrl(tempFile).href);
console.log("Import result:", await module.default);
