// Test named import
console.log("Before import...");
import { transpile } from "./mod.ts";
console.log("After import, transpile is:", typeof transpile);

const source = `(let x 42)`;

console.log("Calling transpile...");
const result = await transpile(source);
console.log("Result:", result);
