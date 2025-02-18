// main.ts

// --- Part 1: Basic logging and module imports ---

import chalk from "https://deno.land/x/chalk_deno@v4.1.1-deno/source/index.js";
console.log(chalk.blue("Hello world!"));

// Import lodash from npm.
import lodash from "npm:lodash";
const arr = [1, 2, 3, 4, 5, 6];
console.log("Lodash chunked array:", lodash.chunk(arr, 2));
console.log("hey!");

// --- Part 2: Using the transpiled HQL module ---
// The transpiled module (hello.hql.js) has its own isolated exports.
import { add, minus, add2, minus2 } from "./transpiled/hello.hql.js";

(async () => {
  console.log("=== Transpiled Module Results ===");
  console.log("add(2, 1):", await add(2, 1));         // Expected 3
  console.log("minus(2, 1):", await minus(2, 1));       // Expected 1
  console.log("add2(20, 10):", await add2(20, 10));     // Expected 30
  console.log("minus2(20, 10):", await minus2(20, 10)); // Expected 10

  async function asyncFunction() {
    console.log("Inside asyncFunction (transpiled module):");
    console.log("add2(100, 50):", await add2(100, 50));       // Expected 150
    console.log("minus2(100, 50):", await minus2(100, 50));   // Expected 50
    console.log("add(100, 50):", await add(100, 50));         // Expected 150
    console.log("minus(100, 50):", await minus(100, 50));     // Expected 50
  }
  await asyncFunction();
})();

  // --- Part 3: Dynamic Evaluation in a Separate Context ---
  // Each call to runHQLFile creates an independent exports map.
  import { runHQLFile, getExport } from "../hql.ts";
  const dynExports1 = await runHQLFile("./test/hello.hql");
  const add3 = getExport("add", dynExports1);
  const minus3 = getExport("minus", dynExports1);

  console.log("=== First Dynamic Evaluation Results ===");
  console.log("add3(100, 1):", add3(100, 1));
  console.log("minus3(100, 1):", await minus3(100, 1));

  // --- Part 4: Repeated Dynamic Evaluation ---
  const dynExports2 = await runHQLFile("./test/hello.hql");
  const add4 = getExport("add", dynExports2);
  const minus4 = getExport("minus", dynExports2);

  console.log("=== Second Dynamic Evaluation Results ===");
  console.log("add4(200, 2):", add4(200, 2));
  console.log("minus4(200, 2):", await minus4(200, 2));

  // --- Summary ---
  console.log("=== Summary of All Evaluations ===");
  console.log("Transpiled add(2,1):", await add(2, 1));
  console.log("Dynamic add3(100,1):", add3(100, 1));
  console.log("Dynamic add4(200,2):", add4(200, 2));
