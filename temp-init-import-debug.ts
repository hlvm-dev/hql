// Test initializeRuntime import
console.log("Before imports...");
import { transpile } from "./mod.ts";
console.log("Imported transpile");
import { initializeRuntime } from "./src/common/runtime-initializer.ts";
console.log("Imported initializeRuntime");

const source = `(let x 42)`;

console.log("Calling transpile...");
const result = await transpile(source);
console.log("Transpile result:", typeof result);

console.log("Calling initializeRuntime...");
await initializeRuntime();
console.log("Done");
