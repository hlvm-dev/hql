// Test script to verify module reimport executes all code again

console.log("\n=== Import 1 ===");
const mod1 = await import("./reimport-test.mjs?v=1");
console.log("myVar:", mod1.myVar);

console.log("\n=== Import 2 (with different query) ===");
const mod2 = await import("./reimport-test.mjs?v=2");
console.log("myVar:", mod2.myVar);

console.log("\n=== Import 3 (with different query) ===");
const mod3 = await import("./reimport-test.mjs?v=3");
console.log("myVar:", mod3.myVar);

console.log("\nIf you see 'MODULE EXECUTED' and 'Line X executed' multiple times, then reimporting DOES re-execute all code.");
