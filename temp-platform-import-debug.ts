// Test platform import
console.log("Before imports...");
import { transpile } from "./mod.ts";
console.log("Imported transpile");
import { initializeRuntime } from "./src/common/runtime-initializer.ts";
console.log("Imported initializeRuntime");
import { dirname, cwd, resolve, isAbsolute, join } from "./src/platform/platform.ts";
console.log("Imported platform");

const source = `(let x 42)`;

console.log("Calling transpile...");
const result = await transpile(source);
console.log("Transpile result:", typeof result);
