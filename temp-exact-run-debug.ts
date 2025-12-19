// Debug test - EXACTLY what hql.run does
import { transpile } from "./mod.ts";
import { initializeRuntime } from "./src/common/runtime-initializer.ts";
import { dirname, cwd, resolve, isAbsolute, join } from "./src/platform/platform.ts";

const source = `
(let nums (iterate (fn [x] (+ x 1)) 0))
(first nums)
`;

console.log("=== Starting exact run simulation ===");

const baseDir = cwd();
const currentFile = join(baseDir, "<anonymous>.hql");
const importerDir = dirname(currentFile);

console.log("baseDir:", baseDir);
console.log("currentFile:", currentFile);

const transpileOptions = {
  currentFile,
  generateSourceMap: false,
  sourceContent: source,
};

console.log("\n1. Transpiling...");
const transpileResult = await transpile(source, transpileOptions);
const initialJs = typeof transpileResult === "string"
  ? transpileResult
  : transpileResult.code;
console.log("Transpiled code:\n", initialJs);

console.log("\n2. Process module code (simulated)...");
// For code without imports, processModuleCode returns the code as-is
const hasImports = initialJs.includes("import ");
const hasExports = initialJs.includes("export ");
console.log("hasImports:", hasImports);
console.log("hasExports:", hasExports);
const js = initialJs;
const shouldUseModuleLoader = hasImports || hasExports;
console.log("shouldUseModuleLoader:", shouldUseModuleLoader);

console.log("\n3. Initialize runtime...");
await initializeRuntime();
console.log("Runtime initialized");

console.log("\n4. Run code...");
if (shouldUseModuleLoader) {
  console.log("Would use module loader (but we don't have imports/exports)");
} else {
  console.log("Using eval fallback");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const evaluate = new AsyncFunction("source", "return eval(source);");
  console.log("Evaluating:", js);
  const result = await evaluate(js);
  console.log("Result:", result);
}
