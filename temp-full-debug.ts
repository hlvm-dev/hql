// Full debug test mimicking hql.run
import { initializeRuntimeHelpers } from "./src/common/runtime-helpers.ts";

console.log("Initializing runtime helpers...");
initializeRuntimeHelpers();

console.log("Checking global iterate:");
const globalAny = globalThis as unknown as Record<string, unknown>;
console.log("globalThis.iterate:", globalAny.iterate);
console.log("globalThis.first:", globalAny.first);

// Test calling iterate via globalThis
const iterate = globalAny.iterate as (f: (x: number) => number, x: number) => unknown;
const first = globalAny.first as (coll: unknown) => unknown;

console.log("Creating nums via global iterate...");
const nums = iterate((x: number) => x + 1, 0);
console.log("nums created:", nums);

console.log("Calling global first...");
const result = first(nums);
console.log("first result:", result);
