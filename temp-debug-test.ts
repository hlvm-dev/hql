// Debug test to see what iterate is
import { STDLIB_PUBLIC_API } from "./src/lib/stdlib/js/stdlib.js";
import { first, seq } from "./src/lib/stdlib/js/core.js";

console.log("STDLIB_PUBLIC_API.iterate:");
console.log(STDLIB_PUBLIC_API.iterate);
console.log("first:", first);

// Test iterate directly
const nums = STDLIB_PUBLIC_API.iterate((x: number) => x + 1, 0);
console.log("nums created:", nums);

console.log("Calling first...");
const result = first(nums);
console.log("first result:", result);
